/**
 * YARD Charts ranking formula (§6.3), as pure functions.
 *
 * Plain Node: no `server-only`, no `@/` aliases, no I/O. `metrics.ts` turns the sample baseline
 * plus counted live signals into the inputs below; this file only scores and orders them, so the
 * whole formula is unit-tested by `score.test.ts` (`npm test`).
 */

/** The nine per-brand metrics over a window (§6.3 "Metrics per brand over W"). */
export type Metrics = {
  /** Orders, at most one per customer per day. */
  O: number
  /** GMV in USD cents. */
  G: number
  /** Net follows (counted follows minus counted unfollows). */
  F: number
  /** Net wishlist adds. */
  WL: number
  /** Product views plus storefront views. */
  V: number
  /** Drop reminders. */
  R: number
  /** Messages started plus post opens. */
  E: number
  /** Repeat customers ÷ customers; null when unknown. */
  RP: number | null
  /** Mean sell-through of the brand's drops live in W; null when there were none. */
  DS: number | null
}

export type BrandInput = {
  id: string
  /** 'YYYY-MM-DD'. */
  joinedAt: string
  /** Days from joining to the edition date. */
  ageDays: number
  followersBase: number
  /** Live net follows on top of followers_base (for the Most followed tie-break). */
  liveNetFollows: number
  /** The window W and the window before it (W⁻). */
  w: Metrics
  prev: Metrics
  /** Live events in W: excluded as fraud, and everything that counted (baseline included, see metrics.ts). */
  fraud: { excluded: number; counted: number }
}

export type BrandBoard = "top" | "trending" | "emerging" | "most_followed" | "most_wishlisted" | "city"

export type Scored = {
  id: string
  score: number
  /** Normalised inputs and factors, for Admin only (never in public DTOs). */
  components: Record<string, number>
  /** p(Ṽ), the first tie-break. */
  pV: number
}

/* ── Weights ─────────────────────────────────────────────────────────────── */

export const WEIGHTS = {
  top: { O: 0.18, G: 0.07, F: 0.15, rf: 0.15, V: 0.15, WL: 0.12, E: 0.08, DS: 0.05, RP: 0.05 },
  trending: { gF: 0.3, gV: 0.25, gWL: 0.2, gO: 0.15, gE: 0.1 },
  emerging: { rf: 0.35, gV: 0.25, WL: 0.2, O: 0.1, E: 0.1 },
  dropsReleased: { sellThrough: 0.4, R: 0.25, V: 0.2, velocity: 0.15 },
  dropsUpcoming: { R: 0.6, V: 0.4 },
} as const

/** The components that measure sales (orders, GMV and order momentum). */
export const SALES_KEYS: readonly string[] = ["O", "G", "gO"]
/** Sales never make up more than a quarter of a score, so no board ranks by sales alone. */
export const SALES_CAP = 0.25

export const EMERGING_MAX_FOLLOWERS = 30_000
export const EMERGING_MAX_AGE_DAYS = 548
export const BOOST = { top: 0.1, city: 0.1, trending: 0.2 } as const
export const MAX_ENTRIES = 50

/**
 * The weights actually applied when some metrics are missing for a brand: the remaining weights
 * renormalised to sum to 1, then the sales share capped at SALES_CAP (the excess goes back to the
 * other components in proportion), so a missing drop or repeat-rate never lets sales grow past it.
 */
export function effectiveWeights(weights: Record<string, number>, present: (key: string) => boolean): Record<string, number> {
  const keys = Object.keys(weights).filter(present)
  const total = keys.reduce((s, k) => s + weights[k], 0)
  if (!keys.length || total <= 0) return {}
  const out: Record<string, number> = {}
  for (const k of keys) out[k] = weights[k] / total
  const sales = keys.filter((k) => SALES_KEYS.includes(k)).reduce((s, k) => s + out[k], 0)
  const other = 1 - sales
  if (sales > SALES_CAP && other > 0) {
    for (const k of keys) out[k] *= SALES_KEYS.includes(k) ? SALES_CAP / sales : (1 - SALES_CAP) / other
  }
  return out
}

