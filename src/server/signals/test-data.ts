import "server-only"
import { unlink } from "node:fs/promises"
import { and, eq, inArray, like, or, sql, type SQL } from "drizzle-orm"
import type { AdminActor } from "../auth/dal"
import { writeAudit } from "../audit"
import { afterCommit, db, withTx } from "../db"
import { abuseEvents, brandLocations, conversations, mediaAssets, messages, notifications, rateLimitBuckets, realtimeEvents, reports } from "../db/schema"
import { getEnv } from "../env"
import { forbidden } from "../http/errors"
import { log } from "../log"
import { mediaIdsOf, refreshVisibility, referencedAtAll } from "../media/visibility"
import { resolveStored } from "../media/store"
import { announceRemovedNotifications, type Recipient } from "../notify"
import { publish } from "../realtime/bus"
import { channels } from "../realtime/channels"
import { resetWindows } from "../security/rate-limit"

/**
 * The F2 kit's restore step behind /api/dev/signals/test-data (development only). Removes what
 * the kit's test shoppers (u_t_…) left behind, so demo accounts see only seeded sample data:
 *  - every conversation whose shopper matches the prefix (messages, attachments and reactions
 *    cascade), and the media those shoppers uploaded or that sat in those conversations (files
 *    are unlinked after commit);
 *  - reports filed by those shoppers, reports on those conversations or their messages, and the
 *    report the kit files as its demo reporter (KIT_REPORTER, details starting "F2 kit report");
 *  - notifications for those shoppers, and every recipient's notification about those
 *    conversations (msg:<id>) or reports (report:<id>);
 *  - abuse rows of those shoppers (rate limits, dedupes, stream caps);
 *  - a place the kit published as its demo account ("F2 kit place…", created by KIT_REPORTER in
 *    KIT_BRAND) if an interrupted run left it; its photos turn private at once;
 *  - their inbox, upload and report rate windows and daily buckets;
 *  - the replay log rows (realtime_events) that announced the deleted notifications, messages and
 *    conversations, so a reconnecting tab can't replay them.
 * Open tabs are told at once: notification.removed on each recipient's channel, and resync on the
 * brand and shopper channels of each deleted conversation.
 *
 * Scope is test data only. `mediaIds` names extra files the kit uploaded (a place photo): only
 * files created by the prefix's shoppers or by KIT_REPORTER, and only while nothing references
 * them. `reportIds` names the kit's reports: only reports filed by the prefix's shoppers or the
 * kit report of KIT_REPORTER. `dangling` also removes msg:/report: notifications that point at
 * nothing any more (the conversation or report is gone, or nothing from the other side is newer
 * than the notification) and the replay rows of notifications that no longer exist.
 * Removing reports, or `dangling`, needs messages.moderate. Every DELETE that removes something is
 * audited (dev.test_data_cleared, with counts). GET runs the same selection without deleting.
 */
export const KIT_REPORT_MARKER = "F2 kit report"
export const KIT_PLACE_MARKER = "F2 kit place"
/** The demo account the kit files its one report, uploads its place photo and publishes its place as. */
export const KIT_REPORTER = "u_b_tobi"
export const KIT_BRAND = "b_lagos_static"

export type Opts = { mediaIds: string[]; reportIds: string[]; dangling: boolean }

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)
const SKEW = "10 seconds"
const list = (ids: string[]) =>
  sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )

type Plan = {
  conversations: { id: string; brandId: string | null; customerId: string | null }[]
  media: { id: string; storagePath: string }[]
  reports: string[]
  notifications: { id: string; kind: Recipient["kind"]; rid: string; key: string }[]
  abuse: number[]
  places: { id: string; images: { mediaId?: string }[] }[]
}

