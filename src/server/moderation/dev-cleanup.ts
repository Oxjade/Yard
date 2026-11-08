import "server-only"
import { unlink } from "node:fs/promises"
import { and, eq, gte, inArray, or, sql } from "drizzle-orm"
import type { AdminActor } from "../auth/dal"
import { writeAudit } from "../audit"
import { afterCommit, db, withTx } from "../db"
import {
  abuseAlerts,
  abuseEvents,
  accountRestrictions,
  auditLog,
  blocks,
  brandLocations,
  chartEvents,
  locationEvents,
  conversations,
  holidays,
  mediaAssets,
  messages,
  notifications,
  realtimeEvents,
  reports,
  sessions,
} from "../db/schema"
import { log } from "../log"
import { resolveStored } from "../media/store"
import { announceRemovedNotifications, recipientChannel, toNotificationDto, type Recipient } from "../notify"
import { publish } from "../realtime/bus"
import { undoKitDecisions } from "./dev-undo"
import type { PriorNote } from "./shared"

/** M's own test shoppers (Appendix D). Each cluster mutates only its own. */
export const M_TEST_ACCOUNTS = ["u_t_m1", "u_t_m2"] as const

/**
 * The reasons M's kits write on their decisions. Only rows marked this way can be removed by id, so
 * the cleanup can never erase a person's genuine decision even when its id is posted.
 */
export const KIT_REASON = /^(Curl kit:|restore_m:|restore_m2:|M check:|M2 check:)/
const KIT_REASON_SQL = sql`(${accountRestrictions.reason} like 'Curl kit:%' or ${accountRestrictions.reason} like 'restore_m:%' or ${accountRestrictions.reason} like 'restore_m2:%' or ${accountRestrictions.reason} like 'M check:%' or ${accountRestrictions.reason} like 'M2 check:%')`

/** Audit keys only M's decisions write (§8.3). The audited views carry no reason, so they're listed apart. */
const M_DECISIONS = new Set([
  "report.dismissed", "report.escalated", "message.removed", "message.released", "conversation.locked",
  "post.hidden", "post.removed", "post.restored",
  "location.approved", "location.rejected", "location.removed", "location.restored", "location_event.approved", "location_event.hidden", "location_event.removed",
  "social.sync_retried", "social.force_disconnected", "social.paused", "social.resumed",
  "chart_flag.cleared", "chart_flag.confirmed", "chart.freeze_requested", "chart.freeze_approved", "chart.freeze_lifted", "charts.recomputed",
  "delivery.contacted_brand", "delivery.resolved", "delivery.escalated", "holiday.added", "holiday.removed",
  "user.status_changed", "brand.status_changed", "restriction.added", "restriction.lifted", "abuse_alert.dismissed",
])
/**
 * M's audited views and the audit export: they carry no reason, so one is removable only when the
 * server marked it as a kit's (meta.kit, set only in development for a request with X-Yard-Kit: 1).
 * A reviewer's genuine view (the record that a person read message bodies) is never removed.
 */
const M_VIEWS = new Set(["message_context.viewed", "message_held.viewed", "delivery_note.viewed", "audit.exported"])
const isKitView = (a: AuditRow) => M_VIEWS.has(a.action) && (a.meta as { kit?: unknown } | null)?.kit === true
/** A notification refreshed this long after the last kit decision that touched it was a person's: left alone. */
const NOTE_SLACK_MS = 30_000

/** How long after its decision a kit row may still be removed by id. */
const MAX_AGE_MS = 24 * 60 * 60_000

type AuditRow = typeof auditLog.$inferSelect

