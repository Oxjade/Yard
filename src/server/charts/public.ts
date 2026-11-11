import "server-only"
import { and, desc, eq } from "drizzle-orm"
import { brandById } from "@/lib/data/brands"
import { campaigns } from "@/lib/data/ads"
import { categories, drops } from "@/lib/data/catalog"
import { cities as gazetteer, cityBySlug, haversineKm } from "@/lib/around/gazetteer"
import { CHART_CATEGORIES, CHART_CITIES, CHART_COUNTRIES, kindToSlug, MIN_COHORT, slugToKind, type BrandRankDto, type ChartBoardDto, type ChartBrandDto, type ChartEntryDto, type ChartQuery, type ChartScopeDto, type ChartScopesDto, type SponsoredDto } from "@/lib/api/contracts/charts"
import { db, t } from "../db"
import { log } from "../log"
import { yard } from "../state"
import { refreshFlags } from "./antifraud"
import { addDays, dropAnchor, todayUtc } from "./baseline"
import { boardKeyString, datesNeeded, editionWindow, loadPrior, priorFrom, rankBoard, withMovement, writeSnapshots, type BoardKey, type ChartKind, type EditionEntry, type Stat } from "./editions"
import { refusedSampleBrand, sampleOff } from "../catalog/sample-guard"
import { dropStatus, listed, loadBrands, loadFrozen, loadHolds, loadUniverse, maxEventSeq, PERIOD_DAYS, type BrandRow, type Period } from "./metrics"
import { categoryLabel, cityName, countryName, scopeKey, type Scope } from "./scope"

/**
 * The public reads (§6.3 "Charts API"): the live board with movement and history, the scopes
 * that have enough brands, and a brand's best weekly rank. The live edition is recomputed when it
 * is older than 60 s (daily), 5 min (weekly) or 15 min (monthly), or sooner (after 15 s) when a
 * new counted signal has arrived; one compute per board at a time (a per-key mutex on globalThis).
 *
 * Only real scopes get this far (the query schema allows Yard's categories, gazetteer cities and
 * market countries), a scope without enough eligible brands is answered from the memoised scopes
 * without loading any signal, and at most MAX_BOARDS live boards stay cached (least recently used
 * first out), so no URL can make the server compute or keep more than the boards that exist.
 */

export const TTL_MS: Record<Period, number> = { daily: 60_000, weekly: 300_000, monthly: 900_000 }
const DIRTY_AFTER_MS = 15_000
const FLAGS_EVERY_MS = 60_000
export const MAX_BOARDS = 200

type Cached = { at: number; gen: number; maxSeq: number; dto: ChartBoardDto }
type State = { gen: number; boards: Map<string, Cached>; locks: Map<string, Promise<ChartBoardDto>>; flagsAt: number; flagsRun?: Promise<unknown>; scopes?: { at: number; gen: number; value: Promise<ChartScopesDto> } }

export function chartsState(): State {
  const slots = (yard.slots ??= {})
  return ((slots.charts as State | undefined) ??= { gen: 0, boards: new Map(), locks: new Map(), flagsAt: 0 })
}

/** Drops every cached board and the scopes (after an admin decision, a reseed, a backfill or a verdict change). */
export function dropCaches() {
  const s = chartsState()
  s.gen++
  s.boards.clear()
  s.scopes = undefined
}

/** Keeps a computed board, evicting the least recently used once MAX_BOARDS are held. */
function remember(s: State, key: string, value: Cached) {
  s.boards.delete(key)
  s.boards.set(key, value)
  while (s.boards.size > MAX_BOARDS) {
    const oldest = s.boards.keys().next().value
    if (oldest === undefined) break
    s.boards.delete(oldest)
  }
}

/** Detectors at most once a minute on the read path (closeEditions and the seed run them always). */
async function flagsFresh(now: number) {
  const s = chartsState()
  if (now - s.flagsAt < FLAGS_EVERY_MS) return
  if (!s.flagsRun) {
    s.flagsRun = refreshFlags(now)
      .then((r) => {
        s.flagsAt = Date.now()
        // New flags, or signals that stopped counting, change what every board shows.
        if (r.created || r.excluded) dropCaches()
      })
      .catch((e) => log.error("[yard] charts: detectors failed", e))
      .finally(() => {
        s.flagsRun = undefined
      })
  }
  await s.flagsRun
}