async function select(prefix: string, opts: Opts): Promise<Plan> {
  const d = await db()
  const p = `${escapeLike(prefix)}%`
  const convs = await d.select({ id: conversations.id, brandId: conversations.brandId, customerId: conversations.customerId }).from(conversations).where(like(conversations.customerId, p))
  const convIds = convs.map((c) => c.id)
  const msgIds = convIds.length ? (await d.select({ id: messages.id }).from(messages).where(inArray(messages.conversationId, convIds))).map((r) => r.id) : []

  const mediaRows = await d
    .select({ id: mediaAssets.id, storagePath: mediaAssets.storagePath })
    .from(mediaAssets)
    .where(
      or(
        like(mediaAssets.createdBy, p),
        convIds.length ? inArray(mediaAssets.conversationId, convIds) : undefined,
        // Named files: only the kit's own uploads (its shoppers' or its demo account's), and only unreferenced.
        opts.mediaIds.length
          ? sql`${mediaAssets.id} in (select m.id from media_assets m where m.id in (${list(opts.mediaIds)})
              and (m.created_by like ${p} or m.created_by = ${KIT_REPORTER}) and not ${referencedAtAll})`
          : undefined,
      ),
    )

  // The kit's report as its demo reporter: that reporter and the marker, both.
  const kitReport = and(eq(reports.reporterId, KIT_REPORTER), like(reports.details, `${escapeLike(KIT_REPORT_MARKER)}%`)) as SQL
  const reportRows = await d
    .select({ id: reports.id })
    .from(reports)
    .where(
      or(
        like(reports.reporterId, p),
        convIds.length ? and(eq(reports.subjectType, "conversation"), inArray(reports.subjectId, convIds)) : undefined,
        msgIds.length ? and(eq(reports.subjectType, "message"), inArray(reports.subjectId, msgIds)) : undefined,
        kitReport,
        opts.reportIds.length ? and(inArray(reports.id, opts.reportIds), or(like(reports.reporterId, p), kitReport)) : undefined,
      ),
    )
  const reportIds = reportRows.map((r) => r.id)

  const keys = [...convIds.map((c) => `msg:${c}`), ...reportIds.map((r) => `report:${r}`)]
  const notes = await d
    .select({ id: notifications.id, kind: notifications.recipientKind, rid: notifications.recipientId, key: notifications.eventKey })
    .from(notifications)
    .where(or(like(notifications.recipientId, p), keys.length ? inArray(notifications.eventKey, keys) : undefined))
  if (opts.dangling) {
    const found = (await d.execute(sql`
      select n.id, n.recipient_kind as kind, n.recipient_id as rid, n.event_key as key from notifications n
      where (n.event_key like 'msg:%' and not exists (
              select 1 from messages m join conversations c on c.id = m.conversation_id
              where c.id = substr(n.event_key, 5)
                and m.sender_side = case when n.recipient_kind = 'brand' then 'customer' else 'brand' end
                and m.created_at >= n.created_at - interval '${sql.raw(SKEW)}'))
         or (n.event_key like 'report:%' and not exists (select 1 from reports r where r.id = substr(n.event_key, 8)))`)) as unknown as { rows: { id: string; kind: string; rid: string; key: string }[] }
    for (const r of found.rows) if (!notes.some((n) => n.id === r.id)) notes.push(r)
  }

  const abuse = (
    await d
      .select({ id: abuseEvents.id })
      .from(abuseEvents)
      .where(or(like(abuseEvents.actorId, p), sql`${abuseEvents.detail} ->> 'userId' like ${p}`))
  ).map((r) => r.id)

  const places = await d
    .select({ id: brandLocations.id, images: brandLocations.images })
    .from(brandLocations)
    .where(and(like(brandLocations.name, `${escapeLike(KIT_PLACE_MARKER)}%`), eq(brandLocations.brandId, KIT_BRAND), eq(brandLocations.createdBy, KIT_REPORTER)))

  return {
    places,
    conversations: convs,
    media: mediaRows,
    reports: reportIds,
    notifications: notes.map((n) => ({ id: n.id, kind: n.kind as Recipient["kind"], rid: n.rid, key: n.key })),
    abuse,
  }
}

const summary = (plan: Plan) => ({
  places: plan.places.map((p) => p.id),
  conversations: plan.conversations.map((c) => c.id),
  media: plan.media.map((m) => m.id),
  reports: plan.reports,
  notifications: plan.notifications.map((n) => ({ id: n.id, recipient: `${n.kind}:${n.rid}`, key: n.key })),
  abuseEvents: plan.abuse.length,
})

function guard(prefix: string) {
  if (!getEnv().dev || !prefix.startsWith("u_t_")) throw new Error("dev only, test accounts only")
}

/** Reports and the `dangling` sweep go beyond one cluster's shoppers: they need messages.moderate. */
function assertMayRemove(actor: AdminActor, plan: Plan, opts: Opts) {
  if ((plan.reports.length || opts.dangling) && !actor.permissions.includes("messages.moderate")) {
    throw forbidden(opts.dangling ? "Sweeping dangling notifications needs messages.moderate (Trust & safety or Owner)." : "Removing reports needs messages.moderate (Trust & safety or Owner).")
  }
}

/** What DELETE would remove (nothing is changed). */
export async function previewTestData(actor: AdminActor, prefix: string, opts: Opts) {
  guard(prefix)
  const plan = await select(prefix, opts)
  assertMayRemove(actor, plan, opts)
  return summary(plan)
}

/**
 * Deletes the replay rows that announced what this restore removes: notification events naming a
 * deleted key on its recipient's channel, and conversation, message and read events of a deleted
 * conversation. With `dangling`, also every notification.created row whose notification is gone.
 */