/** The notification keys a decision sent to a brand or shopper (the keys in M's notify calls). */
function notificationKeysOf(a: AuditRow): string[] {
  const meta = (a.meta ?? {}) as { restrictionId?: unknown; reportIds?: unknown; conversationId?: unknown }
  const keys: string[] = []
  const id = a.subjectId ?? ""
  const prefix: Record<string, string> = {
    "report.dismissed": "report:", "report.escalated": "report:",
    "brand.status_changed": "brand-status:",
    "post.hidden": "post-moderation:", "post.removed": "post-moderation:", "post.restored": "post-moderation:",
    "location.approved": "place-review:", "location.rejected": "place-review:", "location.removed": "place-review:", "location.restored": "place-review:",
    "location_event.approved": "event-review:", "location_event.hidden": "event-review:", "location_event.removed": "event-review:",
    "social.force_disconnected": "social-disconnect:",
    "social.paused": "social-paused:", "social.resumed": "social-paused:",
    "delivery.contacted_brand": "delivery-contact:", "delivery.resolved": "delivery-resolved:",
    "message.removed": "msg-removed:",
  }
  if (prefix[a.action] && id) keys.push(prefix[a.action] + id)
  if (typeof meta.restrictionId === "string") {
    if (a.action === "restriction.added") keys.push(`restriction:${meta.restrictionId}`)
    if (a.action === "chart.freeze_approved" || a.action === "chart.freeze_lifted") keys.push(`charts-freeze:${meta.restrictionId}`)
  }
  if (Array.isArray(meta.reportIds)) for (const r of meta.reportIds) if (typeof r === "string") keys.push(`report:${r}`)
  // A release delivers the message, so the other side got "New message from …" (I's msg:<conversation> key).
  if (a.action === "message.released" && typeof meta.conversationId === "string") keys.push(`msg:${meta.conversationId}`)
  return keys
}

export type MCleanupInput = { auditIds?: string[]; deletedPlaceIds?: string[]; deletedEventIds?: string[]; dryRun?: boolean }

/**
 * Development only (§9.0 test-data hygiene). Removes exactly what M's curl kit, project check and
 * browser scripts created, so the demo people see only the seeded sample data. Nothing is
 * selected by a time window.
 *
 * Always, for M's own test shoppers u_t_m1 and u_t_m2 (fixtures no person uses):
 * - their conversations (messages, attachments, reactions and participants go with them), the
 *   reports about those conversations or filed by them, the `msg:<conversation>` notifications
 *   brands got, the stored realtime events naming those conversations;
 * - their notifications, sessions, blocks, abuse events and alerts, restrictions, chart signals,
 *   the files they uploaded (rows now, files after commit), and the audit rows about all of them
 *   (an admin's media.viewed on one of their files included).
 *
 * By id (`auditIds`, the `audit.id` each of the run's decisions and audited views returned):
 * - each listed audit row, only when an admin wrote it in the last 24 hours AND it's one of M's
 *   decisions with a kit reason (`Curl kit:`, `restore_m:`, `M check:` …) or one of M's audited views
 *   or exports that the server marked as a kit's (meta.kit: development only, X-Yard-Kit: 1).
 *   Sign-ins, other clusters' keys, decisions with a person's reason and a person's views are never removed;
 * - the restriction a listed decision created (meta.restrictionId), only when its own reason is a
 *   kit reason (a Charts freeze request, a brand restriction);
 * - the notifications that decision sent: each one it created is deleted with its replay rows (open
 *   tabs are told, notification.removed); each one that existed and the decision only refreshed is put
 *   back as it was (meta.priorNotes, recorded by runDecision in development). A row refreshed again
 *   after the kit's decisions is left alone. Older rows without that record: their keys, no earlier
 *   than the decision.
 * - what that decision changed on a SHARED fixture, put back exactly (dev-undo.ts): a seeded event or
 *   place's moderation, Paper Riot's flags and the signals clearing re-counted, u_7's released message
 *   (held again, preview and unread counts as before, the brand's bell item gone), reports it actioned,
 *   a complaint it resolved, a brand or account status. Only while the subject is still as the
 *   decision left it.
 * By id (`deletedPlaceIds`, `deletedEventIds`): places (and their events) the kit created as a brand and
 * has since deleted; the brand-side location.* / location_event.* audit rows about them (the last 24
 * hours only; refused while the place or event still exists).
 * The kit's "Kit test day" holiday is removed whenever one is left over.
 *
 * Every run that removes something writes one `dev.cleanup` audit row with the counts. The route
 * needs the owner role. Seeded reports go back through POST /api/dev/reseed?module=safety.
 */
