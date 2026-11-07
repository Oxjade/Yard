import "server-only"
import { and, eq, gte, inArray, sql } from "drizzle-orm"
import { brandById } from "@/lib/data/brands"
import { detectorLabel } from "@/lib/api/contracts/admin"
import { afterCommit, db, t, withTx } from "../db"
import { getEnv } from "../env"
import { newId } from "../ids"
import { log } from "../log"
import { notifyAdmins } from "../notify"
import { addDays, todayUtc } from "./baseline"
import { dropCaches } from "./public"
import { detectAll, type ChartEvent, type Detection } from "./detect"

/**
 * Anti-fraud (§6.3): runs every detector over the last 30 days of events and upserts chart_flags
 * keyed (brand, detector, window_start). Low: listed for Admin only. Medium: the matching events
 * become excluded_fraud (auto_action excluded_signals), which also lowers Q_b. High: the same,
 * plus held_from_charts, which hides the brand from public boards until an admin decides; the
 * admins who review charts are notified. A flag an admin already decided is never reopened.
 */

const LOOKBACK_DAYS = 30
const autoActionFor = (s: Detection["severity"]) => (s === "high" ? "held_from_charts" : s === "medium" ? "excluded_signals" : "none")

async function loadEvents(from: string): Promise<ChartEvent[]> {
  const d = await db()
  const rows = await d
    .select({
      seq: t.chartEvents.seq,
      brandId: t.chartEvents.brandId,
      productId: t.chartEvents.productId,
      dropId: t.chartEvents.dropId,
      kind: t.chartEvents.kind,
      actorId: t.chartEvents.actorId,
      accountAgeDays: t.chartEvents.accountAgeDays,
      ipHash: t.chartEvents.ipHash,
      day: sql<string>`${t.chartEvents.day}::text`,
      at: t.chartEvents.createdAt,
      verdict: t.chartEvents.verdict,
    })
    .from(t.chartEvents)
    .where(and(gte(t.chartEvents.day, from), inArray(t.chartEvents.verdict, ["counted", "excluded_fraud", "excluded_self"])))
  return rows.map((r) => ({ ...r, at: r.at.getTime() }))
}

export type FlagRefresh = { flags: number; created: number; excluded: number; held: string[] }

/** Runs the detectors and applies their automatic actions in one short transaction (no I/O inside). */
export async function refreshFlags(now = Date.now()): Promise<FlagRefresh> {
  const today = todayUtc(now)
  const from = addDays(today, -(LOOKBACK_DAYS - 1))
  const days: string[] = []
  for (let x = from; x <= today; x = addDays(x, 1)) days.push(x)
  const events = await loadEvents(from)
  const found = detectAll(events, days, { ipKnown: getEnv().trustedProxyHops > 0 })
  if (!found.length) return { flags: 0, created: 0, excluded: 0, held: [] }

  return withTx(async () => {
    const d = await db()
    let created = 0
    let excluded = 0
    const held: string[] = []
    for (const f of found) {
      const [existing] = await d
        .select()
        .from(t.chartFlags)
        .where(and(eq(t.chartFlags.brandId, f.brandId), eq(t.chartFlags.detector, f.detector), eq(t.chartFlags.windowStart, f.windowStart)))
        .limit(1)
      // An admin decided this one (cleared, confirmed or frozen): leave it and its events alone.
      if (existing && existing.status !== "open") continue
      const severity = existing && rankOf(existing.severity) > rankOf(f.severity) ? (existing.severity as Detection["severity"]) : f.severity
      const autoAction = autoActionFor(severity)
      let id = existing?.id
      if (!existing) {
        id = newId("cf")
        await d.insert(t.chartFlags).values({ id, brandId: f.brandId, detector: f.detector, severity, windowStart: f.windowStart, windowEnd: f.windowEnd, evidence: f.evidence, autoAction, status: "open" })
        created++
      } else {
        await d.update(t.chartFlags).set({ severity, windowEnd: f.windowEnd > existing.windowEnd ? f.windowEnd : existing.windowEnd, evidence: f.evidence, autoAction }).where(eq(t.chartFlags.id, existing.id))
      }
      if (autoAction !== "none" && f.eventSeqs.length) {
        const changed = await d
          .update(t.chartEvents)
          .set({ verdict: "excluded_fraud", flagId: id })
          .where(and(inArray(t.chartEvents.seq, f.eventSeqs), eq(t.chartEvents.verdict, "counted")))
          .returning({ seq: t.chartEvents.seq })
        excluded += changed.length
      }
      // Matching events now excluded: by this flag, or already by ingest's IP cap.
      const [{ n }] = await d
        .select({ n: sql<number>`count(*)::int` })
        .from(t.chartEvents)
        .where(f.matchSeqs.length ? and(inArray(t.chartEvents.seq, f.matchSeqs), eq(t.chartEvents.verdict, "excluded_fraud")) : eq(t.chartEvents.flagId, id!))
      await d.update(t.chartFlags).set({ excludedEvents: n }).where(eq(t.chartFlags.id, id!))
      if (autoAction === "held_from_charts") held.push(f.brandId)
      if (!existing && severity === "high") {
        const name = brandById.get(f.brandId)?.name ?? f.brandId
        await notifyAdmins("charts.review", {
          key: `chart_flag:${id}`,
          template: "chart.integrity",
          vars: { detector: detectorLabel(f.detector).toLowerCase(), brand: name, severity },
          href: `/admin/charts?flag=${id}`,
        })
      }
    }
    if (created) log.info(`[yard] charts: ${created} new ${created === 1 ? "flag" : "flags"} (${[...new Set(held)].join(", ") || "none held"})`)
    return { flags: found.length, created, excluded, held: [...new Set(held)] }
  })
}

const rankOf = (s: string) => (s === "high" ? 3 : s === "medium" ? 2 : 1)

/**
 * For Admin's "Clear flag" (M): puts the flag's excluded events back to counted. A view that has
 * since been counted again for the same actor, item and day stays deduped (the unique index allows
 * one counted view per day).
 */
export async function reincludeFlagEvents(flagId: string): Promise<number> {
  return withTx(async () => {
    const d = await db()
    const rows = await d.select({ seq: t.chartEvents.seq, kind: t.chartEvents.kind }).from(t.chartEvents).where(eq(t.chartEvents.flagId, flagId))
    let n = 0
    for (const r of rows) {
      const view = r.kind === "product_view" || r.kind === "storefront_view" || r.kind === "post_open"
      if (view) {
        const res = await d.execute(sql`
          update chart_events e set verdict = 'counted' where e.seq = ${r.seq} and not exists (
            select 1 from chart_events o where o.verdict = 'counted' and o.kind = e.kind and o.brand_id = e.brand_id
              and coalesce(o.product_id, '') = coalesce(e.product_id, '') and coalesce(o.drop_id, '') = coalesce(e.drop_id, '')
              and o.actor_id = e.actor_id and o.day = e.day)`)
        const count = (res as unknown as { affectedRows?: number }).affectedRows ?? 0
        if (!count) await d.update(t.chartEvents).set({ verdict: "deduped" }).where(eq(t.chartEvents.seq, r.seq))
        n += count
      } else {
        await d.update(t.chartEvents).set({ verdict: "counted" }).where(eq(t.chartEvents.seq, r.seq))
        n++
      }
    }
    // Signals that count again change the boards (the cache signature only sees the newest one).
    afterCommit(() => dropCaches())
    return n
  })
}