/** The sales share of a weight table (after effectiveWeights, or as written). */
export const salesShare = (weights: Record<string, number>) => Object.entries(weights).reduce((s, [k, v]) => s + (SALES_KEYS.includes(k) ? v : 0), 0)

/* ── Wishlist shoppers ──────────────────────────────────────────────────── */

/** One shopper's net wishlist change for a brand on one day (adds minus removes, any pieces). */
export type SaverRow = { actorId: string; day: string; net: number }

/**
 * Live WL over a window (§6.3 "Most wishlisted": unique shoppers adding the brand's pieces): the
 * shoppers whose adds outweigh their removes across [from, to]. One shopper saving every piece a
 * brand sells adds 1, and saving then removing adds 0.
 */
export function uniqueSavers(rows: readonly SaverRow[], from: string, to: string): number {
  const net = new Map<string, number>()
  for (const r of rows) if (r.day >= from && r.day <= to) net.set(r.actorId, (net.get(r.actorId) ?? 0) + r.net)
  let n = 0
  for (const v of net.values()) if (v > 0) n++
  return n
}

/* ── Transforms ──────────────────────────────────────────────────────────── */

/** ln(1+x) for counts; sign-preserving so a net loss (−3 follows) ranks below none. */
export const lg = (x: number) => (x >= 0 ? Math.log1p(x) : -Math.log1p(-x))

/** Relative follower growth: net follows over the follower base (at least 1,000). */
export const relFollowers = (F: number, followersBase: number) => F / Math.max(followersBase, 1000)

/** Momentum (x_W − x_W⁻)/(x_W⁻ + 10), clamped to [−1, 3]. */
export function momentum(x: number, prev: number) {
  const g = (x - prev) / (Math.max(prev, 0) + 10)
  return Math.max(-1, Math.min(3, g))
}

/**
 * Percentile ranks: (rank_asc − 1)/(n − 1) with ties averaged, 1 when n = 1. Missing values
 * (null) stay null and don't count towards n.
 */
export function percentiles(values: readonly (number | null)[]): (number | null)[] {
  const present = values.map((v, i) => ({ v, i })).filter((x): x is { v: number; i: number } => x.v !== null && Number.isFinite(x.v))
  const n = present.length
  const out: (number | null)[] = values.map(() => null)
  if (n === 0) return out
  if (n === 1) {
    out[present[0].i] = 1
    return out
  }
  present.sort((a, b) => a.v - b.v)
  let j = 0
  while (j < n) {
    let k = j
    while (k + 1 < n && present[k + 1].v === present[j].v) k++
    // Ranks j+1 … k+1 (1-based) share their average.
    const avgRank = (j + 1 + (k + 1)) / 2
    for (let m = j; m <= k; m++) out[present[m].i] = (avgRank - 1) / (n - 1)
    j = k + 1
  }
  return out
}

/** e_b: how "new and small" a brand is, in [0, 1]; 0 from 30k followers or after 548 days. */
export function emergingFactor(followersBase: number, ageDays: number) {
  if (ageDays > EMERGING_MAX_AGE_DAYS) return 0
  return Math.max(0, Math.min(1, 1 - followersBase / EMERGING_MAX_FOLLOWERS))
}

/** S' = S × (1 + β·e_b). β is 0.10 on Top and City, 0.20 on Trending, 0 elsewhere. */
export function boosted(score: number, board: BrandBoard, followersBase: number, ageDays: number) {
  const beta = board === "top" || board === "city" ? BOOST.top : board === "trending" ? BOOST.trending : 0
  return score * (1 + beta * emergingFactor(followersBase, ageDays))
}

/** Q_b = 1 − min(0.5, s_b): s_b is the share of W's signals excluded as fraud. */
export function qualityFactor(excluded: number, counted: number) {
  const total = excluded + counted
  const s = total > 0 ? excluded / total : 0
  return 1 - Math.min(0.5, s)
}

