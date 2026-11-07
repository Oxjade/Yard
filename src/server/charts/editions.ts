import "server-only"
import { and, eq, inArray, sql } from "drizzle-orm"
import { db, t, withTx } from "../db"
import { newId } from "../ids"
import { addDays } from "./baseline"
import { brandInput, dropSubjects, PERIOD_DAYS, type DropSubject, type Period, type Universe, windows } from "./metrics"
import { eligibleBrands, MIN_COHORT, parseScope } from "./scope"
import { MAX_ENTRIES, movementFor, relFollowers, scoreBrands, scoreDrops, type BrandBoard, type BrandInput, type Movement, type PrevEntry } from "./score"

/**
 * Editions (§6.3 "Windows, editions and movement"): ranking a board for an edition date, the
 * movement against the edition one period earlier, and writing snapshots. The live edition is
 * today's (UTC); final editions close at 00:00 UTC (closeEditions in index.ts).
 */

export type ChartKind = "top" | "trending" | "emerging" | "most_followed" | "most_wishlisted" | "top_drops" | "city"
export const CHART_KINDS: ChartKind[] = ["top", "trending", "emerging", "most_followed", "most_wishlisted", "top_drops", "city"]
export const PERIODS: Period[] = ["daily", "weekly", "monthly"]

export type BoardKey = { chart: ChartKind; period: Period; scope: string }
export const boardKeyString = (k: BoardKey) => `${k.chart}:${k.period}:${k.scope}`

/** Public-safe display stat (§6.3 "Public stats"): never revenue or order counts. */
export type Stat = {
  /** The whole stat as one sentence (accessible text). */
  label: string
  /** The leading figure ("+1.2k", "82%"), counted up in the UI. */
  figure: string
  /** What the figure counts ("followers this week"). */
  caption: string
  /** A second, quieter figure ("3.4k saves"). */
  extra?: string
  value?: number
}

export type Ranked = {
  rank: number
  subjectType: "brand" | "drop"
  subjectId: string
  brandId: string
  score: number
  components: Record<string, number>
  stats: Stat
}

export type EditionEntry = Ranked & { prevRank: number | null; peak: number; editionsOnChart: number; movement: Movement; delta: number }

export type RankResult = { cohortSize: number; small: boolean; entries: Ranked[] }

/* ── Stats ───────────────────────────────────────────────────────────────── */

const phrase: Record<Period, string> = { daily: "today", weekly: "this week", monthly: "this month" }
const prevPhrase: Record<Period, string> = { daily: "yesterday", weekly: "last week", monthly: "last month" }

