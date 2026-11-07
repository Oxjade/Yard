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
  chartEvents,
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
import { announceRemovedNotifications, recipientChannel, type Recipient } from "../notify"

/** M's own test shoppers (Appendix D). Each cluster mutates only its own. */
export const M_TEST_ACCOUNTS = ["u_t_m1", "u_t_m2"] as const

/**
 * The reasons M's kits write on their decisions. Only rows marked this way can be removed by id, so
 * the cleanup can never erase a person's genuine decision even when its id is posted.
 */
export const KIT_REASON = /^(Curl kit:|restore_m:|M check:)/
const KIT_REASON_SQL = sql`(${accountRestrictions.reason} like 'Curl kit:%' or ${accountRestrictions.reason} like 'restore_m:%' or ${accountRestrictions.reason} like 'M check:%')`

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
/** M's rows that never carry a reason: the audited views, and an audit export (its form asks for none). */
const M_VIEWS = new Set(["message_context.viewed", "message_held.viewed", "audit.exported"])

/** How long after its decision a kit row may still be removed by id. */
const MAX_AGE_MS = 24 * 3600_000

type AuditRow = typeof auditLog.$inferSelect

/** The notification keys a decision sent to a brand or shopper (the keys in M's notify calls). */
function notificationKeysOf(a: AuditRow): string[] {
  const meta = (a.meta ?? {}) as { restrictionId?: unknown; reportIds?: unknown }
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
  return keys
}

export type MCleanupInput = { auditIds?: string[]; dryRun?: boolean }

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
 *   decisions with a kit reason (`Curl kit:`, `restore_m:` or `M check:`) or one of M's rows that
 *   never carry a reason (message_context.viewed, message_held.viewed, audit.exported). Sign-ins, other clusters' keys and
 *   decisions with a person's reason are never removed;
 * - the restriction a listed decision created (meta.restrictionId), only when its own reason is a
 *   kit reason (a Charts freeze request, a brand restriction);
 * - the notifications that decision sent to a brand or shopper (its keys, no earlier than the
 *   decision), with their replay rows, and open tabs are told (notification.removed).
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
      (a) => a.actorKind === "admin" && a.at.getTime() >= cutoff && ((M_DECISIONS.has(a.action) && !!a.reason && KIT_REASON.test(a.reason)) || (M_VIEWS.has(a.action) && !a.reason)),
    )
    const refused = askedFor.filter((id) => !kitRows.some((a) => a.id === id))

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
    const decisionNoteWhere = kitRows
      .map((a) => ({ keys: notificationKeysOf(a), at: new Date(a.at.getTime() - 2000) }))
      .filter((x) => x.keys.length)
      .map((x) => and(inArray(notifications.eventKey, x.keys), inArray(notifications.recipientKind, ["shopper", "brand"]), gte(notifications.createdAt, x.at)))
    const notes = await d
      .select({ id: notifications.id, kind: notifications.recipientKind, rid: notifications.recipientId, key: notifications.eventKey })
      .from(notifications)
      .where(or(fixtureNoteWhere, ...decisionNoteWhere))

    const media = await d.select({ id: mediaAssets.id, storagePath: mediaAssets.storagePath }).from(mediaAssets).where(inArray(mediaAssets.createdBy, accounts))
    const subjects = [...accounts, ...convs, ...msgIds, ...reportIds, ...restrictionIds, ...alertIds, ...media.map((m) => m.id)]
    const fixtureAudit = (await d.select({ id: auditLog.id }).from(auditLog).where(inArray(auditLog.subjectId, subjects))).map((a) => a.id)
    const auditIds = [...new Set([...fixtureAudit, ...kitRows.map((a) => a.id)])]

    const count = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0
    const n = sql<number>`count(*)::int`
    const summary = {
      conversations: convs,
      messages: msgIds.length,
      media: media.length,
      reports: reportIds,
      notifications: notes.length,
      restrictions: restrictionIds.length,
      abuseAlerts: alertIds.length,
      abuseEvents: await count(d.select({ n }).from(abuseEvents).where(inArray(abuseEvents.actorId, accounts))),
      chartSignals: await count(d.select({ n }).from(chartEvents).where(inArray(chartEvents.actorId, accounts))),
      sessions: await count(d.select({ n }).from(sessions).where(inArray(sessions.userId, accounts))),
      blocks: await count(d.select({ n }).from(blocks).where(or(inArray(blocks.blockedId, accounts), inArray(blocks.blockerId, accounts)))),
      kitHolidays: await count(d.select({ n }).from(holidays).where(and(eq(holidays.source, "admin"), eq(holidays.name, "Kit test day")))),
      auditRows: auditIds.length,
      refusedAuditIds: refused,
      dryRun: !!input.dryRun,
    }
    if (input.dryRun) {
      // What a dry run would remove, so a person can check it first.
      const actions = auditIds.length ? await d.select({ action: auditLog.action, n }).from(auditLog).where(inArray(auditLog.id, auditIds)).groupBy(auditLog.action) : []
      const rs = restrictionIds.length ? await d.select({ subject: accountRestrictions.subjectId, kind: accountRestrictions.kind, status: accountRestrictions.status }).from(accountRestrictions).where(inArray(accountRestrictions.id, restrictionIds)) : []
      return { ...summary, detail: { notifications: notes.map((x) => `${x.rid} ${x.key}`), auditActions: Object.fromEntries(actions.map((a) => [a.action, a.n])), restrictions: rs.map((r) => `${r.subject} ${r.kind} ${r.status}`) } }
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
    const removed = media.length + convs.length + reportIds.length + notes.length + restrictionIds.length + auditIds.length + alertIds.length + summary.abuseEvents + summary.chartSignals + summary.sessions + summary.blocks + summary.kitHolidays
    // The cleanup itself is on the record (never deleted by a later run: dev.* isn't one of M's keys).
    if (removed)
      await writeAudit({
        actor: { kind: "admin", id: actor.userId, name: actor.name, role: actor.role },
        action: "dev.cleanup",
        target: "M's test data",
        subjectType: "dev",
        subjectId: "moderation",
        ipHash,
        meta: { conversations: convs.length, messages: msgIds.length, media: media.length, reports: reportIds.length, notifications: notes.length, restrictions: restrictionIds.length, auditRows: auditIds.length, alerts: alertIds.length, sessions: summary.sessions, refused: refused.length },
      })
    log.info(`[yard] dev cleanup (M): ${convs.length} conversations, ${reportIds.length} reports, ${notes.length} notifications, ${restrictionIds.length} restrictions, ${auditIds.length} audit rows`)
    return summary
  })
}
