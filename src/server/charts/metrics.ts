import "server-only"
import { and, eq, gte, inArray, isNull, lte, or, gt, sql } from "drizzle-orm"
import { brandById } from "@/lib/data/brands"
import { drops } from "@/lib/data/catalog"
import { products } from "@/lib/data/products"
import type { Drop } from "@/lib/data/types"
import { db, t } from "../db"
import { refusedSampleBrand } from "../catalog/sample-guard"
import { addDays, dayStart, dayTotal, dropAnchor, dropTimes, emptyDay, repeatRate, sampleDaily, type DayCounts } from "./baseline"
import { uniqueSavers, type BrandInput, type DropInput, type Metrics, type SaverRow } from "./score"

/**
 * Metrics per brand over a window (§6.3): the sample baseline plus counted live signals. In this
 * build O and G come from the baseline only: no order signal is emitted until a payment
 * confirmation path exists, so live order events never appear.
 */

export type BrandRow = {
  id: string
  handle: string
  name: string
  city: string
  citySlug: string
  country: string
  categories: string[]
  reviewStatus: string
  joinedAt: string
  followersBase: number
}

/** Everything a board needs, loaded once for a date range and reused by every board in it. */
export type Universe = {
  from: string
  to: string
  brands: BrandRow[]
  /** brand → day → baseline + counted live signals (live wishlist events are kept apart, in `savers`). */
  days: Map<string, Map<string, DayCounts>>
  /** brand → per shopper and day, the net of counted live wishlist adds and removes (WL counts shoppers, not pieces). */
  savers: Map<string, SaverRow[]>
  /** brand → day → counted live wishlist events (for Q_b's denominator). */
  saverEvents: Map<string, Map<string, number>>
  /** brand → day → live events counted and excluded as fraud. */
  live: Map<string, Map<string, { counted: number; fraud: number }>>
  /** brand → all-time live net follows (counted follows − counted unfollows). */
  liveNetFollows: Map<string, number>
  /** drop → day → counted live reminders and views of its pieces. */
  dropLive: Map<string, Map<string, { R: number; V: number }>>
  /** brand → the first edition date its open high flag holds it from. */
  holds: Map<string, string>
  /** brands with an active charts_freeze. */
  frozen: Set<string>
  /** The newest chart event seq when this was loaded (a newer one means a board may be stale). */
  maxSeq: number
  /** Where the sample drops are placed from (see dropAnchor). */
  anchor: number
  /** "now" for drop phases on the live edition. */
  now: number
}

const DAY = 86_400_000

/** `brandListed` (§2.2) for a row. */
/** Listed on the charts: not restricted or suspended, and (production) never a sample brand, even from a demo-seeded database. */
export const listed = (b: { id?: string; reviewStatus: string }) => b.reviewStatus !== "restricted" && b.reviewStatus !== "suspended" && !refusedSampleBrand(b.id)

export async function loadBrands(): Promise<BrandRow[]> {
  const d = await db()
  const rows = await d.select().from(t.brands)
  return rows.map((r) => ({
    id: r.id,
    handle: r.handle,
    name: r.name,
    city: r.city,
    citySlug: r.citySlug,
    country: r.country,
    categories: r.categories,
    reviewStatus: r.reviewStatus,
    joinedAt: r.joinedAt ?? "2026-01-01",
    followersBase: r.followersBase,
  }))
}

/** Open high-severity flags hold a brand from public boards from the day the activity began. */
export async function loadHolds(): Promise<Map<string, string>> {
  const d = await db()
  const rows = await d
    .select({ brandId: t.chartFlags.brandId, from: sql<string>`min(${t.chartFlags.windowStart})::text` })
    .from(t.chartFlags)
    .where(and(eq(t.chartFlags.status, "open"), eq(t.chartFlags.autoAction, "held_from_charts")))
    .groupBy(t.chartFlags.brandId)
  return new Map(rows.map((r) => [r.brandId, r.from]))
}

export async function loadFrozen(now = new Date()): Promise<Set<string>> {
  const d = await db()
  const rows = await d
    .select({ id: t.accountRestrictions.subjectId })
    .from(t.accountRestrictions)
    .where(
      and(
        eq(t.accountRestrictions.subjectKind, "brand"),
        eq(t.accountRestrictions.kind, "charts_freeze"),
        eq(t.accountRestrictions.status, "active"),
        or(isNull(t.accountRestrictions.until), gt(t.accountRestrictions.until, now)),
      ),
    )
  return new Set(rows.map((r) => r.id))
}

/**
 * A cheap signature of what the boards count: the newest counted chart event. Only a counted
 * signal can move a board, so stored-but-uncounted traffic (anonymous, deduped, self, restricted)
 * never makes a cached board stale. The primary key on seq answers it backwards from the newest
 * row. Verdict changes (detectors, Admin's clear, dev resets) drop the caches themselves.
 */