/* ── DTOs ────────────────────────────────────────────────────────────────── */

export function brandDto(row: Pick<BrandRow, "id" | "handle" | "name" | "city" | "country" | "categories">): ChartBrandDto {
  const b = sampleOff() ? undefined : brandById.get(row.id)
  return {
    id: row.id,
    handle: row.handle,
    name: row.name,
    mark: b ? { text: b.mark.text, style: b.mark.style } : { text: row.name.slice(0, 2).toUpperCase(), style: "condensed" as const },
    verified: b?.verified ?? false,
    city: row.city,
    country: row.country,
    countryName: countryName(row.country) ?? row.country,
    category: categoryLabel(row.categories[0] ?? "") ?? "",
    cover: b ? { src: b.cover.src, alt: b.cover.alt } : null,
  }
}

const dropById = new Map(drops.map((d) => [d.id, d]))

function dropDto(id: string, anchor: number, asOf: number) {
  const d = dropById.get(id)
  if (!d) return undefined
  return { id: d.id, slug: d.slug, name: d.name, image: { src: d.image.src, alt: d.image.alt }, status: dropStatus(d, asOf, anchor) }
}

function scopeDto(s: Scope): ChartScopeDto {
  const out: ChartScopeDto = { key: scopeKey(s) }
  if (s.city) {
    const c = cityBySlug(s.city)
    out.city = { slug: s.city, name: cityName(s.city) ?? "", country: c?.country ?? "" }
  } else if (s.country) out.country = { code: s.country, name: countryName(s.country) ?? "" }
  if (s.category) out.category = { slug: s.category, label: categoryLabel(s.category) ?? "" }
  return out
}

function entryDto(e: Pick<EditionEntry, "rank" | "prevRank" | "movement" | "delta" | "peak" | "editionsOnChart" | "subjectType" | "subjectId" | "brandId" | "stats">, brands: Map<string, BrandRow>, history: (number | null)[], anchor: number, asOf: number): ChartEntryDto | null {
  const row = brands.get(e.brandId)
  // Production: never a sample brand's entry, even from a demo-seeded database.
  if (!row || refusedSampleBrand(row.id)) return null
  return {
    rank: e.rank,
    prevRank: e.prevRank,
    movement: e.movement,
    delta: e.delta,
    peak: e.peak,
    editionsOnChart: e.editionsOnChart,
    subject: { type: e.subjectType, id: e.subjectId },
    brand: brandDto(row),
    drop: e.subjectType === "drop" ? dropDto(e.subjectId, anchor, asOf) : undefined,
    stat: { label: e.stats.label, figure: e.stats.figure, caption: e.stats.caption, extra: e.stats.extra, value: e.stats.value },
    history,
  }
}

/** Biggest climber: the largest positive delta among entries with a previous rank. Highest debut: the best-ranked new entry. */
function callouts(entries: ChartEntryDto[]) {
  const climbers = entries.filter((e) => e.movement === "up" && e.prevRank !== null && e.delta > 0)
  const biggestClimber = climbers.sort((a, b) => b.delta - a.delta || a.rank - b.rank)[0]
  const highestDebut = entries.filter((e) => e.movement === "new").sort((a, b) => a.rank - b.rank)[0]
  return { ...(biggestClimber ? { biggestClimber } : {}), ...(highestDebut ? { highestDebut } : {}) }
}

/**
 * Sponsored placements (§6.3 "Sponsored separation"): organic scores never read campaigns, these
 * come back in their own array (at most 2), and a subject already ranked anywhere on the board is
 * never repeated, so a paid card never sits beside the same brand's organic row. A campaign shows
 * where its audience includes the board's country and category. Campaign ids stay internal.
 */
