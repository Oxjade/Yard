import type { ImportProductDto, SitePieceStatus } from "@/lib/api/contracts/imports"
import { urlKey } from "./normalize"

/**
 * Watching a brand's website (docs/IMPORTER.md › Watching a website): the rules, pure, so the
 * tests pin them down. watch.ts applies them with the database and the network.
 *
 *  - A product is NEW when neither its address (urlKey) nor its source id matches anything Yard has
 *    seen for the brand. Everything seen stays seen: a piece passed over at import, skipped by the
 *    brand or by Yard, or already in Yard never comes back as new.
 *  - The first check of a brand with nothing seen yet records the site as it is (baseline): what's
 *    on the site when watching starts isn't new.
 *  - A piece in Yard (imported or approved) is compared with its baseline: a different price in
 *    the same currency, or sold out where it was available, is FLAGGED; Yard's product never changes.
 *  - A failed check backs off (6 h, 12 h, 24 h, then 48 h); the fifth failure in a row pauses the
 *    watch with a note.
 */

export const WATCH_DEFAULT_HOURS = 6
export const WATCH_DEFAULT_PER_RUN = 4
/** Failures in a row that pause a watch. */
export const WATCH_PAUSE_AFTER = 5
/** Requests one watch check may make at most (listing pages, new product pages, pieces in Yard). */
export const WATCH_MAX_REQUESTS = 120
const HOUR = 3600_000

export function watchEveryHours(env: string | undefined = process.env.YARD_IMPORTER_WATCH_HOURS): number {
  const n = Number(env)
  return Number.isFinite(n) && n >= 1 && n <= 24 * 7 ? n : WATCH_DEFAULT_HOURS
}

export function watchPerRun(env: string | undefined = process.env.YARD_IMPORTER_WATCH_PER_RUN): number {
  const n = Math.floor(Number(env))
  return Number.isFinite(n) && n >= 1 && n <= 50 ? n : WATCH_DEFAULT_PER_RUN
}

