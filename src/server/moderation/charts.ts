import "server-only"
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm"
import { campaigns } from "@/lib/data/ads"
import { db, afterCommit } from "../db"
import { accountRestrictions, chartEntries, chartEvents, chartFlags, chartSnapshots } from "../db/schema"
import { getEnv } from "../env"
import { conflict, notFound } from "../http/errors"
import { newId } from "../ids"
import { chartBoardLabels, detectorLabel, type ChartFlagDetailDto, type ChartFlagDto, type ChartHoldDto, type ChartsOverviewDto, type FreezeDto, type SponsoredRowDto } from "@/lib/api/contracts/admin"
import { CHART_KINDS } from "@/lib/api/contracts/enums"
import { assertState, audit, brandMap, brandRefOf, dateLabel, iso, publishCountsAfterCommit, tryFeature, userMap, notify, type DecisionCtx } from "./shared"

/**
 * Admin › Charts (§6.3, §8.1): board health, flags, freezes (two-person rule) and the read-only
 * sponsored list. Flags are computed by C's detectors; this module only decides on them.
 */

const DAY = 86_400_000
const THRESHOLD = 0.05
const EXCLUDED = ["excluded_self", "excluded_restricted", "excluded_fraud", "excluded_anon"]
const dayStr = (d: Date) => d.toISOString().slice(0, 10)

/** Which signal kinds feed each board, for its excluded-signal share. */
const boardKinds: Record<string, string[] | null> = {
  top: null,
  trending: null,
  emerging: null,
  most_followed: ["follow", "unfollow"],
  most_wishlisted: ["wishlist_add", "wishlist_remove"],
  top_drops: ["reminder_set", "reminder_unset", "product_view"],
  city: null,
}

async function charts() {
  return import("../charts")
}