export async function maxEventSeq(): Promise<number> {
  const d = await db()
  const [row] = await d.select({ m: sql<number | null>`max(${t.chartEvents.seq})` }).from(t.chartEvents).where(eq(t.chartEvents.verdict, "counted"))
  return Number(row?.m ?? 0)
}

/** Brands with published, visible social posts (post opens only exist for them). */
async function brandsWithPosts(): Promise<Set<string>> {
  const d = await db()
  const rows = await d
    .selectDistinct({ id: t.socialPosts.brandId })
    .from(t.socialPosts)
    .where(and(eq(t.socialPosts.visibility, "published"), eq(t.socialPosts.moderationStatus, "ok")))
  return new Set(rows.map((r) => r.id))
}

const dropProducts = new Map(drops.map((d) => [d.id, new Set(d.productIds)]))
const productDrop = new Map<string, string>()
for (const d of drops) for (const p of d.productIds) productDrop.set(p, d.id)

/** Loads baseline + live signals for every brand over [from, to]. */
export async function loadUniverse(from: string, to: string, opts: { now?: number; anchor?: number } = {}): Promise<Universe> {
  const now = opts.now ?? Date.now()
  const anchor = opts.anchor ?? dropAnchor(now)
  const d = await db()
  const [brands, posts, holds, frozen, maxSeq] = [await loadBrands(), await brandsWithPosts(), await loadHolds(), await loadFrozen(new Date(now)), await maxEventSeq()]

  const days = new Map<string, Map<string, DayCounts>>()
  const dayList: string[] = []
  for (let x = from; x <= to; x = addDays(x, 1)) dayList.push(x)
  for (const b of brands) {
    const m = new Map<string, DayCounts>()
    const hasPosts = posts.has(b.id)
    for (const day of dayList) m.set(day, sampleDaily(b.id, day, { hasPosts, anchor }))
    days.set(b.id, m)
  }

  // Live signals: counted ones add to the day; excluded-as-fraud ones only feed Q_b.
  const agg = await d
    .select({
      brandId: t.chartEvents.brandId,
      day: sql<string>`${t.chartEvents.day}::text`,
      kind: t.chartEvents.kind,
      verdict: t.chartEvents.verdict,
      n: sql<number>`count(*)::int`,
      actors: sql<number>`count(distinct ${t.chartEvents.actorId})::int`,
      value: sql<number>`coalesce(sum(${t.chartEvents.valueMinor}), 0)::int`,
    })
    .from(t.chartEvents)
    .where(and(gte(t.chartEvents.day, from), lte(t.chartEvents.day, to), inArray(t.chartEvents.verdict, ["counted", "excluded_fraud"])))
    .groupBy(t.chartEvents.brandId, t.chartEvents.day, t.chartEvents.kind, t.chartEvents.verdict)
  const live = new Map<string, Map<string, { counted: number; fraud: number }>>()
  const saverEvents = new Map<string, Map<string, number>>()
  for (const r of agg) {
    const lm = live.get(r.brandId) ?? new Map()
    live.set(r.brandId, lm)
    const slot = lm.get(r.day) ?? { counted: 0, fraud: 0 }
    lm.set(r.day, slot)
    if (r.verdict === "excluded_fraud") {
      slot.fraud += r.n
      continue
    }
    slot.counted += r.n
    const day = days.get(r.brandId)?.get(r.day)
    if (!day) continue
    if (r.kind === "wishlist_add" || r.kind === "wishlist_remove") {
      // Counted per shopper below (one shopper saving eight pieces is one shopper).
      const m = saverEvents.get(r.brandId) ?? new Map<string, number>()
      saverEvents.set(r.brandId, m)
      m.set(r.day, (m.get(r.day) ?? 0) + r.n)
    } else if (r.kind === "order_placed") {
      // At most one order per customer per day.
      day.order_placed += r.actors
      day.order_value += r.value
    } else if (r.kind === "order_cancelled") {
      // Cancellations take the order back out of O and G when a payment path emits them.
      day.order_placed = Math.max(0, day.order_placed - r.actors)
    } else if (r.kind in day) {
      day[r.kind as keyof DayCounts] += r.n
    }
  }

  // Wishlist nets per shopper and day: WL is the number of shoppers whose saves outweigh their removals in W.
  const saverRows = await d
    .select({
      brandId: t.chartEvents.brandId,
      actorId: t.chartEvents.actorId,
      day: sql<string>`${t.chartEvents.day}::text`,
      net: sql<number>`(count(*) filter (where ${t.chartEvents.kind} = 'wishlist_add') - count(*) filter (where ${t.chartEvents.kind} = 'wishlist_remove'))::int`,
    })
    .from(t.chartEvents)
    .where(and(gte(t.chartEvents.day, from), lte(t.chartEvents.day, to), eq(t.chartEvents.verdict, "counted"), inArray(t.chartEvents.kind, ["wishlist_add", "wishlist_remove"])))
    .groupBy(t.chartEvents.brandId, t.chartEvents.actorId, t.chartEvents.day)
  const savers = new Map<string, SaverRow[]>()
  for (const r of saverRows) {
    const list = savers.get(r.brandId) ?? []
    savers.set(r.brandId, list)
    list.push({ actorId: r.actorId, day: r.day, net: r.net })
  }

  // Per-drop live reminders and views of the drop's pieces.
  const dropAgg = await d
    .select({
      dropId: t.chartEvents.dropId,
      productId: t.chartEvents.productId,
      day: sql<string>`${t.chartEvents.day}::text`,
      kind: t.chartEvents.kind,
      n: sql<number>`count(*)::int`,
    })
    .from(t.chartEvents)
    .where(and(gte(t.chartEvents.day, from), lte(t.chartEvents.day, to), eq(t.chartEvents.verdict, "counted"), inArray(t.chartEvents.kind, ["reminder_set", "reminder_unset", "product_view"])))
    .groupBy(t.chartEvents.dropId, t.chartEvents.productId, t.chartEvents.day, t.chartEvents.kind)
  const dropLive = new Map<string, Map<string, { R: number; V: number }>>()
  for (const r of dropAgg) {
    const dropId = r.dropId ?? (r.productId ? productDrop.get(r.productId) : undefined)
    if (!dropId) continue
    const m = dropLive.get(dropId) ?? new Map()
    dropLive.set(dropId, m)
    const slot = m.get(r.day) ?? { R: 0, V: 0 }
    m.set(r.day, slot)
    if (r.kind === "product_view") slot.V += r.n
    else slot.R += r.kind === "reminder_set" ? r.n : -r.n
  }

  const nets = await d
    .select({ brandId: t.chartEvents.brandId, net: sql<number>`(count(*) filter (where ${t.chartEvents.kind} = 'follow') - count(*) filter (where ${t.chartEvents.kind} = 'unfollow'))::int` })
    .from(t.chartEvents)
    .where(and(eq(t.chartEvents.verdict, "counted"), inArray(t.chartEvents.kind, ["follow", "unfollow"])))
    .groupBy(t.chartEvents.brandId)
  const liveNetFollows = new Map(nets.map((r) => [r.brandId, r.net]))

  return { from, to, brands, days, savers, saverEvents, live, liveNetFollows, dropLive, holds, frozen, maxSeq, anchor, now }
}