export async function devCleanupM(actor: AdminActor, input: MCleanupInput, ipHash: string | null = null) {
  const accounts = [...M_TEST_ACCOUNTS]
  const askedFor = [...new Set(input.auditIds ?? [])]
  return withTx(async () => {
    const d = await db()
    const convs = (await d.select({ id: conversations.id }).from(conversations).where(inArray(conversations.customerId, accounts))).map((c) => c.id)
    const msgIds = convs.length ? (await d.select({ id: messages.id }).from(messages).where(inArray(messages.conversationId, convs))).map((m) => m.id) : []

    const reportWhere = or(
      inArray(reports.reporterId, accounts),
      convs.length ? and(eq(reports.subjectType, "conversation"), inArray(reports.subjectId, convs)) : undefined,
      msgIds.length ? and(eq(reports.subjectType, "message"), inArray(reports.subjectId, msgIds)) : undefined,
    )
    const reportIds = (await d.select({ id: reports.id }).from(reports).where(reportWhere)).map((r) => r.id)

    // The listed audit rows that are provably the kit's own.
    const listed = askedFor.length ? await d.select().from(auditLog).where(inArray(auditLog.id, askedFor)) : []
    const cutoff = Date.now() - MAX_AGE_MS
    const kitRows = listed.filter(
      (a) => a.actorKind === "admin" && a.at.getTime() >= cutoff && ((M_DECISIONS.has(a.action) && !!a.reason && KIT_REASON.test(a.reason)) || isKitView(a)),
    )
    // Ids no longer in the log (an earlier cleanup removed them with the test shoppers' data) aren't
    // refused, only missing; refused means present but not provably a kit's row.
    const missing = askedFor.filter((id) => !listed.some((a) => a.id === id))
    const refused = askedFor.filter((id) => !kitRows.some((a) => a.id === id) && !missing.includes(id))

    // Shared fixtures first, while the decisions' own audit rows (their "before" state) still exist.
    const undone = await undoKitDecisions(kitRows, { dryRun: !!input.dryRun })

    // Brand-side audit rows about places the kit created and then deleted (never a place that exists).
    const placeAsk = [...new Set(input.deletedPlaceIds ?? [])]
    const stillThere = placeAsk.length ? new Set((await d.select({ id: brandLocations.id }).from(brandLocations).where(inArray(brandLocations.id, placeAsk))).map((p) => p.id)) : new Set<string>()
    const gonePlaces = placeAsk.filter((id) => !stillThere.has(id))
    // The same for events the kit created on such a place (they went with it): brand-side location_event.* rows.
    const eventAsk = [...new Set(input.deletedEventIds ?? [])]
    const eventsLeft = eventAsk.length ? new Set((await d.select({ id: locationEvents.id }).from(locationEvents).where(inArray(locationEvents.id, eventAsk))).map((e) => e.id)) : new Set<string>()
    const goneEvents = eventAsk.filter((id) => !eventsLeft.has(id))
    const placeAudit = [
      ...(gonePlaces.length
        ? await d
            .select({ id: auditLog.id })
            .from(auditLog)
            .where(and(inArray(auditLog.subjectId, gonePlaces), eq(auditLog.actorKind, "brand"), sql`${auditLog.action} like 'location.%'`, gte(auditLog.at, new Date(cutoff))))
        : []),
      ...(goneEvents.length
        ? await d
            .select({ id: auditLog.id })
            .from(auditLog)
            .where(and(inArray(auditLog.subjectId, goneEvents), eq(auditLog.actorKind, "brand"), sql`${auditLog.action} like 'location_event.%'`, gte(auditLog.at, new Date(cutoff))))
        : []),
    ].map((a) => a.id)

    // Restrictions: M's test shoppers' own, plus those a kit decision created with a kit reason.
    const kitRestrictionIds = [...new Set(kitRows.map((a) => (a.meta as { restrictionId?: unknown } | null)?.restrictionId).filter((x): x is string => typeof x === "string"))]
    const restrictionWhere = or(
      and(eq(accountRestrictions.subjectKind, "user"), inArray(accountRestrictions.subjectId, accounts)),
      kitRestrictionIds.length ? and(inArray(accountRestrictions.id, kitRestrictionIds), KIT_REASON_SQL) : undefined,
    )
    const restrictionIds = (await d.select({ id: accountRestrictions.id }).from(accountRestrictions).where(restrictionWhere)).map((r) => r.id)
    const alertIds = (await d.select({ id: abuseAlerts.id }).from(abuseAlerts).where(and(eq(abuseAlerts.subjectKind, "user"), inArray(abuseAlerts.subjectId, accounts)))).map((a) => a.id)

    // Notifications: the test shoppers' and those about their conversations or reports, plus the
    // exact keys each kit decision sent, no earlier than that decision.
    const fixtureNoteWhere = or(
      and(eq(notifications.recipientKind, "shopper"), inArray(notifications.recipientId, accounts)),
      convs.length ? inArray(notifications.eventKey, convs.map((c) => `msg:${c}`)) : undefined,
      reportIds.length ? inArray(notifications.eventKey, reportIds.map((r) => `report:${r}`)) : undefined,
      restrictionIds.length ? inArray(notifications.eventKey, restrictionIds.map((r) => `restriction:${r}`)) : undefined,
      sql`${notifications.eventKey} in (select 'abuse:' || id from abuse_alerts where subject_kind = 'user' and subject_id in (${sql.join(accounts.map((a) => sql`${a}`), sql`, `)}))`,
    )
    // A decision taken in development records each notification it overwrote (meta.priorNotes, see
    // shared.ts): the earliest kit decision's record is what was there before the run, so that row is
    // put back (or deleted when there was none). Rows from before that record existed fall back to
    // the keys the decision sends, created no earlier than it.
    const recorded = new Map<string, { ref: { kind: Recipient["kind"]; id: string; key: string }; was: PriorNote["was"]; first: number; last: number }>()
    for (const a of [...kitRows].sort((x, y) => x.at.getTime() - y.at.getTime())) {
      const pn = (a.meta as { priorNotes?: unknown } | null)?.priorNotes
      if (!Array.isArray(pn)) continue
      for (const n of pn as PriorNote[]) {
        if (!n || typeof n.key !== "string" || typeof n.id !== "string" || !["shopper", "brand", "admin"].includes(n.kind)) continue
        const k = `${n.kind}|${n.id}|${n.key}`
        const cur = recorded.get(k)
        if (cur) cur.last = a.at.getTime()
        else recorded.set(k, { ref: { kind: n.kind, id: n.id, key: n.key }, was: n.was ?? null, first: a.at.getTime(), last: a.at.getTime() })
      }
    }
    // Keys a decision sends through another cluster's notify (not recorded) still go by key and time.
    const decisionNoteWhere = kitRows
      .map((a) => ({ keys: notificationKeysOf(a), at: new Date(a.at.getTime() - 2000) }))
      .filter((x) => x.keys.length)
      .map((x) => and(inArray(notifications.eventKey, x.keys), inArray(notifications.recipientKind, ["shopper", "brand"]), gte(notifications.createdAt, x.at)))
    const fixtureRows = await d
      .select({ id: notifications.id, kind: notifications.recipientKind, rid: notifications.recipientId, key: notifications.eventKey })
      .from(notifications)
      .where(fixtureNoteWhere)
    const fixtureKeys = new Set(fixtureRows.map((x) => `${x.kind}|${x.rid}|${x.key}`))
    const byKey = decisionNoteWhere.length
      ? (
          await d
            .select({ id: notifications.id, kind: notifications.recipientKind, rid: notifications.recipientId, key: notifications.eventKey })
            .from(notifications)
            .where(or(...decisionNoteWhere))
        ).filter((x) => !fixtureKeys.has(`${x.kind}|${x.rid}|${x.key}`) && !recorded.has(`${x.kind}|${x.rid}|${x.key}`))
      : []
    const fixtureNotes = [...fixtureRows, ...byKey]
    const touched = [...recorded.entries()].filter(([k]) => !fixtureKeys.has(k)).map(([, v]) => v)
    const current = touched.length
      ? await d
          .select()
          .from(notifications)
          .where(or(...touched.map((t) => and(eq(notifications.recipientKind, t.ref.kind), eq(notifications.recipientId, t.ref.id), eq(notifications.eventKey, t.ref.key)))))
      : []
    const toDelete: typeof fixtureNotes = []
    const toRestore: { row: (typeof current)[number]; was: NonNullable<PriorNote["was"]> }[] = []
    for (const t of touched) {
      const row = current.find((c) => c.recipientKind === t.ref.kind && c.recipientId === t.ref.id && c.eventKey === t.ref.key)
      // Gone already, or refreshed by someone after the kit's last decision on it: nothing of the kit's to undo.
      if (!row || row.createdAt.getTime() > t.last + NOTE_SLACK_MS || row.createdAt.getTime() < t.first - 2000) continue
      if (t.was) toRestore.push({ row, was: t.was })
      else toDelete.push({ id: row.id, kind: row.recipientKind, rid: row.recipientId, key: row.eventKey })
    }
    const notes = [...fixtureNotes, ...toDelete]

    const media = await d.select({ id: mediaAssets.id, storagePath: mediaAssets.storagePath }).from(mediaAssets).where(inArray(mediaAssets.createdBy, accounts))
    const subjects = [...accounts, ...convs, ...msgIds, ...reportIds, ...restrictionIds, ...alertIds, ...media.map((m) => m.id)]
    const fixtureAudit = (await d.select({ id: auditLog.id }).from(auditLog).where(inArray(auditLog.subjectId, subjects))).map((a) => a.id)
    const auditIds = [...new Set([...fixtureAudit, ...kitRows.map((a) => a.id), ...placeAudit])]

    const count = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0
    const n = sql<number>`count(*)::int`
    const summary = {
      conversations: convs,
      messages: msgIds.length,
      media: media.length,
      reports: reportIds,
      notifications: notes.length,
      restoredNotifications: toRestore.length,
      restrictions: restrictionIds.length,
      abuseAlerts: alertIds.length,
      abuseEvents: await count(d.select({ n }).from(abuseEvents).where(inArray(abuseEvents.actorId, accounts))),
      chartSignals: await count(d.select({ n }).from(chartEvents).where(inArray(chartEvents.actorId, accounts))),
      sessions: await count(d.select({ n }).from(sessions).where(inArray(sessions.userId, accounts))),
      blocks: await count(d.select({ n }).from(blocks).where(or(inArray(blocks.blockedId, accounts), inArray(blocks.blockerId, accounts)))),
      kitHolidays: await count(d.select({ n }).from(holidays).where(and(eq(holidays.source, "admin"), eq(holidays.name, "Kit test day")))),
      auditRows: auditIds.length,
      refusedAuditIds: refused,
      missingAuditIds: missing,
      refusedPlaceIds: placeAsk.filter((id) => stillThere.has(id)),
      refusedEventIds: eventAsk.filter((id) => eventsLeft.has(id)),
      undone,
      dryRun: !!input.dryRun,
    }
    if (input.dryRun) {
      // What a dry run would remove, so a person can check it first.
      const actions = auditIds.length ? await d.select({ action: auditLog.action, n }).from(auditLog).where(inArray(auditLog.id, auditIds)).groupBy(auditLog.action) : []
      const rs = restrictionIds.length ? await d.select({ subject: accountRestrictions.subjectId, kind: accountRestrictions.kind, status: accountRestrictions.status }).from(accountRestrictions).where(inArray(accountRestrictions.id, restrictionIds)) : []
      return { ...summary, detail: { notifications: notes.map((x) => `${x.rid} ${x.key}`), restoredNotifications: toRestore.map((x) => `${x.row.recipientId} ${x.row.eventKey}`), auditActions: Object.fromEntries(actions.map((a) => [a.action, a.n])), restrictions: rs.map((r) => `${r.subject} ${r.kind} ${r.status}`) } }
    }

    if (notes.length) {
      await d.delete(notifications).where(inArray(notifications.id, notes.map((x) => x.id)))
      // Their replay rows go too, and open tabs drop them at once (F2's notification.removed).
      const byChannel = new Map<string, string[]>()
      for (const x of notes) {
        const ch = recipientChannel({ kind: x.kind as Recipient["kind"], id: x.rid })
        byChannel.set(ch, [...(byChannel.get(ch) ?? []), x.key])
      }
      for (const [ch, keys] of byChannel)
        await d.delete(realtimeEvents).where(and(eq(realtimeEvents.channel, ch), eq(realtimeEvents.type, "notification.created"), sql`${realtimeEvents.payload} ->> 'key' in (${sql.join(keys.map((k) => sql`${k}`), sql`, `)})`))
      await announceRemovedNotifications(notes.map((x) => ({ kind: x.kind as Recipient["kind"], id: x.rid, key: x.key })))
    }
    // Notifications a kit decision only refreshed: back to exactly what they were (wording, time, read
    // state). The kit's replay rows for them go, and open tabs get the restored item.
    for (const { row, was } of toRestore) {
      const [restored] = await d
        .update(notifications)
        .set({ title: was.title, body: was.wording, category: was.category, href: was.href, createdAt: new Date(was.createdAt), readAt: was.readAt ? new Date(was.readAt) : null })
        .where(eq(notifications.id, row.id))
        .returning()
      const ch = recipientChannel({ kind: row.recipientKind as Recipient["kind"], id: row.recipientId })
      await d.delete(realtimeEvents).where(and(eq(realtimeEvents.channel, ch), eq(realtimeEvents.type, "notification.created"), sql`${realtimeEvents.payload} ->> 'key' = ${row.eventKey}`, gte(realtimeEvents.createdAt, new Date(row.createdAt.getTime() - NOTE_SLACK_MS))))
      if (restored)
        afterCommit(async () => {
          await publish(ch, "notification.created", toNotificationDto(restored))
        })
    }
    if (auditIds.length) await d.delete(auditLog).where(inArray(auditLog.id, auditIds))
    if (reportIds.length) await d.delete(reports).where(inArray(reports.id, reportIds))
    if (restrictionIds.length) await d.delete(accountRestrictions).where(inArray(accountRestrictions.id, restrictionIds))
    if (alertIds.length) await d.delete(abuseAlerts).where(inArray(abuseAlerts.id, alertIds))
    await d.delete(abuseEvents).where(inArray(abuseEvents.actorId, accounts))
    await d.delete(chartEvents).where(inArray(chartEvents.actorId, accounts))
    await d.delete(sessions).where(inArray(sessions.userId, accounts))
    await d.delete(blocks).where(or(inArray(blocks.blockedId, accounts), inArray(blocks.blockerId, accounts)))
    await d.delete(holidays).where(and(eq(holidays.source, "admin"), eq(holidays.name, "Kit test day")))
    if (convs.length) {
      await d.delete(realtimeEvents).where(sql`${realtimeEvents.payload}->>'conversationId' in (${sql.join(convs.map((c) => sql`${c}`), sql`, `)})`)
      // Messages, attachments, reactions and participants cascade; media rows keep their file and lose the link (set null).
      await d.delete(conversations).where(inArray(conversations.id, convs))
    }
    if (media.length) {
      // The test shoppers' uploads: rows now, files after commit (no file I/O inside the transaction).
      await d.delete(mediaAssets).where(inArray(mediaAssets.id, media.map((m) => m.id)))
      afterCommit(async () => {
        for (const m of media) {
          const file = m.storagePath.startsWith("/media/") ? null : resolveStored(m.storagePath)
          if (!file) continue
          await unlink(file).catch((e: NodeJS.ErrnoException) => {
            if (e.code !== "ENOENT") log.warn(`[yard] dev cleanup (M): couldn't delete ${m.id}'s file`)
          })
        }
      })
    }
    const removed = undone.length + media.length + convs.length + reportIds.length + notes.length + toRestore.length + restrictionIds.length + auditIds.length + alertIds.length + summary.abuseEvents + summary.chartSignals + summary.sessions + summary.blocks + summary.kitHolidays
    // The cleanup itself is on the record (never deleted by a later run: dev.* isn't one of M's keys).
    if (removed)
      await writeAudit({
        actor: { kind: "admin", id: actor.userId, name: actor.name, role: actor.role },
        action: "dev.cleanup",
        target: "M's test data",
        subjectType: "dev",
        subjectId: "moderation",
        ipHash,
        meta: { conversations: convs.length, messages: msgIds.length, media: media.length, reports: reportIds.length, notifications: notes.length, restoredNotifications: toRestore.length, restrictions: restrictionIds.length, auditRows: auditIds.length, alerts: alertIds.length, sessions: summary.sessions, refused: refused.length, undone: undone.filter((u) => u.outcome === "restored").length },
      })
    log.info(`[yard] dev cleanup (M): ${convs.length} conversations, ${reportIds.length} reports, ${notes.length} notifications, ${restrictionIds.length} restrictions, ${auditIds.length} audit rows`)
    return summary
  })
}