/** Board-specific eligibility on top of the shared rules (status, freeze, hold, scope). */
export function boardEligible(board: BrandBoard, b: BrandInput) {
  if (board === "top" || board === "city") return !(b.w.O === 0 && b.w.V < 10)
  if (board === "trending") return b.w.V >= 20
  if (board === "emerging") return b.followersBase < EMERGING_MAX_FOLLOWERS && b.ageDays <= EMERGING_MAX_AGE_DAYS
  return true
}

/* ── Scoring ─────────────────────────────────────────────────────────────── */

type Column = { key: string; values: (number | null)[] }

function weightedScore(table: Record<string, number>, cols: Column[], i: number, components: Record<string, number>) {
  const p = new Map<string, number | null>()
  for (const c of cols) p.set(c.key, c.values[i])
  const w = effectiveWeights(table, (k) => p.get(k) !== null && p.get(k) !== undefined)
  let s = 0
  for (const [k, wk] of Object.entries(w)) {
    const v = p.get(k) as number
    components[`p_${k}`] = round4(v)
    components[`w_${k}`] = round4(wk)
    s += wk * v
  }
  return s
}

const round4 = (x: number) => Math.round(x * 10_000) / 10_000

/** Ranks one brand board. Returns the eligible brands best first (all of them; callers keep MAX_ENTRIES). */
export function scoreBrands(board: BrandBoard, inputs: readonly BrandInput[]): Scored[] {
  const list = inputs.filter((b) => boardEligible(board, b))
  const pV = percentiles(list.map((b) => lg(b.w.V)))
  let scored: Scored[]

  if (board === "most_followed" || board === "most_wishlisted") {
    scored = list.map((b, i) => {
      const value = board === "most_followed" ? b.w.F : b.w.WL
      return { id: b.id, score: value, pV: pV[i] ?? 0, components: { value, totalFollowers: b.followersBase + b.liveNetFollows } }
    })
  } else {
    const cols: Column[] =
      board === "trending"
        ? [
            { key: "gF", values: percentiles(list.map((b) => momentum(b.w.F, b.prev.F))) },
            { key: "gV", values: percentiles(list.map((b) => momentum(b.w.V, b.prev.V))) },
            { key: "gWL", values: percentiles(list.map((b) => momentum(b.w.WL, b.prev.WL))) },
            { key: "gO", values: percentiles(list.map((b) => momentum(b.w.O, b.prev.O))) },
            { key: "gE", values: percentiles(list.map((b) => momentum(b.w.E, b.prev.E))) },
          ]
        : board === "emerging"
          ? [
              { key: "rf", values: percentiles(list.map((b) => relFollowers(b.w.F, b.followersBase))) },
              { key: "gV", values: percentiles(list.map((b) => momentum(b.w.V, b.prev.V))) },
              { key: "WL", values: percentiles(list.map((b) => lg(b.w.WL))) },
              { key: "O", values: percentiles(list.map((b) => lg(b.w.O))) },
              { key: "E", values: percentiles(list.map((b) => lg(b.w.E))) },
            ]
          : [
              { key: "O", values: percentiles(list.map((b) => lg(b.w.O))) },
              { key: "G", values: percentiles(list.map((b) => lg(b.w.G))) },
              { key: "F", values: percentiles(list.map((b) => lg(b.w.F))) },
              { key: "rf", values: percentiles(list.map((b) => relFollowers(b.w.F, b.followersBase))) },
              { key: "V", values: pV },
              { key: "WL", values: percentiles(list.map((b) => lg(b.w.WL))) },
              { key: "E", values: percentiles(list.map((b) => lg(b.w.E))) },
              { key: "DS", values: percentiles(list.map((b) => b.w.DS)) },
              { key: "RP", values: percentiles(list.map((b) => b.w.RP)) },
            ]
    const table: Record<string, number> = board === "trending" ? WEIGHTS.trending : board === "emerging" ? WEIGHTS.emerging : WEIGHTS.top
    scored = list.map((b, i) => {
      const components: Record<string, number> = {}
      const s = weightedScore(table, cols, i, components)
      const sBoost = boosted(s, board, b.followersBase, b.ageDays)
      const q = qualityFactor(b.fraud.excluded, b.fraud.counted)
      components.S = round4(s)
      components.boost = round4(sBoost / (s || 1))
      components.Q = round4(q)
      return { id: b.id, score: sBoost * q, pV: pV[i] ?? 0, components }
    })
  }

  const byId = new Map(list.map((b) => [b.id, b]))
  return scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (board === "most_followed") {
      const ta = a.components.totalFollowers ?? 0
      const tb = b.components.totalFollowers ?? 0
      if (tb !== ta) return tb - ta
    }
    return tieBreak(a, b, byId.get(a.id)!.joinedAt, byId.get(b.id)!.joinedAt)
  })
}

