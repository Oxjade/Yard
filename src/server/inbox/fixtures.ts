import "server-only"
import { randomUUID } from "node:crypto"
import { unlink } from "node:fs/promises"
import { and, eq, gte, inArray, like, or, sql } from "drizzle-orm"
import { afterCommit, db, withTx } from "../db/tx"
import { writeAudit } from "../audit"
import { abuseAlerts, abuseEvents, accountRestrictions, appMeta, auditLog, blocks, brandMembers, chartEvents, conversationParticipants, conversations, mediaAssets, messageAttachments, messages, notifications, rateLimitBuckets } from "../db/schema"
import { conflict } from "../http/errors"
import { log } from "../log"
import { resolveStored } from "../media/store"
import { resetWindows } from "../security/rate-limit"
import { clearReceiptMarkers } from "./receipts"

/**
 * Development-only test conversations (§9.0 test-data hygiene). The seeded state holds only the
 * sample conversations; a cluster's kit creates its fixed-id test conversations at its start
 * (`POST /api/inbox/dev/fixtures`) and removes everything its test shoppers left at its end
 * (`DELETE /api/inbox/dev/fixtures?set=`), so the demo accounts (Tobi's inbox, Ada's, the
 * admins' queues and bells) never show a "Test shopper" afterwards.
 */

const LS = "b_lagos_static"
export const FIXTURE_SETS = {
  i: [
    ["cv_t_i1_ls", LS, "u_t_i1"],
    ["cv_t_i2_ls", LS, "u_t_i2"],
    ["cv_t_i3_or", "b_orun_studio", "u_t_i3"],
  ],
  m1: [["cv_t_m1_ls", LS, "u_t_m1"]],
  m2: [
    ["cv_t_m2_ls", LS, "u_t_m2"],
    ["cv_t_m2_nf", "b_null_form", "u_t_m2"],
    ["cv_t_m2_kt", "b_kumasi_thread", "u_t_m2"],
    ["cv_t_m2_sb", "b_signal_bloom", "u_t_m2"],
    ["cv_t_m2_or", "b_orun_studio", "u_t_m2"],
  ],
  f1: [["cv_t_f1_ls", LS, "u_t_f1"]],
} as const satisfies Record<string, readonly (readonly [string, string, string])[]>
export type FixtureSet = keyof typeof FIXTURE_SETS
export const FIXTURE_SET_KEYS = Object.keys(FIXTURE_SETS) as FixtureSet[]

const shoppersOf = (sets: FixtureSet[]) => [...new Set(sets.flatMap((s) => FIXTURE_SETS[s].map(([, , u]) => u)))]

/** Every message limit of these shoppers starts again (in-memory windows and durable daily buckets). */
async function resetLimits(shoppers: string[]) {
  for (const u of shoppers) for (const k of ["inbox.send:shopper:", "inbox.start:shopper:", "inbox.typing:shopper:"]) resetWindows(`${k}${u}`)
  if (shoppers.length) await (await db()).delete(rateLimitBuckets).where(or(...shoppers.map((u) => like(rateLimitBuckets.key, `inbox.%:${u}:%`))))
}

/**
 * Removes what these test shoppers left in the inbox: their conversations (messages, reactions
 * and attachments cascade), the photos uploaded into them (rows now, files after commit), the
 * `msg:<conversation>` notifications in every bell, blocks either way, spam marks and the abuse
 * alerts they raised and restrictions put on them (with the notifications and audit rows about
 * them), every notification sent to them, the audit rows about those conversations, and their
 * `message_started` chart signals. Reports filed about these conversations belong to the
 * reporting cluster's own cleanup and are left alone.
 */