export async function chartsOverview(): Promise<ChartsOverviewDto> {
  const d = await db()
  const since = dayStr(new Date(Date.now() - 7 * DAY))
  const since30 = dayStr(new Date(Date.now() - 30 * DAY))
  const since14 = dayStr(new Date(Date.now() - 13 * DAY))

  const byKind = await d
    .select({ kind: chartEvents.kind, verdict: chartEvents.verdict, n: sql<number>`count(*)::int` })
    .from(chartEvents)
    .where(gte(chartEvents.day, since))
    .groupBy(chartEvents.kind, chartEvents.verdict)
  const daily = await d
    .select({ day: chartEvents.day, verdict: chartEvents.verdict, n: sql<number>`count(*)::int` })
    .from(chartEvents)
    .where(gte(chartEvents.day, since14))
    .groupBy(chartEvents.day, chartEvents.verdict)
  // The newest weekly edition of each board (global scope, or the largest city).
  const snaps = await d
    .select({ chart: chartSnapshots.chart, edition: chartSnapshots.edition, cohort: chartSnapshots.cohortSize, id: chartSnapshots.id, scope: chartSnapshots.scope })
    .from(chartSnapshots)
    .where(eq(chartSnapshots.period, "weekly"))
    .orderBy(desc(chartSnapshots.edition), desc(chartSnapshots.cohortSize))
  const openFlags = await d.select({ brandId: chartFlags.brandId }).from(chartFlags).where(eq(chartFlags.status, "open"))
  const flagged = new Set(openFlags.map((f) => f.brandId))
  const onBoard = flagged.size
    ? await d
        .selectDistinct({ chart: chartSnapshots.chart, brandId: chartEntries.brandId })
        .from(chartEntries)
        .innerJoin(chartSnapshots, eq(chartSnapshots.id, chartEntries.snapshotId))
        .where(and(gte(chartSnapshots.edition, since30), inArray(chartEntries.brandId, [...flagged])))
    : []

  const boards = CHART_KINDS.map((chart) => {
    const kinds = boardKinds[chart]
    const rows = byKind.filter((r) => !kinds || kinds.includes(r.kind))
    const total = rows.reduce((s, r) => s + Number(r.n), 0)
    const excluded = rows.filter((r) => EXCLUDED.includes(r.verdict)).reduce((s, r) => s + Number(r.n), 0)
    const latest = snaps.find((s) => s.chart === chart)
    return {
      chart,
      label: chartBoardLabels[chart] ?? chart,
      cohort: latest?.cohort ?? null,
      edition: latest?.edition ?? null,
      totalEvents: total,
      excludedEvents: excluded,
      excludedShare: total ? excluded / total : 0,
      openFlags: new Set(onBoard.filter((o) => o.chart === chart).map((o) => o.brandId)).size,
    }
  })

  const days: ChartsOverviewDto["daily"] = []
  for (let i = 13; i >= 0; i--) {
    const day = dayStr(new Date(Date.now() - i * DAY))
    const rows = daily.filter((r) => r.day === day)
    const total = rows.reduce((s, r) => s + Number(r.n), 0)
    const excluded = rows.filter((r) => EXCLUDED.includes(r.verdict)).reduce((s, r) => s + Number(r.n), 0)
    days.push({ date: day, total, excludedShare: total ? excluded / total : null, threshold: THRESHOLD })
  }

  const counted = byKind.filter((r) => r.verdict === "counted").reduce((s, r) => s + Number(r.n), 0)
  const all = byKind.reduce((s, r) => s + Number(r.n), 0)
  const topLatest = snaps.find((s) => s.chart === "top" && s.scope === "global")
  const organic = topLatest ? Number((await d.select({ n: sql<number>`count(*)::int` }).from(chartEntries).where(eq(chartEntries.snapshotId, topLatest.id)))[0]?.n ?? 0) : 0
  const sponsored = campaigns.filter((c) => c.type === "sponsored-brand" && c.status === "active").length
  const flagRows = await d.select({ status: chartFlags.status, severity: chartFlags.severity }).from(chartFlags)
  const freezes = await d.select({ status: accountRestrictions.status, until: accountRestrictions.until }).from(accountRestrictions).where(eq(accountRestrictions.kind, "charts_freeze"))

  return {
    boards,
    daily: days,
    threshold: THRESHOLD,
    verifiedShare: all ? counted / all : null,
    totals: { counted, excluded: all - counted - byKind.filter((r) => r.verdict === "deduped").reduce((s, r) => s + Number(r.n), 0), total: all },
    surface: { organic, sponsored },
    flags: {
      open: flagRows.filter((f) => f.status === "open").length,
      high: flagRows.filter((f) => f.status === "open" && f.severity === "high").length,
      frozen: freezes.filter(inForce).length,
      pendingFreeze: freezes.filter((f) => f.status === "pending_approval").length,
    },
    ipSignal: getEnv().trustedProxyHops > 0 ? "available" : "unavailable",
    proxyHops: getEnv().trustedProxyHops,
    orderSignals: "not_connected",
    holds: await chartHolds(),
    sample: true,
  }
}

const HELD = "held_from_charts"

/**
 * Brands held from every public board right now, with the flags holding each. This mirrors C's own
 * rule (charts/metrics.ts loadHolds: status open AND auto_action held_from_charts, any detector), so
 * the page can say exactly which flags must be cleared or confirmed before a brand returns.
 */
export async function chartHolds(): Promise<ChartHoldDto[]> {
  const d = await db()
  const rows = await d.select().from(chartFlags).where(and(eq(chartFlags.status, "open"), eq(chartFlags.autoAction, HELD))).orderBy(chartFlags.windowStart, chartFlags.createdAt)
  if (!rows.length) return []
  const brands = await brandMap(rows.map((f) => f.brandId))
  const frozen = new Set((await currentFreezes(rows.map((f) => f.brandId))).filter(inForce).map((z) => z.subjectId))
  const byBrand = new Map<string, typeof rows>()
  for (const f of rows) byBrand.set(f.brandId, [...(byBrand.get(f.brandId) ?? []), f])
  return [...byBrand.entries()]
    .map(([brandId, flags]) => ({
      brand: brandRefOf(brands, brandId),
      since: flags.reduce((m, f) => (f.windowStart < m ? f.windowStart : m), flags[0].windowStart),
      flags: flags.map((f) => ({ id: f.id, detector: f.detector, detectorLabel: detectorLabel(f.detector), windowStart: f.windowStart, windowEnd: f.windowEnd, excludedEvents: f.excludedEvents })),
      frozen: frozen.has(brandId),
    }))
    .sort((a, b) => a.brand.name.localeCompare(b.brand.name, "en"))
}