function sponsored(kind: ChartKind, s: Scope, entries: ChartEntryDto[], eligible: Map<string, BrandRow>, anchor: number, asOf: number): SponsoredDto[] {
  const onBoard = new Set(entries.map((e) => (kind === "top_drops" ? e.subject.id : e.brand.id)))
  const country = s.city ? cityBySlug(s.city)?.country : s.country
  const fits = (c: (typeof campaigns)[number]) => (!country || !c.audience.countries.length || c.audience.countries.includes(country as never)) && (!s.category || !c.audience.categories.length || c.audience.categories.includes(s.category as never))
  const out: SponsoredDto[] = []
  if (kind === "top_drops") {
    for (const c of campaigns) {
      if (c.type !== "sponsored-drop" || c.status !== "active" || !fits(c)) continue
      for (const id of c.targetIds) {
        const d = dropById.get(id)
        const row = d && eligible.get(d.brandId)
        if (!d || !row || onBoard.has(d.id)) continue
        const dto = dropDto(d.id, anchor, asOf)
        if (!dto || dto.status === "ended") continue
        out.push({ kind: "drop", brand: brandDto(row), drop: dto })
      }
    }
  } else {
    for (const c of campaigns) {
      if (c.type !== "sponsored-brand" || c.status !== "active" || !fits(c)) continue
      const row = eligible.get(c.brandId)
      if (!row || onBoard.has(row.id) || out.some((o) => o.brand.id === row.id)) continue
      out.push({ kind: "brand", brand: brandDto(row) })
    }
  }
  return out.slice(0, 2)
}

/* ── Boards ──────────────────────────────────────────────────────────────── */

export type ResolvedQuery = { kind: ChartKind; period: Period; scope: Scope }

/**
 * The board a query asks for. City charts without a city open on the city with the largest
 * eligible cohort (the client then applies the shopper's own preference, §6.3 "City charts
 * default"). On City charts the city decides the place; elsewhere a city wins over a country.
 */
export async function resolveQuery(q: ChartQuery): Promise<ResolvedQuery> {
  const kind = slugToKind(q.chart)
  const scope: Scope = {}
  // The schema already refuses anything else; a direct caller gets the same rule (unknown parts dropped).
  if (q.category && CHART_CATEGORIES.includes(q.category)) scope.category = q.category
  if (q.city && CHART_CITIES.includes(q.city)) scope.city = q.city
  else if (q.country && CHART_COUNTRIES.includes(q.country) && kind !== "city") scope.country = q.country
  if (kind === "city" && !scope.city) {
    const scopes = await getScopes()
    const country = q.country && CHART_COUNTRIES.includes(q.country) ? q.country : undefined
    const best = [...scopes.cities].filter((c) => !country || c.country === country).sort((a, b) => b.eligible - a.eligible || a.name.localeCompare(b.name))[0]
    if (best) scope.city = best.slug
  }
  return { kind, period: q.period, scope }
}

/** Eligible brands in a scope, from the memoised scopes (Infinity for the global boards, which have no minimum). */
function cohortOf(sc: ChartScopesDto, r: ResolvedQuery): number {
  const s = r.scope
  if (r.kind === "city" && !s.city) return 0
  if (s.city || s.country) {
    const place = s.city ? sc.cities.find((c) => c.slug === s.city) : sc.countries.find((c) => c.code === s.country)
    if (!place) return 0
    return s.category ? (place.byCategory[s.category] ?? 0) : place.eligible
  }
  if (s.category) return sc.categories.find((c) => c.slug === s.category)?.eligible ?? 0
  return Infinity
}

async function fallbackFor(r: ResolvedQuery): Promise<ChartBoardDto["fallback"]> {
  const scopes = await getScopes()
  const out: NonNullable<ChartBoardDto["fallback"]> = {}
  const country = r.scope.city ? (cityBySlug(r.scope.city)?.country ?? scopes.cities.find((c) => c.slug === r.scope.city)?.country) : undefined
  // Offered only when that country has a chart of its own, so the fallback never leads to another
  // empty board and never states how many of a place's brands are held.
  const countryLabel = country ? countryName(country) : null
  const countryEligible = scopes.countries.find((c) => c.code === country)?.eligible ?? 0
  if (country && countryLabel && countryEligible >= MIN_COHORT) out.country = { code: country, name: countryLabel, eligible: countryEligible }
  if (r.kind === "city" && r.scope.city) {
    const here = cityBySlug(r.scope.city)
    const candidates = scopes.cities.filter((c) => c.slug !== r.scope.city && c.eligible >= MIN_COHORT)
    const near = here
      ? candidates
          .map((c) => ({ c, km: (() => { const g = gazetteer.find((x) => x.slug === c.slug); return g ? haversineKm(here.lat, here.lng, g.lat, g.lng) : Infinity })() }))
          .sort((a, b) => a.km - b.km)[0]?.c
      : candidates.sort((a, b) => b.eligible - a.eligible)[0]
    if (near) out.nearestCity = { slug: near.slug, name: near.name, eligible: near.eligible }
  }
  return out
}