export async function removeTestShopperData(shoppers: string[]) {
  return withTx(async () => {
    const d = await db()
    if (!shoppers.length) return { conversations: [] as string[], messages: 0, media: 0, notifications: 0, alerts: 0, restrictions: 0, abuseEvents: 0, auditRows: 0, blocks: 0, chartSignals: 0 }
    const convs = (await d.select({ id: conversations.id }).from(conversations).where(inArray(conversations.customerId, shoppers))).map((r) => r.id)
    const msgIds = convs.length ? (await d.select({ id: messages.id }).from(messages).where(inArray(messages.conversationId, convs))).map((r) => r.id) : []
    const attached = msgIds.length ? (await d.select({ id: messageAttachments.mediaId }).from(messageAttachments).where(inArray(messageAttachments.messageId, msgIds))).map((r) => r.id) : []
    const media = await d
      .select({ id: mediaAssets.id, storagePath: mediaAssets.storagePath })
      .from(mediaAssets)
      .where(
        and(
          eq(mediaAssets.purpose, "inbox_attachment"),
          or(inArray(mediaAssets.createdBy, shoppers), convs.length ? inArray(mediaAssets.conversationId, convs) : undefined, attached.length ? inArray(mediaAssets.id, attached) : undefined),
        ),
      )
    const alerts = (await d.select({ id: abuseAlerts.id }).from(abuseAlerts).where(and(eq(abuseAlerts.subjectKind, "user"), inArray(abuseAlerts.subjectId, shoppers)))).map((r) => r.id)
    const restrictions = (await d.select({ id: accountRestrictions.id }).from(accountRestrictions).where(and(eq(accountRestrictions.subjectKind, "user"), inArray(accountRestrictions.subjectId, shoppers)))).map((r) => r.id)
    const keys = [...convs.map((c) => `msg:${c}`), ...alerts.map((a) => `abuse:${a}`), ...restrictions.map((r) => `restriction:${r}`)]
    const subjects = [...convs, ...alerts, ...msgIds, ...shoppers, ...restrictions]

    const removed = {
      conversations: convs,
      messages: msgIds.length,
      media: media.length,
      notifications: (
        await d
          .delete(notifications)
          .where(or(inArray(notifications.eventKey, keys), and(eq(notifications.recipientKind, "shopper"), inArray(notifications.recipientId, shoppers))))
          .returning({ id: notifications.id })
      ).length,
      alerts: alerts.length,
      restrictions: restrictions.length,
      abuseEvents: (
        await d
          .delete(abuseEvents)
          .where(
            or(
              inArray(abuseEvents.actorId, shoppers),
              sql`${abuseEvents.detail}->>'customerId' in (${sql.join(shoppers.map((s) => sql`${s}`), sql`, `)})`,
              convs.length ? sql`${abuseEvents.detail}->>'conversationId' in (${sql.join(convs.map((c) => sql`${c}`), sql`, `)})` : undefined,
            ),
          )
          .returning({ id: abuseEvents.id })
      ).length,
      auditRows: subjects.length ? (await d.delete(auditLog).where(inArray(auditLog.subjectId, subjects)).returning({ id: auditLog.id })).length : 0,
      blocks: (
        await d
          .delete(blocks)
          .where(or(and(eq(blocks.blockedKind, "shopper"), inArray(blocks.blockedId, shoppers)), and(eq(blocks.blockerKind, "shopper"), inArray(blocks.blockerId, shoppers))))
          .returning({ id: blocks.id })
      ).length,
      chartSignals: (await d.delete(chartEvents).where(and(eq(chartEvents.kind, "message_started"), inArray(chartEvents.actorId, shoppers))).returning({ seq: chartEvents.seq })).length,
    }
    if (alerts.length) await d.delete(abuseAlerts).where(inArray(abuseAlerts.id, alerts))
    if (restrictions.length) await d.delete(accountRestrictions).where(inArray(accountRestrictions.id, restrictions))
    if (convs.length) await d.delete(conversations).where(inArray(conversations.id, convs))
    // A message notification whose conversation is gone is always stale (earlier runs' leftovers too).
    removed.notifications += (
      await d
        .delete(notifications)
        .where(and(like(notifications.eventKey, "msg:%"), sql`not exists (select 1 from ${conversations} c where c.id = substring(${notifications.eventKey} from 5))`))
        .returning({ id: notifications.id })
    ).length
    if (media.length) await d.delete(mediaAssets).where(inArray(mediaAssets.id, media.map((m) => m.id)))
    await clearReceiptMarkers(shoppers)
    await resetLimits(shoppers)
    // Files go only once the rows are gone for good.
    const files = media.filter((m) => !m.storagePath.startsWith("/media/")).map((m) => resolveStored(m.storagePath)).filter((p): p is string => !!p)
    afterCommit(async () => {
      for (const f of files) await unlink(f).catch((e: NodeJS.ErrnoException) => (e.code === "ENOENT" ? undefined : log.error("[yard] inbox fixture file", e)))
    })
    return removed
  })
}