/** The ids in a coordinated_ring flag's evidence (`otherBrands`: the other brands the ring followed). */
function ringPeerIds(f: Pick<FlagRow, "detector" | "evidence">): string[] {
  if (f.detector !== "coordinated_ring") return []
  const v = (f.evidence as Record<string, unknown> | null)?.otherBrands
  return (typeof v === "string" ? v.split(/[\s,]+/) : Array.isArray(v) ? v : []).filter((x): x is string => typeof x === "string" && /^b_[a-z0-9_]+$/.test(x))
}

type RestrictionRow = typeof accountRestrictions.$inferSelect

/** An approved freeze whose `until` has passed: C's loadFrozen no longer applies it, so it isn't shown as frozen. */
const expired = (r: Pick<RestrictionRow, "status" | "until">, now = Date.now()) => r.status === "active" && !!r.until && r.until.getTime() <= now
/** In force on the boards right now (C's loadFrozen rule: active, and no `until` or a future one). */
const inForce = (r: Pick<RestrictionRow, "status" | "until">) => r.status === "active" && !expired(r)

async function freezeDtos(rows: RestrictionRow[]): Promise<FreezeDto[]> {
  const brands = await brandMap(rows.map((r) => r.subjectId))
  const people = await userMap(rows.flatMap((r) => [r.requestedBy, r.approvedBy]))
  return rows.map((r) => ({
    id: r.id,
    brand: brandRefOf(brands, r.subjectId),
    status: (expired(r) ? "expired" : r.status) as FreezeDto["status"],
    until: iso(r.until),
    reason: r.reason,
    requestedBy: { id: r.requestedBy, name: people.get(r.requestedBy)?.name ?? r.requestedBy },
    approvedBy: r.approvedBy ? { id: r.approvedBy, name: people.get(r.approvedBy)?.name ?? r.approvedBy } : null,
    createdAt: r.createdAt.toISOString(),
    liftedAt: iso(r.liftedAt),
  }))
}

/** Freezes waiting for a second admin or in force now (an expired one is neither). */
async function currentFreezes(brandIds?: string[]) {
  const d = await db()
  const rows = await d
    .select()
    .from(accountRestrictions)
    .where(and(eq(accountRestrictions.kind, "charts_freeze"), inArray(accountRestrictions.status, ["pending_approval", "active"]), brandIds ? inArray(accountRestrictions.subjectId, brandIds.length ? brandIds : ["-"]) : undefined))
    .orderBy(desc(accountRestrictions.createdAt))
  return rows.filter((r) => !expired(r))
}

type FlagRow = typeof chartFlags.$inferSelect

async function flagDtos(rows: FlagRow[]): Promise<ChartFlagDto[]> {
  const brands = await brandMap([...rows.map((f) => f.brandId), ...rows.flatMap(ringPeerIds)])
  const freezes = await freezeDtos(await currentFreezes(rows.map((f) => f.brandId)))
  // Every open flag that holds its brand: a brand stays off the boards while any one of them is open.
  const d = await db()
  const holding = rows.length
    ? await d
        .select({ id: chartFlags.id, brandId: chartFlags.brandId, detector: chartFlags.detector })
        .from(chartFlags)
        .where(and(eq(chartFlags.status, "open"), eq(chartFlags.autoAction, HELD), inArray(chartFlags.brandId, [...new Set(rows.map((f) => f.brandId))])))
    : []
  return rows.map((f) => ({
    id: f.id,
    brand: brandRefOf(brands, f.brandId),
    detector: f.detector,
    detectorLabel: detectorLabel(f.detector),
    severity: f.severity as ChartFlagDto["severity"],
    windowStart: f.windowStart,
    windowEnd: f.windowEnd,
    excludedEvents: f.excludedEvents,
    autoAction: f.autoAction as ChartFlagDto["autoAction"],
    status: f.status as ChartFlagDto["status"],
    decidedAt: iso(f.decidedAt),
    createdAt: f.createdAt.toISOString(),
    freeze: freezes.find((z) => z.brand.id === f.brandId) ?? null,
    hold: {
      holding: f.status === "open" && f.autoAction === HELD,
      others: holding.filter((h) => h.brandId === f.brandId && h.id !== f.id).map((h) => ({ id: h.id, detectorLabel: detectorLabel(h.detector) })),
    },
    ringPeers: ringPeerIds(f).map((id) => brandRefOf(brands, id)),
  }))
}