/** 840, 1.2k, 48.2k, 1.3M. */
export function compact(n: number) {
  const a = Math.abs(n)
  const sign = n < 0 ? "−" : ""
  if (a >= 1_000_000) return `${sign}${(a / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
  if (a >= 1000) return `${sign}${(a / 1000).toFixed(1).replace(/\.0$/, "")}k`
  return `${sign}${Math.round(a)}`
}
const signed = (n: number, f: (x: number) => string = compact) => (n > 0 ? `+${f(n)}` : n < 0 ? f(n) : "0")
/** "follower" for ±1, "followers" otherwise (likewise saves and views). */
const noun = (n: number, one: string, many: string) => (Math.abs(n) === 1 ? one : many)
const pct = (x: number) => {
  const p = x * 100
  const a = Math.abs(p)
  const s = a >= 10 ? Math.round(a).toString() : a >= 1 ? a.toFixed(0) : a.toFixed(1)
  return `${p > 0 ? "+" : p < 0 ? "−" : ""}${s}%`
}

/** A change as a share of what came before, when that is meaningful (null when there was nothing before). */
const relChange = (now: number, prev: number) => (prev > 0 ? (now - prev) / prev : null)
/** The smallest change worth printing as a percentage (anything less would read "+0.0%"). */
const MIN_PCT = 0.001

type Driver = { key: string; weight: number; stat: Stat }

/**
 * The component that did most for a brand's rank (weight × percentile, as scored), among those
 * that really rose: so the visible figure explains the position instead of contradicting it.
 */
function strongest(components: Record<string, number>, options: (Omit<Driver, "weight"> | null)[]): Stat | null {
  let best: Driver | null = null
  for (const o of options) {
    if (!o) continue
    const weight = (components[`w_${o.key}`] ?? 0) * (components[`p_${o.key}`] ?? 0)
    if (!best || weight > best.weight) best = { ...o, weight }
  }
  return best?.stat ?? null
}

function brandStat(chart: ChartKind, period: Period, b: BrandInput, components: Record<string, number> = {}): Stat {
  const p = phrase[period]
  const vs = prevPhrase[period]
  const follows = (): Stat => {
    const figure = signed(b.w.F)
    const word = noun(b.w.F, "follower", "followers")
    return { label: `${figure} ${word} ${p}`, figure, caption: `${word} ${p}`, value: b.w.F }
  }
  /** "Views +38% vs last week", only when it rose by at least 0.1 %. */
  const rose = (key: string, word: string, now: number, prev: number): Omit<Driver, "weight"> | null => {
    const change = relChange(now, prev)
    if (change !== null) {
      if (change < MIN_PCT) return null
      const figure = pct(change)
      return { key, stat: { label: `${word} ${figure} vs ${vs}`, figure, caption: `${word.toLowerCase()} vs ${vs}`, value: Math.round(change * 1000) / 10 } }
    }
    // Nothing the period before: the absolute gain says it better than a percentage could.
    if (now <= 0) return null
    const figure = signed(now)
    const what = word === "Follows" ? noun(now, "follower", "followers") : word === "Views" ? noun(now, "view", "views") : noun(now, "save", "saves")
    return { key, stat: { label: `${figure} ${what} ${p}`, figure, caption: `${what} ${p}`, value: now } }
  }
  switch (chart) {
    case "trending": {
      const s = strongest(components, [rose("gF", "Follows", b.w.F, b.prev.F), rose("gV", "Views", b.w.V, b.prev.V), rose("gWL", "Saves", b.w.WL, b.prev.WL)])
      if (s) return s
      if (b.w.F > 0) return follows()
      const change = relChange(b.w.V, b.prev.V) ?? 0
      const figure = pct(change)
      return { label: `Views ${figure} vs ${vs}`, figure, caption: `views vs ${vs}`, value: Math.round(change * 1000) / 10 }
    }
    case "emerging": {
      const rf = relFollowers(b.w.F, b.followersBase)
      const growth: Omit<Driver, "weight"> | null =
        rf >= MIN_PCT ? { key: "rf", stat: { label: `${pct(rf)} followers ${p}`, figure: pct(rf), caption: `followers ${p}`, value: Math.round(rf * 1000) / 10 } } : b.w.F > 0 ? { key: "rf", stat: follows() } : null
      const saves: Omit<Driver, "weight"> | null = b.w.WL > 0 ? { key: "WL", stat: { label: `${compact(b.w.WL)} ${noun(b.w.WL, "save", "saves")} ${p}`, figure: compact(b.w.WL), caption: `${noun(b.w.WL, "save", "saves")} ${p}`, value: b.w.WL } } : null
      return strongest(components, [growth, rose("gV", "Views", b.w.V, b.prev.V), saves]) ?? follows()
    }
    case "most_followed": {
      const total = b.followersBase + b.liveNetFollows
      const figure = signed(b.w.F, (x) => Math.abs(x).toLocaleString("en-US"))
      const word = noun(b.w.F, "follower", "followers")
      return { label: `${figure} ${word} ${p}, ${compact(total)} in total`, figure, caption: `${word} ${p}`, extra: `${compact(total)} in total`, value: b.w.F }
    }
    case "most_wishlisted": {
      const figure = compact(b.w.WL)
      const word = noun(b.w.WL, "save", "saves")
      return { label: `${figure} ${word} ${p}`, figure, caption: `${word} ${p}`, value: b.w.WL }
    }
    default: {
      const figure = signed(b.w.F)
      const word = noun(b.w.F, "follower", "followers")
      return { label: `${figure} ${word}, ${compact(b.w.WL)} ${noun(b.w.WL, "save", "saves")} ${p}`, figure, caption: `${word} ${p}`, extra: `${compact(b.w.WL)} ${noun(b.w.WL, "save", "saves")}`, value: b.w.F }
    }
  }
}

function dropStat(d: DropSubject): Stat {
  const sold = Math.round(d.sellThrough * 100)
  if (d.phase === "upcoming") {
    const figure = compact(d.reminders)
    return { label: `${figure} ${d.reminders === 1 ? "reminder" : "reminders"} set`, figure, caption: d.reminders === 1 ? "reminder set" : "reminders set", value: d.reminders }
  }
  if (d.status === "sold_out") return { label: "Sold out", figure: "Sold out", caption: "every piece is gone" }
  if (d.status === "live") return { label: `Sold ${sold}% in ${d.hoursSinceRelease} h`, figure: `${sold}%`, caption: `sold in ${d.hoursSinceRelease} h`, value: sold }
  return { label: `Sold ${sold}% of the run`, figure: `${sold}%`, caption: "of the run sold", value: sold }
}

/* ── Ranking ─────────────────────────────────────────────────────────────── */

/** Whether a board can exist for a scope (City charts need a city). */
export const boardFits = (chart: ChartKind, scope: string) => (chart === "city" ? parseScope(scope).city !== undefined : true)

/**
 * Ranks one board for one edition from a loaded universe. Scoped boards (and every City chart)
 * need MIN_COHORT eligible brands; below that the board is "small" and has no entries.
 */
export function rankBoard(u: Universe, key: BoardKey, edition: string): RankResult {
  const s = parseScope(key.scope)
  const brands = eligibleBrands(u, s, edition)
  const cohortSize = brands.length
  if ((key.scope !== "global" || key.chart === "city") && cohortSize < MIN_COHORT) return { cohortSize, small: true, entries: [] }

  if (key.chart === "top_drops") {
    const subjects = dropSubjects(u, new Set(brands.map((b) => b.id)), edition, key.period)
    const byId = new Map(subjects.map((d) => [d.id, d]))
    const ranked = scoreDrops(subjects).slice(0, MAX_ENTRIES)
    return {
      cohortSize,
      small: false,
      entries: ranked.map((r, i) => {
        const d = byId.get(r.id)!
        return { rank: i + 1, subjectType: "drop", subjectId: d.id, brandId: d.brandId, score: r.score, components: { ...r.components, R: d.R, V: d.V }, stats: dropStat(d) }
      }),
    }
  }

  const inputs = brands.map((b) => brandInput(u, b, edition, key.period))
  const byId = new Map(inputs.map((b) => [b.id, b]))
  const board: BrandBoard = key.chart
  const ranked = scoreBrands(board, inputs).slice(0, MAX_ENTRIES)
  return {
    cohortSize,
    small: false,
    entries: ranked.map((r, i) => {
      const b = byId.get(r.id)!
      return { rank: i + 1, subjectType: "brand", subjectId: b.id, brandId: b.id, score: r.score, components: { ...r.components, O: b.w.O, F: b.w.F, WL: b.w.WL, V: b.w.V, E: b.w.E }, stats: brandStat(key.chart, key.period, b, r.components) }
    }),
  }
}

/* ── Movement ────────────────────────────────────────────────────────────── */

/** The edition one period earlier, and the earlier editions a re-entry looks back to (8 period-spaced). */
export function priorDates(edition: string, period: Period) {
  const len = PERIOD_DAYS[period]
  return { prev: addDays(edition, -len), lookback: Array.from({ length: 7 }, (_, i) => addDays(edition, -len * (i + 2))) }
}

export type PriorIndex = (key: BoardKey, edition: string) => Map<string, PrevEntry> | undefined

export function withMovement(entries: Ranked[], key: BoardKey, edition: string, prior: PriorIndex): EditionEntry[] {
  const { prev, lookback } = priorDates(edition, key.period)
  const prevMap = prior(key, prev)
  const older = lookback.map((d) => prior(key, d))
  return entries.map((e) => {
    const p = prevMap?.get(e.subjectId) ?? null
    let lastSeen: PrevEntry | null = null
    if (!p) for (const m of older) if (m?.has(e.subjectId)) { lastSeen = m.get(e.subjectId)!; break }
    return { ...e, ...movementFor(e.rank, p, lastSeen) }
  })
}

/* ── Persistence ─────────────────────────────────────────────────────────── */

export type SnapshotWrite = { key: BoardKey; edition: string; status: "live" | "final"; cohortSize: number; computedAt: Date; entries: EditionEntry[] }

/**
 * Writes snapshots (replacing any row for the same board and edition) in the caller's or one short
 * transaction. A final edition always wins; a live write only ever replaces a live row, so a live
 * compute that finishes after midnight can never turn yesterday's closed edition back into a live
 * one or swap its entries.
 */
export async function writeSnapshots(list: SnapshotWrite[]) {
  if (!list.length) return
  await withTx(async () => {
    const d = await db()
    for (const status of ["final", "live"] as const) {
      const ofStatus = list.filter((s) => s.status === status)
      for (let i = 0; i < ofStatus.length; i += 200) {
        const chunk = ofStatus.slice(i, i + 200)
        const rows = chunk.map((s) => ({ id: newId("cs"), chart: s.key.chart, period: s.key.period, scope: s.key.scope, edition: s.edition, status: s.status, cohortSize: s.cohortSize, computedAt: s.computedAt }))
        const saved = await d
          .insert(t.chartSnapshots)
          .values(rows)
          .onConflictDoUpdate({
            target: [t.chartSnapshots.chart, t.chartSnapshots.period, t.chartSnapshots.scope, t.chartSnapshots.edition],
            set: { status: sqlExcluded("status"), cohortSize: sqlExcluded("cohort_size"), computedAt: sqlExcluded("computed_at") },
            ...(status === "live" ? { setWhere: sql`${t.chartSnapshots.status} = 'live'` } : {}),
          })
          // Only the rows inserted or updated come back, so a final the live write left alone keeps its entries.
          .returning({ id: t.chartSnapshots.id, chart: t.chartSnapshots.chart, period: t.chartSnapshots.period, scope: t.chartSnapshots.scope, edition: t.chartSnapshots.edition })
        if (!saved.length) continue
        const idOf = new Map(saved.map((r) => [`${r.chart}:${r.period}:${r.scope}:${r.edition}`, r.id]))
        await d.delete(t.chartEntries).where(inArray(t.chartEntries.snapshotId, saved.map((r) => r.id)))
        const entries = chunk.flatMap((s) => {
          const snapshotId = idOf.get(`${boardKeyString(s.key)}:${s.edition}`)
          if (!snapshotId) return []
          return s.entries.map((e) => ({
            snapshotId,
            rank: e.rank,
            subjectType: e.subjectType,
            subjectId: e.subjectId,
            brandId: e.brandId,
            score: e.score,
            prevRank: e.prevRank,
            peakRank: e.peak,
            editionsOnChart: e.editionsOnChart,
            movement: e.movement,
            delta: e.delta,
            stats: e.stats,
            components: e.components,
          }))
        })
        for (let j = 0; j < entries.length; j += 500) await d.insert(t.chartEntries).values(entries.slice(j, j + 500))
      }
    }
  })
}

const sqlExcluded = (column: string) => sql.raw(`excluded.${column}`)

/**
 * Final editions' entries for the given boards and dates, indexed for withMovement and history.
 * One query for any number of boards.
 */
export async function loadPrior(keys: BoardKey[], dates: string[], statuses: ("final" | "live")[] = ["final"]) {
  const index = new Map<string, Map<string, PrevEntry & { rank: number }>>()
  if (!keys.length || !dates.length) return index
  const d = await db()
  const charts = [...new Set(keys.map((k) => k.chart))]
  const periods = [...new Set(keys.map((k) => k.period))]
  const scopes = [...new Set(keys.map((k) => k.scope))]
  const rows = await d
    .select({
      chart: t.chartSnapshots.chart,
      period: t.chartSnapshots.period,
      scope: t.chartSnapshots.scope,
      edition: t.chartSnapshots.edition,
      subjectId: t.chartEntries.subjectId,
      rank: t.chartEntries.rank,
      peak: t.chartEntries.peakRank,
      editions: t.chartEntries.editionsOnChart,
    })
    .from(t.chartEntries)
    .innerJoin(t.chartSnapshots, eq(t.chartEntries.snapshotId, t.chartSnapshots.id))
    .where(and(inArray(t.chartSnapshots.chart, charts), inArray(t.chartSnapshots.period, periods), inArray(t.chartSnapshots.scope, scopes), inArray(t.chartSnapshots.edition, dates), inArray(t.chartSnapshots.status, statuses)))
  for (const r of rows) {
    const k = `${r.chart}:${r.period}:${r.scope}:${r.edition}`
    const m = index.get(k) ?? new Map()
    index.set(k, m)
    m.set(r.subjectId, { rank: r.rank, peak: r.peak, editionsOnChart: r.editions })
  }
  return index
}

export const priorFrom =
  (index: Map<string, Map<string, PrevEntry>>): PriorIndex =>
  (key, edition) =>
    index.get(`${boardKeyString(key)}:${edition}`)

/** Every date withMovement may read for an edition (prev + lookback), plus the 8 history days. */
export function datesNeeded(edition: string, periods: Period[]) {
  const out = new Set<string>()
  for (const p of periods) {
    const { prev, lookback } = priorDates(edition, p)
    out.add(prev)
    for (const x of lookback) out.add(x)
  }
  for (let i = 1; i <= 8; i++) out.add(addDays(edition, -i))
  return [...out]
}

/** The window an edition covers, for the DTO. */
export const editionWindow = (edition: string, period: Period) => {
  const w = windows(edition, period)
  return { from: w.from, to: w.to }
}

/* ── Backfill ────────────────────────────────────────────────────────────── */

/**
 * The boards that exist for a set of brands: global boards, and every scope (city, country,
 * category, city × category) with at least MIN_COHORT eligible brands on `edition`.
 */
export function activeKeys(u: Universe, edition: string, extraScopes: string[] = []): BoardKey[] {
  const scopes = new Set<string>(["global", ...extraScopes])
  const brands = eligibleBrands(u, {}, edition)
  const count = (pred: (b: (typeof brands)[number]) => boolean) => brands.filter(pred).length
  for (const b of brands) {
    if (count((x) => x.citySlug === b.citySlug) >= MIN_COHORT) scopes.add(`city:${b.citySlug}`)
    if (count((x) => x.country === b.country) >= MIN_COHORT) scopes.add(`country:${b.country}`)
    for (const c of b.categories) {
      if (count((x) => x.categories.includes(c)) >= MIN_COHORT) scopes.add(`category:${c}`)
      if (count((x) => x.citySlug === b.citySlug && x.categories.includes(c)) >= MIN_COHORT) scopes.add(`city:${b.citySlug}|category:${c}`)
    }
  }
  const keys: BoardKey[] = []
  for (const scope of scopes) for (const chart of CHART_KINDS) for (const period of PERIODS) if (boardFits(chart, scope)) keys.push({ chart, period, scope })
  return keys
}

/**
 * Computes final editions in date order from one loaded universe, carrying movement in memory
 * from one edition to the next. `plan` lists, per period, the dates to close.
 */
export function computeFinals(u: Universe, plan: Record<Period, string[]>, keysFor: (edition: string) => BoardKey[], seed: Map<string, Map<string, PrevEntry>> = new Map(), computedAt = new Date()) {
  const index = seed
  const out: SnapshotWrite[] = []
  const all = [...new Set(Object.values(plan).flat())].sort()
  for (const edition of all) {
    for (const key of keysFor(edition)) {
      if (!plan[key.period].includes(edition)) continue
      const r = rankBoard(u, key, edition)
      if (r.small) continue
      const entries = withMovement(r.entries, key, edition, priorFrom(index))
      index.set(`${boardKeyString(key)}:${edition}`, new Map(entries.map((e) => [e.subjectId, { rank: e.rank, peak: e.peak, editionsOnChart: e.editionsOnChart }])))
      out.push({ key, edition, status: "final", cohortSize: r.cohortSize, computedAt, entries })
    }
  }
  return out
}