/* ── Windows ─────────────────────────────────────────────────────────────── */

export type Period = "daily" | "weekly" | "monthly"
export const PERIOD_DAYS: Record<Period, number> = { daily: 1, weekly: 7, monthly: 30 }

/** W ends at the edition date (inclusive); W⁻ is the window before it. */
export function windows(edition: string, period: Period) {
  const len = PERIOD_DAYS[period]
  return { from: addDays(edition, -len + 1), to: edition, prevFrom: addDays(edition, -2 * len + 1), prevTo: addDays(edition, -len) }
}

function sumDays(u: Universe, brandId: string, from: string, to: string): DayCounts {
  const out = emptyDay()
  const m = u.days.get(brandId)
  if (!m) return out
  for (let x = from; x <= to; x = addDays(x, 1)) {
    const c = m.get(x)
    if (!c) continue
    for (const k of Object.keys(out) as (keyof DayCounts)[]) out[k] += c[k]
  }
  return out
}

/** The brand's drops that were live (released and not ended) at any point in [from, to]. */
function dropsLiveIn(brandId: string, from: string, to: string, anchor: number) {
  const a = dayStart(from)
  const b = dayStart(to) + DAY
  const times = dropTimes(anchor)
  return drops.filter((dr) => {
    if (dr.brandId !== brandId) return false
    const { release, end } = times.get(dr.id)!
    return release < b && end > a
  })
}

export const sellThrough = (dr: Drop) => (dr.totalUnits > 0 ? (dr.totalUnits - dr.unitsLeft) / dr.totalUnits : 0)

export function metricsFor(u: Universe, brandId: string, from: string, to: string): Metrics {
  const c = sumDays(u, brandId, from, to)
  const live = dropsLiveIn(brandId, from, to, u.anchor)
  return {
    O: c.order_placed,
    G: c.order_value,
    F: c.follow - c.unfollow,
    // The baseline's saves (each a sample shopper) plus the live shoppers who saved in W.
    WL: c.wishlist_add - c.wishlist_remove + uniqueSavers(u.savers.get(brandId) ?? [], from, to),
    V: c.product_view + c.storefront_view,
    R: c.reminder_set - c.reminder_unset,
    E: c.message_started + c.post_open,
    RP: repeatRate(brandId),
    DS: live.length ? live.reduce((s, dr) => s + sellThrough(dr), 0) / live.length : null,
  }
}