const sev = { high: 0, medium: 1, low: 2 } as Record<string, number>

export async function listFlags(status: "open" | "decided" | "frozen" | "all") {
  const d = await db()
  const rows = await d.select().from(chartFlags).orderBy(desc(chartFlags.createdAt)).limit(400)
  const pick = rows.filter((f) => status === "all" || (status === "open" ? f.status === "open" : status === "frozen" ? f.status === "frozen" : f.status === "cleared" || f.status === "confirmed"))
  const items = (await flagDtos(pick)).sort((a, b) => (sev[a.severity] ?? 3) - (sev[b.severity] ?? 3) || b.createdAt.localeCompare(a.createdAt))
  const allFreezes = await d.select().from(accountRestrictions).where(eq(accountRestrictions.kind, "charts_freeze")).orderBy(desc(accountRestrictions.createdAt)).limit(200)
  return {
    items,
    freezes: await freezeDtos(allFreezes),
    holds: await chartHolds(),
    counts: { open: rows.filter((f) => f.status === "open").length, decided: rows.filter((f) => f.status === "cleared" || f.status === "confirmed").length, frozen: allFreezes.filter((r) => r.status === "pending_approval" || inForce(r)).length },
  }
}

/** Evidence as label/value pairs: counts and ratios; anything IP-like cut to 8 characters. */
function evidencePairs(evidence: unknown, names: Map<string, { name: string }> = new Map()): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = []
  const label = (k: string) =>
    (k.charAt(0).toUpperCase() + k.slice(1))
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/_/g, " ")
      .toLowerCase()
      .replace(/\bips\b/g, "IPs")
      .replace(/\bip\b/g, "IP")
      .replace(/^./, (c) => c.toUpperCase())
  const isShare = (k: string) => /share|ratio|fraction|rate/i.test(k)
  const show = (k: string, v: unknown): string => {
    if (v == null) return "Not recorded"
    if (typeof v === "number") return isShare(k) && v >= 0 && v <= 1 ? `${(v * 100).toFixed(v === 1 || v === 0 ? 0 : 1)}%` : Number.isInteger(v) ? String(v) : v < 1 && v > 0 ? `${(v * 100).toFixed(1)}%` : v.toFixed(2)
    if (typeof v === "string") return /ip/i.test(k) ? v.slice(0, 8) : v.slice(0, 120)
    if (typeof v === "boolean") return v ? "Yes" : "No"
    if (Array.isArray(v)) return v.slice(0, 6).map((x) => show(k, x)).join(", ") + (v.length > 6 ? ` and ${v.length - 6} more` : "")
    if (typeof v === "object")
      return Object.entries(v as Record<string, unknown>)
        .slice(0, 6)
        .map(([kk, vv]) => `${/ip/i.test(k) ? kk.slice(0, 8) : kk}: ${show(kk, vv)}`)
        .join(", ")
    return String(v)
  }
  // A ring's other brands are stored as ids; the reviewer reads names.
  const brandNames = (v: unknown) => (typeof v === "string" ? v.split(/[\s,]+/).filter(Boolean).map((id) => names.get(id)?.name ?? id).join(", ") : show("otherBrands", v))
  if (evidence && typeof evidence === "object" && !Array.isArray(evidence)) for (const [k, v] of Object.entries(evidence)) out.push({ label: label(k), value: k === "otherBrands" ? brandNames(v) : show(k, v) })
  return out.slice(0, 20)
}

