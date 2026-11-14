import "server-only"
import { and, eq, inArray, sql } from "drizzle-orm"
import type { AdminActor } from "../auth/dal"
import { db } from "../db"
import { abuseAlerts, accountRestrictions, brandLocations, chartFlags, deliveryComplaints, locationEvents, messages, reports } from "../db/schema"
import { canAdmin, type AdminPermission } from "@/lib/permissions"
import type { QueueCountsDto } from "@/lib/api/contracts/admin"
import { OPEN_REPORT } from "./shared"
import { heldNoteCount, lateOrderCount } from "./delivery"
import { supportCounts } from "../support/service"

/** The view permission behind each queue count (§8.1, §2.7). */
export const queuePermission: Record<keyof QueueCountsDto, AdminPermission> = {
  messages: "messages.view_reports",
  content: "content.moderate",
  places: "places.moderate",
  charts: "charts.review",
  delivery: "shipping.view",
  abuse: "abuse.view",
  support: "support.manage",
}

const n = (rows: { n: number | string }[]) => Number(rows.at(0)?.n ?? 0)

async function openReports(types: string[]) {
  const d = await db()
  return n(await d.select({ n: sql<number>`count(*)::int` }).from(reports).where(and(inArray(reports.subjectType, types), inArray(reports.status, [...OPEN_REPORT]))))
}

/**
 * Every queue's count (GET /api/admin/queues/counts filters it per role). Delivery counts open
 * complaints, late orders measured against a recorded promise and orders with a brand note held for
 * review, so the Overview's badge matches the rows its Delivery tab lists; sample orders with no
 * promise on record aren't work.
 */
export async function allQueueCounts(): Promise<Required<QueueCountsDto>> {
  const d = await db()
  const [msgReports, held, posts, placeReports, places, events, flags, freezes, complaints, late, alerts, heldNotes] = await Promise.all([
    openReports(["message", "conversation"]),
    d.select({ n: sql<number>`count(*)::int` }).from(messages).where(eq(messages.status, "held")).then(n),
    openReports(["social_post"]),
    openReports(["location", "location_event"]),
    d.select({ n: sql<number>`count(*)::int` }).from(brandLocations).where(eq(brandLocations.moderationStatus, "pending_review")).then(n),
    d.select({ n: sql<number>`count(*)::int` }).from(locationEvents).where(eq(locationEvents.moderationStatus, "pending_review")).then(n),
    // Every open flag, whatever its severity: the same rule as Admin › Charts' "open flags".
    d.select({ n: sql<number>`count(*)::int` }).from(chartFlags).where(eq(chartFlags.status, "open")).then(n),
    d.select({ n: sql<number>`count(*)::int` }).from(accountRestrictions).where(and(eq(accountRestrictions.kind, "charts_freeze"), eq(accountRestrictions.status, "pending_approval"))).then(n),
    d.select({ n: sql<number>`count(*)::int` }).from(deliveryComplaints).where(inArray(deliveryComplaints.status, ["open", "waiting_brand", "brand_responded", "escalated"])).then(n),
    lateOrderCount(),
    d.select({ n: sql<number>`count(*)::int` }).from(abuseAlerts).where(eq(abuseAlerts.status, "open")).then(n),
    heldNoteCount(),
  ])
  const support = await supportCounts()
  return { messages: msgReports + held, content: posts, places: placeReports + places + events, charts: flags + freezes, delivery: complaints + late + heldNotes, abuse: alerts, support: support.unread }
}

/** GET /api/admin/queues/counts: only the counts this admin's role may see; the others are left out. */
export async function queueCountsFor(actor: AdminActor): Promise<QueueCountsDto> {
  const all = await allQueueCounts()
  const out: QueueCountsDto = {}
  for (const k of Object.keys(queuePermission) as (keyof QueueCountsDto)[]) if (canAdmin(actor.role, queuePermission[k])) out[k] = all[k]
  return out
}