async function deleteReplayRows(plan: Plan, dangling: boolean) {
  const d = await db()
  let n = 0
  const byChannel = new Map<string, string[]>()
  for (const x of plan.notifications) {
    const ch = x.kind === "shopper" ? channels.user(x.rid) : x.kind === "brand" ? channels.brand(x.rid) : channels.adminUser(x.rid)
    byChannel.set(ch, [...(byChannel.get(ch) ?? []), x.key])
  }
  for (const [ch, keys] of byChannel) {
    const gone = await d
      .delete(realtimeEvents)
      .where(
        and(
          eq(realtimeEvents.channel, ch),
          sql`(${realtimeEvents.payload} ->> 'key' in (${list(keys)})
            or (${realtimeEvents.type} = 'notification.read' and jsonb_array_length(coalesce(${realtimeEvents.payload} -> 'keys', '[]'::jsonb)) > 0
                and not exists (select 1 from jsonb_array_elements_text(${realtimeEvents.payload} -> 'keys') k where k not in (${list(keys)}))))`,
        ),
      )
      .returning({ seq: realtimeEvents.seq })
    n += gone.length
  }
  const convIds = plan.conversations.map((c) => c.id)
  if (convIds.length) {
    const gone = await d
      .delete(realtimeEvents)
      .where(
        sql`${realtimeEvents.payload} ->> 'conversationId' in (${list(convIds)})
          or ${realtimeEvents.payload} -> 'conversation' ->> 'id' in (${list(convIds)})
          or ${realtimeEvents.payload} -> 'message' ->> 'conversationId' in (${list(convIds)})`,
      )
      .returning({ seq: realtimeEvents.seq })
    n += gone.length
  }
  if (dangling) {
    const gone = (await d.execute(sql`
      delete from realtime_events e where e.type = 'notification.created'
        and not exists (select 1 from notifications x
          where x.recipient_kind = e.payload -> 'recipient' ->> 'kind' and x.recipient_id = e.payload -> 'recipient' ->> 'id' and x.event_key = e.payload ->> 'key')
      returning e.seq`)) as unknown as { rows: unknown[] }
    n += gone.rows.length
  }
  return n
}

export async function clearTestData(actor: AdminActor, prefix: string, opts: Opts) {
  guard(prefix)
  const p = `${escapeLike(prefix)}%`
  const out = await withTx(async () => {
    const d = await db()
    const preview = await select(prefix, opts)
    assertMayRemove(actor, preview, opts)
    // A left-over kit place first, so the photos it held count as unreferenced below.
    const kitPlaces = preview.places
    if (kitPlaces.length) {
      await d.delete(brandLocations).where(inArray(brandLocations.id, kitPlaces.map((p) => p.id)))
      await refreshVisibility(kitPlaces.flatMap((p) => mediaIdsOf(p.images)))
    }
    const plan = { ...(await select(prefix, opts)), places: kitPlaces }
    if (plan.notifications.length) await d.delete(notifications).where(inArray(notifications.id, plan.notifications.map((n) => n.id)))
    if (plan.reports.length) await d.delete(reports).where(inArray(reports.id, plan.reports))
    // Conversations first: their attachments cascade, which frees the media rows.
    if (plan.conversations.length) await d.delete(conversations).where(inArray(conversations.id, plan.conversations.map((c) => c.id)))
    if (plan.media.length) {
      const gone = await d.delete(mediaAssets).where(inArray(mediaAssets.id, plan.media.map((m) => m.id))).returning({ id: mediaAssets.id, storagePath: mediaAssets.storagePath })
      afterCommit(async () => {
        for (const m of gone) {
          if (m.storagePath.startsWith("/media/")) continue
          const file = resolveStored(m.storagePath)
          if (!file) continue
          await unlink(file).catch((e: NodeJS.ErrnoException) => {
            if (e.code !== "ENOENT") log.error(`[yard] test-data: couldn't delete ${m.id}`, e)
          })
        }
      })
    }
    if (plan.abuse.length) await d.delete(abuseEvents).where(inArray(abuseEvents.id, plan.abuse))
    await d.delete(rateLimitBuckets).where(or(like(rateLimitBuckets.key, `inbox.%:${p}`), like(rateLimitBuckets.key, `uploads:day:shopper:${p}`), like(rateLimitBuckets.key, `reports:day:shopper:${p}`)))
    const replayRows = await deleteReplayRows(plan, opts.dangling)

    // Open tabs: drop the deleted notifications, and refetch lists that showed a deleted conversation.
    // (Published after the replay rows are gone, so these two never match the delete above.)
    await announceRemovedNotifications(plan.notifications.map((n) => ({ kind: n.kind, id: n.rid, key: n.key })))
    const listChannels = new Set(plan.conversations.flatMap((c) => [...(c.brandId ? [channels.brand(c.brandId)] : []), ...(c.customerId ? [channels.user(c.customerId)] : [])]))
    for (const ch of listChannels) await publish(ch, "resync", {})

    const counts = {
      places: plan.places.length,
      conversations: plan.conversations.length,
      media: plan.media.length,
      reports: plan.reports.length,
      notifications: plan.notifications.length,
      abuseEvents: plan.abuse.length,
      replayRows,
    }
    if (Object.values(counts).some((n) => n > 0)) {
      await writeAudit({
        actor: { kind: "admin", id: actor.userId, name: actor.name, role: actor.role },
        action: "dev.test_data_cleared",
        target: `Test data of ${prefix}…`,
        meta: { prefix, dangling: opts.dangling, counts },
      })
    }
    return { plan, replayRows }
  })
  if (out.plan.places.length) {
    const around = await import("../around")
    around.invalidate()
  }
  let windows = 0
  for (const action of ["inbox.send", "inbox.start", "inbox.typing", "inbox.read", "signals", "uploads", "reports"]) windows += resetWindows(`${action}:shopper:${prefix}`)
  return { ...summary(out.plan), replayRows: out.replayRows, windows }
}