export async function flagDetail(id: string): Promise<ChartFlagDetailDto> {
  const d = await db()
  const f = await d.query.chartFlags.findFirst({ where: (x, { eq }) => eq(x.id, id) })
  if (!f) throw notFound()
  const [dto] = await flagDtos([f])
  const rows = await d
    .select({ chart: chartSnapshots.chart, period: chartSnapshots.period, scope: chartSnapshots.scope, edition: chartSnapshots.edition, rank: chartEntries.rank, components: chartEntries.components })
    .from(chartEntries)
    .innerJoin(chartSnapshots, eq(chartSnapshots.id, chartEntries.snapshotId))
    .where(eq(chartEntries.brandId, f.brandId))
    .orderBy(desc(chartSnapshots.edition))
    .limit(12)
  const nums = (c: unknown) => Object.fromEntries(Object.entries((c ?? {}) as Record<string, unknown>).filter(([, v]) => typeof v === "number")) as Record<string, number>
  const names = await brandMap(ringPeerIds(f))
  return { ...dto, evidence: evidencePairs(f.evidence, names), components: rows.map((r) => ({ ...r, components: nums(r.components) })) }
}

/** Sponsored placements are read-only here and never ranked (§6.3); sample campaigns in this build. */
export async function sponsoredList(): Promise<{ items: SponsoredRowDto[] }> {
  const rows = campaigns.filter((c) => c.type === "sponsored-brand")
  const brands = await brandMap(rows.map((c) => c.brandId))
  return { items: rows.map((c) => ({ campaignId: c.id, name: c.name, brand: brandRefOf(brands, c.brandId), status: c.status, placements: c.placements, sample: true })) }
}

/* ── Decisions ─────────────────────────────────────────────────────── */

/** decide-chart-flag: clear (re-includes its signals) or confirm (keeps them excluded, ends the hold). */
export async function decideChartFlag(ctx: DecisionCtx, body: { id: string; outcome: "clear" | "confirm"; reason: string }) {
  const d = await db()
  const f = await d.query.chartFlags.findFirst({ where: (x, { eq }) => eq(x.id, body.id) })
  if (!f) throw notFound()
  // Freezes leave flags open now. A flag an earlier build set to "frozen" can still be decided once
  // no freeze on its brand is in force, so it never stays undecidable.
  const decidable = f.status === "open" || (f.status === "frozen" && !(await currentFreezes([f.brandId])).some(inForce))
  assertState(decidable)
  const now = new Date()
  const [updated] = await d
    .update(chartFlags)
    .set({ status: body.outcome === "clear" ? "cleared" : "confirmed", decidedBy: ctx.actor.userId, decidedAt: now, decisionReason: body.reason })
    .where(and(eq(chartFlags.id, f.id), eq(chartFlags.status, f.status)))
    .returning()
  assertState(!!updated)
  let reincluded = 0
  if (body.outcome === "clear") {
    // Views count once per actor, item and day (a unique index): only one row per key comes back.
    const r = await d.execute(sql`
      update chart_events set verdict = 'counted' where seq in (
        select seq from chart_events where flag_id = ${f.id} and verdict = 'excluded_fraud' and kind not in ('product_view', 'storefront_view', 'post_open')
        union all
        select seq from (
          select distinct on (e.kind, e.brand_id, coalesce(e.product_id, ''), coalesce(e.drop_id, ''), e.actor_id, e.day) e.seq
          from chart_events e
          where e.flag_id = ${f.id} and e.verdict = 'excluded_fraud' and e.kind in ('product_view', 'storefront_view', 'post_open')
            and not exists (
              select 1 from chart_events o where o.verdict = 'counted' and o.kind = e.kind and o.brand_id = e.brand_id
                and coalesce(o.product_id, '') = coalesce(e.product_id, '') and coalesce(o.drop_id, '') = coalesce(e.drop_id, '')
                and o.actor_id = e.actor_id and o.day = e.day)
          order by e.kind, e.brand_id, coalesce(e.product_id, ''), coalesce(e.drop_id, ''), e.actor_id, e.day, e.seq
        ) v
      )`)
    reincluded = (r as { affectedRows?: number }).affectedRows ?? 0
  }
  const { invalidate } = await charts()
  await tryFeature("charts.invalidate", () => invalidate(f.brandId))
  const brands = await brandMap([f.brandId])
  const entry = await audit(ctx, {
    action: body.outcome === "clear" ? "chart_flag.cleared" : "chart_flag.confirmed",
    target: `${detectorLabel(f.detector)} on ${brandRefOf(brands, f.brandId).name}, ${f.windowStart} to ${f.windowEnd}`,
    subjectType: "chart_flag",
    subjectId: f.id,
    brandId: f.brandId,
    reason: body.reason,
    meta: { detector: f.detector, severity: f.severity, excludedEvents: f.excludedEvents, reincluded, from: f.status, autoAction: f.autoAction },
  })
  publishCountsAfterCommit()
  return { item: (await flagDtos([updated]))[0], audit: entry }
}