/** A scope with fewer than MIN_COHORT eligible brands: no entries, where to go instead. */
async function smallBoard(r: ResolvedQuery, cohortSize: number): Promise<ChartBoardDto> {
  return { chart: kindToSlug(r.kind), period: r.period, scope: scopeDto(r.scope), sample: true, sponsored: [], callouts: {}, state: "small_cohort", edition: null, cohortSize, entries: [], fallback: await fallbackFor(r) }
}

/** Live board compute: rank today's edition, carry movement from stored finals, write the live snapshot. */
async function computeLive(r: ResolvedQuery, now: number): Promise<{ dto: ChartBoardDto; maxSeq: number }> {
  const key: BoardKey = { chart: r.kind, period: r.period, scope: scopeKey(r.scope) }
  // Yesterday closed (once per process per day), so movement compares with a real final edition.
  await (await import("./index")).ensureClosed(now)
  await flagsFresh(now)
  const today = todayUtc(now)
  const len = PERIOD_DAYS[r.period]
  const anchor = dropAnchor(now)
  const u = await loadUniverse(addDays(today, -2 * len + 1), today, { now, anchor })
  const ranked = rankBoard(u, key, today)
  const brands = new Map(u.brands.map((b) => [b.id, b]))
  const base = { chart: kindToSlug(r.kind), period: r.period, scope: scopeDto(r.scope), sample: true as const, sponsored: [], callouts: {} }
  if (ranked.small) return { dto: await smallBoard(r, ranked.cohortSize), maxSeq: u.maxSeq }

  const prior = await loadPrior([key], datesNeeded(today, [r.period]))
  const entries = withMovement(ranked.entries, key, today, priorFrom(prior))
  const computedAt = new Date(now)
  // A compute that began before midnight keeps its answer but never writes over the day that has
  // since closed (writeSnapshots also never turns a final edition back into a live one).
  if (todayUtc() === today) await writeSnapshots([{ key, edition: today, status: "live", cohortSize: ranked.cohortSize, computedAt, entries }])

  const historyDays = Array.from({ length: 8 }, (_, i) => addDays(today, i - 8))
  const asOf = now
  const dtos = entries
    .map((e) => {
      const history = historyDays.map((d) => prior.get(`${boardKeyString(key)}:${d}`)?.get(e.subjectId)?.rank ?? null)
      return entryDto(e, brands, [...history, e.rank], anchor, asOf)
    })
    .filter((x): x is ChartEntryDto => !!x)
  const eligible = new Map([...brands].filter(([id, b]) => listed(b) && !u.frozen.has(id) && !(u.holds.get(id) && u.holds.get(id)! <= today)))
  return {
    dto: {
      ...base,
      state: "ok",
      edition: { date: today, status: "live", computedAt: computedAt.toISOString(), window: editionWindow(today, r.period), nextRefreshAt: new Date(now + TTL_MS[r.period]).toISOString() },
      cohortSize: ranked.cohortSize,
      entries: dtos,
      sponsored: sponsored(r.kind, r.scope, dtos, eligible, anchor, asOf),
      callouts: callouts(dtos),
    },
    maxSeq: u.maxSeq,
  }
}