/**
 * Creates the fixed-id test conversations of these sets, each with one opening message from its
 * test shopper an hour ago (unread for the brand), after clearing whatever those shoppers had.
 */
export async function createFixtures(sets: FixtureSet[], opts: { run?: string; force?: boolean; by: AdminWho }) {
  const shoppers = shoppersOf(sets)
  return withTx(async () => {
    await claimRun(sets, opts)
    const cleared = await removeTestShopperData(shoppers)
    const d = await db()
    const at = new Date(Date.now() - 60 * 60_000)
    const created: string[] = []
    for (const set of sets)
      for (const [id, brandId, customerId] of FIXTURE_SETS[set]) {
        const body = `Opening message from Test shopper ${customerId.slice(4).toUpperCase()}.`
        await d.insert(conversations).values({ id, brandId, customerId, status: "open", origin: "inbox", sample: false, createdAt: at })
        const [m] = await d
          .insert(messages)
          .values({ id: `msg_${id.slice(3)}_1`, conversationId: id, senderSide: "customer", senderUserId: customerId, kind: "text", body, status: "sent", clientId: randomUUID(), createdAt: at })
          .returning({ seq: messages.seq })
        await d.update(conversations).set({ lastMessageSeq: m.seq, lastMessageAt: at, lastPreview: body }).where(eq(conversations.id, id))
        await d.insert(conversationParticipants).values([
          { conversationId: id, side: "customer", partyId: customerId, lastReadSeq: m.seq, lastReadAt: at, unreadCount: 0 },
          { conversationId: id, side: "brand", partyId: brandId, lastReadSeq: 0, unreadCount: 1 },
        ])
        created.push(id)
      }
    await writeAudit({ actor: { kind: "admin", id: opts.by.id, name: opts.by.name, role: opts.by.role }, action: "dev.fixtures_created", target: `Inbox test conversations (${sets.join(", ")})`, subjectType: "dev_fixtures", subjectId: `inbox:${sets.join(",")}`, meta: { sets, created, cleared: cleared.conversations.length, run: opts.run ?? null } })
    return { created, cleared: cleared.conversations }
  })
}

export type AdminWho = { id: string; name: string; role: string }

/*
 * One kit run at a time per set. POST records { run, at, by } per set; another POST inside
 * RUN_TTL with a different run tag is a 409 (unless `force`), so a parallel run can't wipe
 * conversations another run is still using. DELETE releases the sets.
 */
const RUN_TTL_MS = 15 * 60_000
const runKey = (set: FixtureSet) => `inbox:fixtures-run:${set}`

async function claimRun(sets: FixtureSet[], opts: { run?: string; force?: boolean; by: AdminWho }) {
  const d = await db()
  const now = Date.now()
  const rows = await d.select().from(appMeta).where(inArray(appMeta.key, sets.map(runKey)))
  if (!opts.force)
    for (const r of rows) {
      const v = r.value as { run?: string | null; at?: string; by?: string }
      const at = v.at ? Date.parse(v.at) : 0
      if (now - at < RUN_TTL_MS && (!opts.run || v.run !== opts.run)) {
        const time = new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })
        throw conflict(`Another kit run (started ${time} UTC by ${v.by ?? "an admin"}) is using these test conversations. Wait for it to finish, or pass force.`)
      }
    }
  for (const set of sets) {
    const value = { run: opts.run ?? null, at: new Date(now).toISOString(), by: opts.by.name }
    await d.insert(appMeta).values({ key: runKey(set), value }).onConflictDoUpdate({ target: appMeta.key, set: { value, updatedAt: new Date(now) } })
  }
}

async function releaseRun(sets: FixtureSet[]) {
  const d = await db()
  await d.delete(appMeta).where(inArray(appMeta.key, sets.map(runKey)))
}