/** recompute-charts: drops the cached boards now; C's recompute (when it has one) runs after commit. */
export async function recomputeCharts(ctx: DecisionCtx, body: { id: string; reason: string }) {
  const brandId = body.id === "all" ? undefined : body.id
  if (brandId && !(await brandMap([brandId])).has(brandId)) throw notFound()
  const mod = await charts()
  await tryFeature("charts.invalidate", () => mod.invalidate(brandId))
  // C's recompute re-runs the detectors (DB work only); it runs after commit so the decision stays short.
  const recompute = (mod as unknown as { recompute?: () => Promise<unknown> }).recompute
  afterCommit(async () => {
    if (recompute) await tryFeature("charts.recompute", () => recompute())
  })
  const entry = await audit(ctx, { action: "charts.recomputed", target: brandId ? `Charts for ${brandId}` : "Every chart board", subjectType: "charts", subjectId: brandId ?? "all", brandId: brandId ?? null, reason: body.reason, meta: { recompute: recompute ? "requested" : "cache_dropped" } })
  return { item: { scope: body.id, recompute: recompute ? "requested" : "cache_dropped" }, audit: entry }
}

/** request-chart-freeze: a pending charts_freeze restriction that a second admin must approve. */
export async function requestChartFreeze(ctx: DecisionCtx, body: { id: string; days: 7 | 14 | 30; flagId?: string; reason: string }) {
  const d = await db()
  const brands = await brandMap([body.id])
  if (!brands.has(body.id)) throw notFound()
  if (body.flagId) {
    const f = await d.query.chartFlags.findFirst({ where: (x, { eq }) => eq(x.id, body.flagId!) })
    if (!f || f.brandId !== body.id) throw notFound("That flag isn't about this brand.")
  }
  const existing = await currentFreezes([body.id])
  assertState(!existing.length, existing[0]?.status === "pending_approval" ? "A freeze for this brand is already waiting for a second admin — refreshed." : "This brand is already frozen on Charts — refreshed.")
  const id = newId("rs")
  const until = new Date(Date.now() + body.days * DAY)
  const [row] = await d
    .insert(accountRestrictions)
    .values({ id, subjectKind: "brand", subjectId: body.id, kind: "charts_freeze", until, reason: body.reason, status: "pending_approval", requestedBy: ctx.actor.userId })
    .returning()
  const entry = await audit(ctx, {
    action: "chart.freeze_requested",
    target: `${brandRefOf(brands, body.id).name} on Charts for ${body.days} days`,
    subjectType: "brand",
    subjectId: body.id,
    brandId: body.id,
    reason: body.reason,
    meta: { restrictionId: id, flagId: body.flagId ?? null, days: body.days },
  })
  publishCountsAfterCommit()
  return { item: (await freezeDtos([row]))[0], audit: entry }
}