/** The newest final edition for a board, when the live compute fails (§6.3: the chip reads "Final"). */
async function latestFinal(r: ResolvedQuery, now: number): Promise<ChartBoardDto | null> {
  const key: BoardKey = { chart: r.kind, period: r.period, scope: scopeKey(r.scope) }
  const d = await db()
  const [snap] = await d
    .select()
    .from(t.chartSnapshots)
    .where(and(eq(t.chartSnapshots.chart, key.chart), eq(t.chartSnapshots.period, key.period), eq(t.chartSnapshots.scope, key.scope), eq(t.chartSnapshots.status, "final")))
    .orderBy(desc(t.chartSnapshots.edition))
    .limit(1)
  if (!snap) return null
  const rows = await d.select().from(t.chartEntries).where(eq(t.chartEntries.snapshotId, snap.id)).orderBy(t.chartEntries.rank)
  const brands = new Map((await loadBrands()).map((b) => [b.id, b]))
  const holds = await loadHolds()
  const frozen = await loadFrozen()
  const anchor = dropAnchor(now)
  const prior = await loadPrior([key], Array.from({ length: 8 }, (_, i) => addDays(snap.edition, i - 8)))
  const dtos = rows
    // A brand held or frozen since that edition closed stays off the public board.
    .filter((e) => { const b = brands.get(e.brandId); return b && listed(b) && !frozen.has(e.brandId) && !holds.has(e.brandId) })
    .map((e, i) => {
      const history = Array.from({ length: 8 }, (_, k) => prior.get(`${boardKeyString(key)}:${addDays(snap.edition, k - 8)}`)?.get(e.subjectId)?.rank ?? null)
      return entryDto({ rank: i + 1, prevRank: e.prevRank, movement: e.movement as EditionEntry["movement"], delta: e.delta, peak: e.peakRank, editionsOnChart: e.editionsOnChart, subjectType: e.subjectType as "brand" | "drop", subjectId: e.subjectId, brandId: e.brandId, stats: e.stats as Stat }, brands, [...history, i + 1], anchor, now)
    })
    .filter((x): x is ChartEntryDto => !!x)
  return {
    chart: kindToSlug(r.kind),
    period: r.period,
    scope: scopeDto(r.scope),
    state: "ok",
    edition: { date: snap.edition, status: "final", computedAt: snap.computedAt.toISOString(), window: editionWindow(snap.edition, r.period), nextRefreshAt: new Date(now + 60_000).toISOString() },
    cohortSize: snap.cohortSize,
    entries: dtos,
    sponsored: [],
    callouts: callouts(dtos),
    sample: true,
  }
}

/** GET /api/charts and the /charts page: the live board (cached per board, one compute at a time). */
export async function getBoard(q: ChartQuery, now = Date.now()): Promise<ChartBoardDto> {
  const r = await resolveQuery(q)
  // Too few brands in scope: answered from the memoised scopes, never computed and never cached.
  const cohort = cohortOf(await getScopes(now), r)
  if (cohort < MIN_COHORT) return smallBoard(r, Number.isFinite(cohort) ? cohort : 0)
  const key = boardKeyString({ chart: r.kind, period: r.period, scope: scopeKey(r.scope) })
  const s = chartsState()
  const hit = s.boards.get(key)
  // A cached board is reusable while it belongs to this generation and to today's edition.
  if (hit && hit.gen === s.gen && (hit.dto.state !== "ok" || hit.dto.edition?.date === todayUtc(now))) {
    const age = now - hit.at
    if (age < DIRTY_AFTER_MS || (age < TTL_MS[r.period] && (await maxEventSeq()) === hit.maxSeq)) {
      remember(s, key, hit)
      return hit.dto
    }
  }
  const running = s.locks.get(key)
  if (running) return running
  const gen = s.gen
  const job = (async () => {
    try {
      const { dto, maxSeq } = await computeLive(r, now)
      if (gen === s.gen && dto.state === "ok") remember(s, key, { at: now, gen, maxSeq, dto })
      return dto
    } catch (e) {
      log.error(`[yard] charts: live compute failed for ${key}`, e)
      const final = await latestFinal(r, now).catch(() => null)
      if (final) return final
      return {
        chart: kindToSlug(r.kind),
        period: r.period,
        scope: scopeDto(r.scope),
        state: "warming_up",
        edition: null,
        cohortSize: 0,
        entries: [],
        sponsored: [],
        callouts: {},
        sample: true,
      } satisfies ChartBoardDto
    } finally {
      s.locks.delete(key)
    }
  })()
  s.locks.set(key, job)
  return job
}

/* ── Scopes ──────────────────────────────────────────────────────────────── */