/** A spread of ±10 % of the interval, fixed per brand and run count, so brands enabled together drift apart. */
export function jitterMs(brandId: string, salt: number, everyMs: number) {
  let h = 2166136261
  for (const c of `${brandId}:${salt}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  const unit = ((h >>> 0) % 10_000) / 10_000
  return Math.round((unit - 0.5) * 0.2 * everyMs)
}

/** When the next check is due after a good one. */
export function nextAfterSuccess(now: Date, brandId: string, salt: number, everyHours = watchEveryHours()) {
  const every = everyHours * HOUR
  return new Date(now.getTime() + every + jitterMs(brandId, salt, every))
}

/** After `failures` failed checks in a row: when to try again, or pause. */
export function backoff(failures: number, now: Date, everyHours = watchEveryHours()): { pause: boolean; next: Date } {
  if (failures >= WATCH_PAUSE_AFTER) return { pause: true, next: new Date(now.getTime() + 48 * HOUR) }
  const hours = Math.min(48, everyHours * 2 ** Math.max(0, failures - 1))
  return { pause: false, next: new Date(now.getTime() + hours * HOUR) }
}

export function pausedNote(failures: number, error: string) {
  return `Paused after ${failures} failed checks in a row. The last one said: ${error} Check the address, then press Resume.`
}

/* ---------- seen ---------- */

export type KnownPiece = { id: string; urlKey: string; sourceId: string | null; status: SitePieceStatus; baseline: Baseline | null; change: SiteChange | null }
export type Baseline = { priceMinor: number | null; currency: string | null; available: boolean }
export type SiteChange = { price?: { from: number; to: number; currency: string | null }; soldOut?: true; at: string }

export const baselineOf = (p: Pick<ImportProductDto, "priceMinor" | "currency" | "availability">): Baseline => ({ priceMinor: p.priceMinor, currency: p.currency, available: p.availability !== "out_of_stock" })

/** Pieces in Yard: the ones whose site changes are worth flagging (and whose pages a check re-reads). */
export const IN_YARD: SitePieceStatus[] = ["imported", "approved"]

export class SeenIndex {
  private byUrl = new Map<string, KnownPiece>()
  private byId = new Map<string, KnownPiece>()
  constructor(pieces: KnownPiece[]) {
    for (const p of pieces) {
      this.byUrl.set(p.urlKey, p)
      if (p.sourceId) this.byId.set(p.sourceId, p)
    }
  }
  get size() {
    return this.byUrl.size
  }
  find(p: { sourceUrl: string; sourceId?: string | null }): KnownPiece | null {
    return this.byUrl.get(urlKey(p.sourceUrl)) ?? (p.sourceId ? (this.byId.get(p.sourceId) ?? null) : null)
  }
  /** A page a check needn't read again: known and not in Yard (passed over, skipped or waiting). */
  skips(url: string) {
    const k = this.byUrl.get(urlKey(url))
    return !!k && !IN_YARD.includes(k.status)
  }
}

/** The change to flag on a piece in Yard, or null when the site matches its baseline. */
export function changeOf(base: Baseline | null, now: Pick<ImportProductDto, "priceMinor" | "currency" | "availability">, at: Date): SiteChange | null {
  if (!base) return null
  const out: SiteChange = { at: at.toISOString() }
  if (base.priceMinor != null && now.priceMinor != null && now.priceMinor !== base.priceMinor && (base.currency ?? null) === (now.currency ?? null)) out.price = { from: base.priceMinor, to: now.priceMinor, currency: now.currency }
  if (base.available && now.availability === "out_of_stock") out.soldOut = true
  return out.price || out.soldOut ? out : null
}

/** The same change (ignoring when it was seen): a check that sees it again keeps the first time. */
export const sameChange = (a: SiteChange | null, b: SiteChange | null) => JSON.stringify(a ? { ...a, at: 0 } : null) === JSON.stringify(b ? { ...b, at: 0 } : null)

export type ScanClassification = {
  /** Never seen: offered to admin and brand (or recorded as ignored on a baseline check, or when Yard already has the name). */
  fresh: { product: ImportProductDto; ignoredBecause: string | null }[]
  /** Pieces in Yard whose flag changes (set, updated or cleared). */
  changes: { id: string; change: SiteChange | null }[]
  /** Known pieces seen again (last_seen_at). */
  seen: string[]
}

/**
 * What one check found, against what Yard has seen. `baseline`: the brand's first check (nothing
 * seen yet), so everything found is recorded and nothing is offered. A product flagged as a
 * duplicate by name (the importer's markDuplicates: same name as a product or suggestion in Yard)
 * is recorded as passed over, not offered.
 */
export function classifyScan(found: ImportProductDto[], seen: SeenIndex, opts: { baseline: boolean; now: Date }): ScanClassification {
  const out: ScanClassification = { fresh: [], changes: [], seen: [] }
  const keys = new Set<string>()
  for (const p of found) {
    const k = urlKey(p.sourceUrl)
    if (keys.has(k)) continue
    keys.add(k)
    const known = seen.find(p)
    if (!known) {
      const ignoredBecause = opts.baseline ? "On the site when watching started." : p.duplicate && !/^Imported before/.test(p.duplicate.reason) ? p.duplicate.reason : null
      out.fresh.push({ product: p, ignoredBecause })
      continue
    }
    out.seen.push(known.id)
    if (!IN_YARD.includes(known.status)) continue
    const change = changeOf(known.baseline, p, opts.now)
    if (!sameChange(change, known.change)) out.changes.push({ id: known.id, change })
  }
  return out
}

/** The brand's email and notification line for one check's new pieces. */
export const newPiecesLine = (n: number) => `${n} new ${n === 1 ? "piece" : "pieces"} from your website ${n === 1 ? "is" : "are"} waiting. Add ${n === 1 ? "it" : "them"} to Yard in one tap.`