/** approve-chart-freeze: a different admin with charts.freeze (the two-person rule). */
export async function approveChartFreeze(ctx: DecisionCtx, body: { id: string; reason: string }) {
  const d = await db()
  const r = await d.query.accountRestrictions.findFirst({ where: (x, { and, eq }) => and(eq(x.id, body.id), eq(x.kind, "charts_freeze")) })
  if (!r) throw notFound()
  assertState(r.status === "pending_approval")
  if (r.requestedBy === ctx.actor.userId) throw conflict("Needs a second admin")
  const [row] = await d
    .update(accountRestrictions)
    .set({ status: "active", approvedBy: ctx.actor.userId })
    .where(and(eq(accountRestrictions.id, r.id), eq(accountRestrictions.status, "pending_approval")))
    .returning()
  assertState(!!row)
  // The brand's flags stay open: the freeze keeps it off every board on its own (C's loadFrozen), and
  // its open flags keep holding it after the freeze ends, until each is cleared or confirmed.
  const openFlags = (
    await d
      .select({ id: chartFlags.id })
      .from(chartFlags)
      .where(and(eq(chartFlags.brandId, r.subjectId), eq(chartFlags.status, "open"), eq(chartFlags.autoAction, HELD)))
  ).map((f) => f.id)
  const { invalidate } = await charts()
  await tryFeature("charts.invalidate", () => invalidate(r.subjectId))
  const brands = await brandMap([r.subjectId])
  const people = await userMap([r.requestedBy])
  const name = brandRefOf(brands, r.subjectId).name
  const entry = await audit(ctx, {
    action: "chart.freeze_approved",
    target: `${name} on Charts, requested by ${people.get(r.requestedBy)?.name ?? r.requestedBy}`,
    subjectType: "brand",
    subjectId: r.subjectId,
    brandId: r.subjectId,
    reason: body.reason,
    approvedBy: ctx.actor.name,
    meta: { restrictionId: r.id, requestedBy: r.requestedBy, openFlags },
  })
  // The brand hears that it's paused and until when; never the detector or the admins' reasons.
  await notify(
    { kind: "brand", id: r.subjectId },
    { key: `charts-freeze:${r.id}`, template: "brand.status", vars: { status: "paused", brand: `${name} on Yard Charts${r.until ? ` until ${dateLabel(r.until)}` : ""}`, reason: "unusual activity" }, href: "/studio/notifications" },
  )
  publishCountsAfterCommit()
  return { item: (await freezeDtos([row]))[0], audit: entry }
}

/** lift-chart-freeze: ends an active freeze, or withdraws one still waiting for approval. */
export async function liftChartFreeze(ctx: DecisionCtx, body: { id: string; reason: string }) {
  const d = await db()
  const r = await d.query.accountRestrictions.findFirst({ where: (x, { and, eq }) => and(eq(x.id, body.id), eq(x.kind, "charts_freeze")) })
  if (!r) throw notFound()
  assertState(r.status !== "lifted")
  const [row] = await d
    .update(accountRestrictions)
    .set({ status: "lifted", liftedAt: new Date(), liftedBy: ctx.actor.userId })
    .where(and(eq(accountRestrictions.id, r.id), inArray(accountRestrictions.status, ["pending_approval", "active"])))
    .returning()
  assertState(!!row)
  // An earlier build set the brand's open flags to "frozen" on approval; they're opened again here, so
  // they hold the brand until each is cleared or confirmed (approvals now leave flags open).
  const reopenedFlags = (
    await d
      .update(chartFlags)
      .set({ status: "open", decidedBy: null, decidedAt: null, decisionReason: null })
      .where(and(eq(chartFlags.brandId, r.subjectId), eq(chartFlags.status, "frozen")))
      .returning({ id: chartFlags.id })
  ).map((f) => f.id)
  const stillHolding = (await d.select({ id: chartFlags.id }).from(chartFlags).where(and(eq(chartFlags.brandId, r.subjectId), eq(chartFlags.status, "open"), eq(chartFlags.autoAction, HELD)))).length
  const { invalidate } = await charts()
  await tryFeature("charts.invalidate", () => invalidate(r.subjectId))
  const brands = await brandMap([r.subjectId])
  const name = brandRefOf(brands, r.subjectId).name
  const entry = await audit(ctx, {
    action: "chart.freeze_lifted",
    target: `${name} on Charts${r.status === "pending_approval" ? ", withdrawn before approval" : ""}`,
    subjectType: "brand",
    subjectId: r.subjectId,
    brandId: r.subjectId,
    reason: body.reason,
    meta: { restrictionId: r.id, was: expired(r) ? "expired" : r.status, reopenedFlags, stillHolding },
  })
  // A brand that open flags still hold stays off the boards, so it isn't told it's back.
  if (r.status === "active" && !expired(r) && !stillHolding)
    await notify({ kind: "brand", id: r.subjectId }, { key: `charts-freeze:${r.id}`, template: "brand.status", vars: { status: "resumed", brand: `${name} on Yard Charts`, reason: "the review is finished" }, href: "/charts" })
  publishCountsAfterCommit()
  return { item: (await freezeDtos([row]))[0], audit: entry }
}