/** The kit's marker: every decision a kit makes on a demo account to show a state starts with it. */
export const KIT_MARKER = "I kit:"

/** Accounts a kit may restrict to show a state: the sets' test shoppers and brands, and those brands' staff. */
async function kitSubjects(sets: FixtureSet[]) {
  const brands = [...new Set(sets.flatMap((s) => FIXTURE_SETS[s].map(([, b]) => b as string)))]
  const d = await db()
  const staff = brands.length ? (await d.select({ userId: brandMembers.userId }).from(brandMembers).where(inArray(brandMembers.brandId, brands))).map((r) => r.userId) : []
  return { users: [...new Set([...shoppersOf(sets), ...staff])], brands }
}

export type RemoveOptions = {
  /** Also remove the `dev.reseeded` audit rows for the inbox module written since then. */
  since?: string
  /**
   * Also remove the moderation decisions a kit made to show a state (for example restricting
   * Orun Studio to see the restricted composer): restrictions whose reason starts with this
   * marker (it must start with KIT_MARKER) and whose subject is one of the sets' accounts
   * (kitSubjects), with their audit rows and `restriction:<id>` notifications. Nothing else.
   */
  reasonPrefix?: string
  by: AdminWho
}

/** Removes everything the shoppers of these sets left (see removeTestShopperData), plus `opts`. */
export async function removeFixtures(sets: FixtureSet[], opts: RemoveOptions) {
  return withTx(async () => {
    const out = await removeTestShopperData(shoppersOf(sets))
    const d = await db()
    let decisions = 0
    let reseedRows = 0
    if (opts.reasonPrefix) {
      if (!opts.reasonPrefix.startsWith(KIT_MARKER)) throw conflict(`reasonPrefix must start with "${KIT_MARKER}".`)
      const pattern = `${opts.reasonPrefix.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
      const who = await kitSubjects(sets)
      const subject = or(
        and(eq(accountRestrictions.subjectKind, "user"), inArray(accountRestrictions.subjectId, who.users)),
        who.brands.length ? and(eq(accountRestrictions.subjectKind, "brand"), inArray(accountRestrictions.subjectId, who.brands)) : undefined,
      )
      const ids = (await d.select({ id: accountRestrictions.id }).from(accountRestrictions).where(and(like(accountRestrictions.reason, pattern), subject))).map((r) => r.id)
      if (ids.length) {
        await d.delete(notifications).where(inArray(notifications.eventKey, ids.map((r) => `restriction:${r}`)))
        await d.delete(accountRestrictions).where(inArray(accountRestrictions.id, ids))
      }
      const subjects = [...who.users, ...who.brands, ...ids]
      const audits = await d
        .delete(auditLog)
        .where(
          or(
            and(like(auditLog.reason, pattern), inArray(auditLog.subjectId, subjects)),
            ids.length ? sql`${auditLog.meta}->>'restrictionId' in (${sql.join(ids.map((r) => sql`${r}`), sql`, `)})` : undefined,
          ),
        )
        .returning({ id: auditLog.id })
      decisions = ids.length + audits.length
    }
    if (opts.since) {
      const since = new Date(opts.since)
      if (!Number.isNaN(since.getTime()))
        reseedRows = (await d.delete(auditLog).where(and(eq(auditLog.action, "dev.reseeded"), inArray(auditLog.subjectId, ["inbox", "seed:inbox"]), gte(auditLog.at, since))).returning({ id: auditLog.id })).length
    }
    await releaseRun(sets)
    await writeAudit({
      actor: { kind: "admin", id: opts.by.id, name: opts.by.name, role: opts.by.role },
      action: "dev.fixtures_removed",
      target: `Inbox test data (${sets.join(", ")})`,
      subjectType: "dev_fixtures",
      subjectId: `inbox:${sets.join(",")}`,
      meta: { sets, conversations: out.conversations.length, messages: out.messages, media: out.media, notifications: out.notifications, decisions, reseedAuditRows: reseedRows, reasonPrefix: opts.reasonPrefix ?? null, since: opts.since ?? null },
    })
    return { ...out, decisions, reseedAuditRows: reseedRows }
  })
}