/** Higher p(Ṽ), then the earlier joined_at, then the id. */
export function tieBreak(a: { id: string; pV: number }, b: { id: string; pV: number }, joinedA: string, joinedB: string) {
  if (b.pV !== a.pV) return b.pV - a.pV
  if (joinedA !== joinedB) return joinedA < joinedB ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/* ── Top drops ───────────────────────────────────────────────────────────── */

export type DropInput = {
  id: string
  brandId: string
  joinedAt: string
  /** Released within W or live (released), or releasing within 7 days (upcoming). */
  phase: "released" | "upcoming"
  /** (totalUnits − unitsLeft) / totalUnits. */
  sellThrough: number
  /** Reminders for the drop in W. */
  R: number
  /** Product views of the drop's pieces in W. */
  V: number
  /** Units sold per hour since release. */
  velocity: number
}

export function scoreDrops(inputs: readonly DropInput[]): Scored[] {
  const pR = percentiles(inputs.map((d) => lg(d.R)))
  const pV = percentiles(inputs.map((d) => lg(d.V)))
  const released = inputs.map((d) => (d.phase === "released" ? lg(d.velocity) : null))
  const pVel = percentiles(released)
  const scored = inputs.map((d, i) => {
    const components: Record<string, number> = { p_R: round4(pR[i] ?? 0), p_V: round4(pV[i] ?? 0) }
    let score: number
    if (d.phase === "released") {
      const w = WEIGHTS.dropsReleased
      components.sellThrough = round4(d.sellThrough)
      components.p_velocity = round4(pVel[i] ?? 0)
      score = w.sellThrough * d.sellThrough + w.R * (pR[i] ?? 0) + w.V * (pV[i] ?? 0) + w.velocity * (pVel[i] ?? 0)
    } else {
      const w = WEIGHTS.dropsUpcoming
      score = w.R * (pR[i] ?? 0) + w.V * (pV[i] ?? 0)
    }
    return { id: d.id, score, pV: pV[i] ?? 0, components }
  })
  const byId = new Map(inputs.map((d) => [d.id, d]))
  return scored.sort((a, b) => (b.score !== a.score ? b.score - a.score : tieBreak(a, b, byId.get(a.id)!.joinedAt, byId.get(b.id)!.joinedAt)))
}

/* ── Movement ────────────────────────────────────────────────────────────── */

export type Movement = "up" | "down" | "same" | "new" | "reentry"

export type PrevEntry = { rank: number; peak: number; editionsOnChart: number }

/**
 * Movement against the edition one period earlier: up/down/same with delta (positive = climbed),
 * `reentry` when the subject was charted in an earlier edition (`lastSeen`) but not the previous
 * one, `new` when never. Peak and editions-on-chart carry from the edition they were last seen in.
 */
export function movementFor(rank: number, prev: PrevEntry | null, lastSeen: PrevEntry | null): { movement: Movement; delta: number; prevRank: number | null; peak: number; editionsOnChart: number } {
  if (prev) {
    const delta = prev.rank - rank
    return { movement: delta > 0 ? "up" : delta < 0 ? "down" : "same", delta, prevRank: prev.rank, peak: Math.min(prev.peak, rank), editionsOnChart: prev.editionsOnChart + 1 }
  }
  if (lastSeen) return { movement: "reentry", delta: 0, prevRank: null, peak: Math.min(lastSeen.peak, rank), editionsOnChart: lastSeen.editionsOnChart + 1 }
  return { movement: "new", delta: 0, prevRank: null, peak: rank, editionsOnChart: 1 }
}