/** Live events excluded as fraud in W, against everything that counted (baseline signals included). */
function fraudIn(u: Universe, brandId: string, from: string, to: string) {
  let excluded = 0
  let counted = dayTotal(sumDays(u, brandId, from, to))
  const sv = u.saverEvents.get(brandId)
  if (sv) for (const [day, n] of sv) if (day >= from && day <= to) counted += n
  const m = u.live.get(brandId)
  if (m) for (const [day, s] of m) if (day >= from && day <= to) excluded += s.fraud
  // `days` already holds counted live signals, so `counted` covers baseline + live.
  return { excluded, counted: Math.max(counted, 0) }
}

const ageDays = (joinedAt: string, edition: string) => Math.round((dayStart(edition) - dayStart(joinedAt)) / DAY)

export function brandInput(u: Universe, b: BrandRow, edition: string, period: Period): BrandInput {
  const w = windows(edition, period)
  return {
    id: b.id,
    joinedAt: b.joinedAt,
    ageDays: ageDays(b.joinedAt, edition),
    followersBase: b.followersBase,
    liveNetFollows: u.liveNetFollows.get(b.id) ?? 0,
    w: metricsFor(u, b.id, w.from, w.to),
    prev: metricsFor(u, b.id, w.prevFrom, w.prevTo),
    fraud: fraudIn(u, b.id, w.from, w.to),
  }
}

/* ── Drops ───────────────────────────────────────────────────────────────── */

export type DropStatus = "live" | "sold_out" | "upcoming" | "ended"

export type DropSubject = DropInput & { drop: Drop; status: DropStatus; release: number; hoursSinceRelease: number; reminders: number }

/** The instant an edition is "as of": the end of its day, or now for today's live edition. */
export const asOfFor = (u: Universe, edition: string) => Math.min(u.now, dayStart(edition) + DAY)

export function dropStatus(dr: Drop, asOf: number, anchor: number): DropStatus {
  const { release, end } = dropTimes(anchor).get(dr.id)!
  if (asOf < release) return "upcoming"
  if (dr.unitsLeft <= 0) return "sold_out"
  if (asOf < end) return "live"
  return "ended"
}

/**
 * Top drops subjects for an edition: drops released within W, live, or releasing within 7 days,
 * of the given brands. Reminders and views come from the brand's baseline (shared between its
 * drops in play that day) plus counted live signals on the drop.
 */
export function dropSubjects(u: Universe, brandIds: Set<string>, edition: string, period: Period): DropSubject[] {
  const w = windows(edition, period)
  const asOf = asOfFor(u, edition)
  const wFrom = dayStart(w.from)
  const out: DropSubject[] = []
  const times = dropTimes(u.anchor)
  for (const dr of drops) {
    if (!brandIds.has(dr.brandId)) continue
    const { release, end } = times.get(dr.id)!
    const released = release <= asOf && (release >= wFrom || asOf < end)
    const upcoming = release > asOf && release <= asOf + 7 * DAY
    if (!released && !upcoming) continue
    let R = 0
    let V = 0
    const brandPieces = Math.max(1, products.filter((p) => p.brandId === dr.brandId && p.status === "published").length)
    for (let x = w.from; x <= w.to; x = addDays(x, 1)) {
      const base = u.days.get(dr.brandId)?.get(x)
      if (base) {
        // The brand's reminders that day belong to its drops releasing within the next 7 days.
        const from = dayStart(x)
        const soon = drops.filter((o) => o.brandId === dr.brandId && times.get(o.id)!.release > from && times.get(o.id)!.release <= from + 7 * DAY)
        if (soon.some((o) => o.id === dr.id)) R += base.reminder_set / soon.length
        V += (base.product_view * (dropProducts.get(dr.id)?.size ?? 1)) / brandPieces
      }
      const l = u.dropLive.get(dr.id)?.get(x)
      if (l) {
        R += l.R
        V += l.V
      }
    }
    const hours = Math.max(1, (Math.min(asOf, end) - release) / 3_600_000)
    const sold = dr.totalUnits - dr.unitsLeft
    const brand = brandById.get(dr.brandId)
    out.push({
      id: dr.id,
      brandId: dr.brandId,
      joinedAt: brand?.joinedAt.slice(0, 10) ?? "2026-01-01",
      phase: released ? "released" : "upcoming",
      sellThrough: released ? sellThrough(dr) : 0,
      R: Math.round(R),
      V: Math.round(V),
      velocity: released ? sold / hours : 0,
      drop: dr,
      status: dropStatus(dr, asOf, u.anchor),
      release,
      hoursSinceRelease: released ? Math.round((Math.min(asOf, end) - release) / 3_600_000) : 0,
      reminders: Math.round(R),
    })
  }
  return out
}