async function computeScopes(now: number): Promise<ChartScopesDto> {
  const [brands, holds, frozen] = [await loadBrands(), await loadHolds(), await loadFrozen(new Date(now))]
  const today = todayUtc(now)
  const eligible = (b: BrandRow) => listed(b) && !frozen.has(b.id) && !(holds.get(b.id) && holds.get(b.id)! <= today) && b.joinedAt <= today
  type Place = { eligible: number; byCategory: Record<string, number> }
  const cityMap = new Map<string, Place & { slug: string; name: string; country: string }>()
  const countryMap = new Map<string, Place & { code: string; name: string }>()
  // Only eligible brands make a place: a city whose only brand is held or frozen isn't listed at all.
  for (const b of brands) {
    if (!eligible(b)) continue
    const c = cityMap.get(b.citySlug) ?? { slug: b.citySlug, name: cityName(b.citySlug, b.city) ?? b.city, country: b.country, eligible: 0, byCategory: {} }
    const k = countryMap.get(b.country) ?? { code: b.country, name: countryName(b.country) ?? b.country, eligible: 0, byCategory: {} }
    for (const p of [c, k]) {
      p.eligible++
      for (const cat of new Set(b.categories)) p.byCategory[cat] = (p.byCategory[cat] ?? 0) + 1
    }
    cityMap.set(b.citySlug, c)
    countryMap.set(b.country, k)
  }
  return {
    cities: [...cityMap.values()].sort((a, b) => b.eligible - a.eligible || a.name.localeCompare(b.name)),
    countries: [...countryMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
    categories: categories.map((c) => ({ slug: c.slug, label: c.name, eligible: brands.filter((b) => eligible(b) && b.categories.includes(c.slug)).length })),
    minCohort: MIN_COHORT,
  }
}

/** GET /api/charts/scopes: places and categories with their eligible cohorts (memoised for a minute). */
export function getScopes(now = Date.now()): Promise<ChartScopesDto> {
  const s = chartsState()
  if (s.scopes && s.scopes.gen === s.gen && now - s.scopes.at < 60_000) return s.scopes.value
  const value = computeScopes(now)
  s.scopes = { at: now, gen: s.gen, value }
  value.catch(() => {
    if (s.scopes?.value === value) s.scopes = undefined
  })
  return value
}

/* ── A brand's best rank ─────────────────────────────────────────────────── */

const boardWords: Partial<Record<ChartKind, string>> = { top: "Top brands", trending: "Trending", emerging: "Emerging" }

/**
 * GET /api/charts/brand/{id}: the weekly Top brands, Trending, Emerging or City board where the
 * brand ranks 20th or better, in that order of preference. Unlisted brands get `{ sample: true }`.
 */
export async function getBrandBest(brandId: string, now = Date.now()): Promise<BrandRankDto> {
  const brands = await loadBrands()
  const row = brands.find((b) => b.id === brandId)
  if (!row || !listed(row)) return { sample: true }
  const tries: { kind: ChartKind; q: ChartQuery }[] = [
    { kind: "top", q: { chart: "top", period: "weekly" } },
    { kind: "trending", q: { chart: "trending", period: "weekly" } },
    { kind: "emerging", q: { chart: "emerging", period: "weekly" } },
    { kind: "city", q: { chart: "city", period: "weekly", city: row.citySlug } },
  ]
  for (const tr of tries) {
    const board = await getBoard(tr.q, now)
    const entry = board.state === "ok" ? board.entries.find((e) => e.brand.id === brandId) : undefined
    if (!entry || entry.rank > 20) continue
    const href = tr.kind === "city" ? `/charts?chart=city&period=weekly&city=${row.citySlug}` : `/charts?chart=${kindToSlug(tr.kind)}&period=weekly`
    const label = tr.kind === "city" ? `#${entry.rank} in ${cityName(row.citySlug, row.city) ?? row.city} this week` : `#${entry.rank} on ${boardWords[tr.kind]} this week`
    return { best: { chart: tr.kind, period: "weekly", scope: tr.kind === "city" ? `city:${row.citySlug}` : "global", rank: entry.rank, label, href }, sample: true }
  }
  return { sample: true }
}

