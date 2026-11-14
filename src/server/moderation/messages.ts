import "server-only"
import { and, asc, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm"
import { db, withTx } from "../db"
import { accountRestrictions, auditLog, blocks, conversations, messageAttachments, messages, reports } from "../db/schema"
import { conflict, notFound } from "../http/errors"
import * as inbox from "../inbox"
import { asBrandConv, messageDtoFor, summaryFor, type ConvRow } from "../inbox/dto"
import { mediaSrc } from "../media"
import { publish } from "../realtime/bus"
import { channels } from "../realtime/channels"
import { heldReasonLabel, type EvidenceResult, type HeldViewResult, type MessageCaseDto, type MessageListDto, type MessageTab } from "@/lib/api/contracts/admin"
import { normaliseEvidence } from "./evidence"
import { setMediaModeration } from "./content"
import {
  actionReports,
  ALREADY_DECIDED,
  assertCan,
  assertState,
  audit,
  brandMap,
  brandRefOf,
  dateLabel,
  iso,
  kitMeta,
  nameOf,
  OPEN_REPORT,
  notifyReporter,
  publishCountsAfterCommit,
  reasonLabel,
  recordPriorNote,
  reportMeta,
  reporterNames,
  toReportRef,
  tryFeature,
  userMap,
  notify,
  type DecisionCtx,
} from "./shared"

/**
 * Admin › Messages (§8.1): metadata-first. Rows never carry a body; the frozen evidence and the
 * held message itself are opened through audited POSTs. There is no endpoint that browses a
 * conversation.
 */

type ReportRow = typeof reports.$inferSelect
type MessageRow = typeof messages.$inferSelect
/** Moderation covers shopper–brand conversations only: Yard Support threads are Yard's own. */
type ConversationRow = ConvRow

const LIMIT = 200
const MESSAGE_SUBJECTS = ["message", "conversation"]
const CLOSED = ["actioned", "dismissed"]

async function conversationsFor(ids: string[]) {
  const d = await db()
  const out = new Map<string, ConversationRow>()
  if (!ids.length) return out
  for (const row of await d.select().from(conversations).where(inArray(conversations.id, [...new Set(ids)]))) {
    const c = asBrandConv(row)
    if (c) out.set(c.id, c)
  }
  return out
}

async function messagesFor(ids: string[]) {
  const d = await db()
  const out = new Map<string, MessageRow>()
  if (!ids.length) return out
  for (const m of await d.select().from(messages).where(inArray(messages.id, [...new Set(ids)]))) out.set(m.id, m)
  return out
}

/** Report rows → queue rows (the conversation and sides resolved from the subject). */
async function reportCases(rows: ReportRow[]): Promise<MessageCaseDto[]> {
  const msgs = await messagesFor(rows.filter((r) => r.subjectType === "message").map((r) => r.subjectId))
  const convIds = rows.map((r) => (r.subjectType === "message" ? msgs.get(r.subjectId)?.conversationId : r.subjectId)).filter((x): x is string => !!x)
  const convs = await conversationsFor(convIds)
  const brands = await brandMap([...convs.values()].map((c) => c.brandId).concat(rows.map((r) => r.brandId ?? "")))
  const people = await userMap([...convs.values()].map((c) => c.customerId))
  const reporter = await reporterNames(rows)
  return rows.map((r) => {
    const m = r.subjectType === "message" ? msgs.get(r.subjectId) : undefined
    const c = convs.get(m?.conversationId ?? r.subjectId)
    return {
      id: r.id,
      kind: "report",
      status: r.status,
      reason: r.reason,
      reasonLabel: reasonLabel(r.reason),
      side: (m?.senderSide as MessageCaseDto["side"]) ?? null,
      subjectType: r.subjectType as "message" | "conversation",
      reporter: { kind: r.reporterKind as NonNullable<MessageCaseDto["reporter"]>["kind"], id: r.reporterId, name: reporter(r) },
      brand: brandRefOf(brands, c?.brandId ?? r.brandId),
      customer: c ? { id: c.customerId, name: nameOf(people, c.customerId, "Unknown shopper") } : { id: "", name: "Subject deleted" },
      conversationId: c?.id ?? (r.subjectType === "conversation" ? r.subjectId : ""),
      messageId: m?.id ?? null,
      messageStatus: (m?.status as MessageCaseDto["messageStatus"]) ?? null,
      conversationLocked: !!c?.locked,
      spamScore: m ? m.spamScore : null,
      createdAt: r.createdAt.toISOString(),
      decidedAt: iso(r.decidedAt),
      decision: r.decision,
      sample: !!c?.sample,
      subjectGone: !c || (r.subjectType === "message" && !m),
    }
  })
}

/**
 * Why Release would be refused right now, in the words the held sheet shows. A release delivers the
 * message as if just sent, so it must pass what a send passes (I's shopperCanInteract and
 * brandCanInteract): the conversation's lock, blocks either way, the brand's status, the sender's
 * account status and messaging restriction.
 */
async function releaseBlockers(rows: MessageRow[], convs: Map<string, ConversationRow>): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  const held = rows.filter((m) => m.status === "held" && convs.has(m.conversationId))
  if (!held.length) return out
  const cs = held.map((m) => convs.get(m.conversationId)!)
  const brandIds = [...new Set(cs.map((c) => c.brandId))]
  const customerIds = [...new Set(cs.map((c) => c.customerId))]
  const d = await db()
  const [bs, people] = [await brandMap(brandIds), await userMap(customerIds)]
  const blockRows = await d
    .select({ blockerKind: blocks.blockerKind, blockerId: blocks.blockerId, blockedId: blocks.blockedId })
    .from(blocks)
    .where(
      or(
        and(eq(blocks.blockerKind, "shopper"), inArray(blocks.blockerId, customerIds), eq(blocks.blockedKind, "brand"), inArray(blocks.blockedId, brandIds)),
        and(eq(blocks.blockerKind, "brand"), inArray(blocks.blockerId, brandIds), eq(blocks.blockedKind, "shopper"), inArray(blocks.blockedId, customerIds)),
      ),
    )
  const now = new Date()
  const restrictions = await d
    .select({ subjectKind: accountRestrictions.subjectKind, subjectId: accountRestrictions.subjectId, until: accountRestrictions.until })
    .from(accountRestrictions)
    .where(
      and(
        eq(accountRestrictions.kind, "messaging"),
        eq(accountRestrictions.status, "active"),
        or(isNull(accountRestrictions.until), gt(accountRestrictions.until, now)),
        or(and(eq(accountRestrictions.subjectKind, "user"), inArray(accountRestrictions.subjectId, customerIds)), and(eq(accountRestrictions.subjectKind, "brand"), inArray(accountRestrictions.subjectId, brandIds))),
      ),
    )
  const ends = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`)
  for (const m of held) {
    const c = convs.get(m.conversationId)!
    const brand = bs.get(c.brandId)
    const brandName = brand?.name ?? "The brand"
    const shopper = nameOf(people, c.customerId, "This shopper")
    const why: string[] = []
    if (c.locked) why.push("This conversation was locked by Yard.")
    if (!brand || brand.reviewStatus === "suspended" || brand.reviewStatus === "restricted") {
      const state = brand?.reviewStatus === "restricted" ? "restricted" : "suspended"
      why.push(m.senderSide === "brand" ? ends(`Yard has ${state} ${brandName}, so its replies are paused`) : ends(`${brandName} is ${state} on Yard, so it isn't taking messages`))
    }
    if (blockRows.some((b) => b.blockerKind === "brand" && b.blockerId === c.brandId && b.blockedId === c.customerId)) why.push(ends(`${brandName} has blocked ${shopper}`))
    if (blockRows.some((b) => b.blockerKind === "shopper" && b.blockerId === c.customerId && b.blockedId === c.brandId)) why.push(ends(`${shopper} has blocked ${brandName}`))
    if (m.senderSide === "customer") {
      if (people.get(c.customerId)?.status === "suspended") why.push(`${shopper}'s account is suspended.`)
      const r = restrictions.find((x) => x.subjectKind === "user" && x.subjectId === c.customerId)
      if (r) why.push(r.until ? `Messaging is paused on ${shopper}'s account until ${dateLabel(r.until)}.` : `Messaging is paused on ${shopper}'s account.`)
    } else if (m.senderSide === "brand") {
      const r = restrictions.find((x) => x.subjectKind === "brand" && x.subjectId === c.brandId)
      if (r) why.push(r.until ? `Yard paused replies from ${brandName} until ${dateLabel(r.until)}.` : ends(`Yard paused replies from ${brandName}`))
    }
    if (why.length) out.set(m.id, why)
  }
  return out
}

/** `released`: messages Yard released, by id → the reason they were held (I clears held_reason on release; the audit row keeps it). */
async function heldCases(rows: MessageRow[], released: Map<string, string | null> = new Map()): Promise<MessageCaseDto[]> {
  const convs = await conversationsFor(rows.map((m) => m.conversationId))
  const brands = await brandMap([...convs.values()].map((c) => c.brandId))
  const people = await userMap([...convs.values()].map((c) => c.customerId))
  const blockers = await releaseBlockers(rows, convs)
  return rows.map((m) => {
    const c = convs.get(m.conversationId)
    const wasHeld = released.has(m.id)
    const heldReason = m.heldReason ?? (wasHeld ? (released.get(m.id) ?? null) : null)
    return {
      id: m.id,
      kind: "held",
      status: m.status,
      reason: heldReason,
      // A message removed without ever being held (a direct removal) has no held reason to name.
      reasonLabel: heldReason || wasHeld ? heldReasonLabel(heldReason) : m.status === "removed" ? "Removed by Yard" : "Delivered",
      side: m.senderSide as MessageCaseDto["side"],
      subjectType: null,
      reporter: null,
      brand: brandRefOf(brands, c?.brandId),
      customer: { id: c?.customerId ?? "", name: nameOf(people, c?.customerId, "Unknown shopper") },
      conversationId: m.conversationId,
      messageId: m.id,
      messageStatus: m.status as MessageCaseDto["messageStatus"],
      conversationLocked: !!c?.locked,
      spamScore: m.spamScore,
      createdAt: m.createdAt.toISOString(),
      decidedAt: null,
      decision: m.status === "removed" ? "removed" : m.status === "sent" ? "released" : null,
      sample: !!c?.sample,
      subjectGone: !c,
      ...(m.status === "held" ? { blockers: blockers.get(m.id) ?? [] } : {}),
    }
  })
}

/** Messages Yard released (a message.released audit row) → the held reason each had. */
async function releasedReasons(ids: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>()
  if (!ids.length) return out
  const d = await db()
  const rows = await d
    .select({ subjectId: auditLog.subjectId, meta: auditLog.meta })
    .from(auditLog)
    .where(and(eq(auditLog.action, "message.released"), eq(auditLog.subjectType, "message"), inArray(auditLog.subjectId, ids)))
    .orderBy(desc(auditLog.at))
  for (const r of rows) {
    if (!r.subjectId || out.has(r.subjectId)) continue
    const h = (r.meta as { heldReason?: unknown } | null)?.heldReason
    out.set(r.subjectId, typeof h === "string" ? h : null)
  }
  return out
}

/** Conversations with a spam signal (suspected or confirmed). One without a signal is no case at all. */
async function spamCases(all: ConversationRow[]): Promise<MessageCaseDto[]> {
  const rows = all.filter((c) => c.spamState === "suspected" || c.spamState === "confirmed")
  const brands = await brandMap(rows.map((c) => c.brandId))
  const people = await userMap(rows.map((c) => c.customerId))
  return rows.map((c) => ({
    id: c.id,
    kind: "spam",
    status: c.spamState,
    reason: c.spamState === "confirmed" ? "spam_marked_by_brand" : "spam_suspected",
    reasonLabel: c.spamState === "confirmed" ? "Marked as spam by the brand" : "Suspected spam",
    side: "customer",
    subjectType: "conversation",
    reporter: null,
    brand: brandRefOf(brands, c.brandId),
    customer: { id: c.customerId, name: nameOf(people, c.customerId, "Unknown shopper") },
    conversationId: c.id,
    messageId: null,
    messageStatus: null,
    conversationLocked: c.locked,
    spamScore: null,
    createdAt: (c.lastMessageAt ?? c.createdAt).toISOString(),
    decidedAt: null,
    decision: null,
    sample: c.sample,
    subjectGone: false,
  }))
}

export async function messageCounts() {
  const d = await db()
  const one = (rows: { n: number }[]) => Number(rows[0]?.n ?? 0)
  const [reported, held, spam, closed] = await Promise.all([
    d.select({ n: sql<number>`count(*)::int` }).from(reports).where(and(inArray(reports.subjectType, MESSAGE_SUBJECTS), inArray(reports.status, [...OPEN_REPORT]))).then(one),
    d.select({ n: sql<number>`count(*)::int` }).from(messages).where(eq(messages.status, "held")).then(one),
    d.select({ n: sql<number>`count(*)::int` }).from(conversations).where(inArray(conversations.spamState, ["suspected", "confirmed"])).then(one),
    d.select({ n: sql<number>`count(*)::int` }).from(reports).where(and(inArray(reports.subjectType, MESSAGE_SUBJECTS), inArray(reports.status, CLOSED))).then(one),
  ])
  return { reported, held, spam, closed }
}

export async function listMessages(tab: MessageTab): Promise<MessageListDto> {
  const d = await db()
  let items: MessageCaseDto[]
  if (tab === "held") items = await heldCases(await d.select().from(messages).where(eq(messages.status, "held")).orderBy(asc(messages.createdAt)).limit(LIMIT))
  else if (tab === "spam") items = await spamCases((await d.select().from(conversations).where(and(eq(conversations.kind, "brand"), inArray(conversations.spamState, ["suspected", "confirmed"]))).orderBy(desc(conversations.lastMessageAt)).limit(LIMIT)).map(asBrandConv).filter((c): c is ConvRow => !!c))
  else if (tab === "closed")
    items = await reportCases(await d.select().from(reports).where(and(inArray(reports.subjectType, MESSAGE_SUBJECTS), inArray(reports.status, CLOSED))).orderBy(desc(reports.decidedAt)).limit(LIMIT))
  else
    items = await reportCases(
      await d
        .select()
        .from(reports)
        .where(and(inArray(reports.subjectType, MESSAGE_SUBJECTS), inArray(reports.status, [...OPEN_REPORT])))
        .orderBy(asc(reports.priority), asc(reports.createdAt))
        .limit(LIMIT),
    )
  return { tab, items, counts: await messageCounts(), nextCursor: null }
}

/** One case by id: a report (rp_*), a held message (msg_*) or a spam-signal conversation (cv_*). */
export async function messageCase(id: string): Promise<MessageCaseDto> {
  const d = await db()
  if (id.startsWith("msg_")) {
    // A held message, or one Yard has since released (its case reads Released, with no actions left).
    // Any other message is no case: admins never browse conversations (§8.1).
    const m = await d.query.messages.findFirst({ where: (x, { eq }) => eq(x.id, id) })
    if (!m) throw notFound()
    if (m.heldReason) return (await heldCases([m]))[0]
    const released = await releasedReasons([m.id])
    if (!released.has(m.id)) throw notFound()
    return (await heldCases([m], released))[0]
  }
  if (id.startsWith("cv_")) {
    // Only a conversation with a spam signal is a spam case. One a report names opens as that report's
    // case; any other conversation id is 404 (no browsing by id, and no signal implied that isn't there).
    const c = asBrandConv(await d.query.conversations.findFirst({ where: (x, { eq }) => eq(x.id, id) }))
    if (!c) throw notFound()
    const [spam] = await spamCases([c])
    if (spam) return spam
    const [r] = await d.select().from(reports).where(and(eq(reports.subjectType, "conversation"), eq(reports.subjectId, c.id))).orderBy(desc(reports.createdAt)).limit(1)
    if (r) return (await reportCases([r]))[0]
    throw notFound()
  }
  const r = await d.query.reports.findFirst({ where: (x, { and, eq, inArray }) => and(eq(x.id, id), inArray(x.subjectType, MESSAGE_SUBJECTS)) })
  if (!r) throw notFound()
  return (await reportCases([r]))[0]
}

/** POST …/messages/{reportId}/evidence: the frozen snapshot, audited as message_context.viewed. */
export async function viewEvidence(ctx: DecisionCtx, reportId: string): Promise<EvidenceResult> {
  return withTx(async () => {
    const d = await db()
    const r = await d.query.reports.findFirst({ where: (x, { and, eq, inArray }) => and(eq(x.id, reportId), inArray(x.subjectType, MESSAGE_SUBJECTS)) })
    if (!r) throw notFound()
    const [row] = await reportCases([r])
    const evidence = normaliseEvidence(r.snapshot, { reportedMessageId: r.subjectType === "message" ? r.subjectId : null, customerName: row.customer.name, brandName: row.brand.name })
    const entry = await audit(ctx, {
      action: "message_context.viewed",
      target: `Report on a ${r.subjectType} between ${row.customer.name} and ${row.brand.name}`,
      subjectType: "report",
      subjectId: r.id,
      brandId: row.brand.id || null,
      meta: { conversationId: row.conversationId, messages: evidence.kind === "messages" ? evidence.messages.length : 0, ...kitMeta(ctx) },
    })
    return { reportId: r.id, capturedAt: r.createdAt.toISOString(), details: r.details, evidence, audit: entry }
  })
}

/** POST …/messages/held/{messageId}/view: the held message itself (it is the evidence), audited. */
export async function viewHeld(ctx: DecisionCtx, messageId: string): Promise<HeldViewResult> {
  return withTx(async () => {
    const d = await db()
    const m = await d.query.messages.findFirst({ where: (x, { eq }) => eq(x.id, messageId) })
    if (!m) throw notFound()
    if (m.status !== "held") throw conflict("This message isn't held any more, so it can't be opened here.")
    const [row] = await heldCases([m])
    const atts = await d.select({ mediaId: messageAttachments.mediaId }).from(messageAttachments).where(eq(messageAttachments.messageId, m.id)).orderBy(asc(messageAttachments.position))
    const entry = await audit(ctx, {
      action: "message_held.viewed",
      target: `Held message from ${m.senderSide === "brand" ? row.brand.name : row.customer.name}`,
      subjectType: "message",
      subjectId: m.id,
      brandId: row.brand.id || null,
      meta: { conversationId: m.conversationId, side: m.senderSide, ...kitMeta(ctx) },
    })
    return {
      message: {
        id: m.id,
        side: m.senderSide as "customer" | "brand" | "system",
        sender: m.senderSide === "brand" ? row.brand.name : row.customer.name,
        kind: m.kind,
        body: m.body,
        at: m.createdAt.toISOString(),
        reported: false,
        status: m.status,
        attachments: atts.map((a) => ({ mediaId: a.mediaId, src: mediaSrc(a.mediaId, "admin") })),
        product: m.productSnapshot?.name ?? null,
        order: m.orderSnapshot?.reference ?? null,
        heldReason: m.heldReason,
        heldReasonLabel: heldReasonLabel(m.heldReason),
      },
      audit: entry,
    }
  })
}

/** The permission a report decision needs: per subject, and per outcome for message reports (§8.1). */
export function reportPermission(subjectType: string, outcome: "dismiss" | "escalate") {
  if (subjectType === "social_post") return "content.moderate" as const
  if (subjectType === "location" || subjectType === "location_event") return "places.moderate" as const
  return outcome === "escalate" ? ("messages.view_reports" as const) : ("messages.moderate" as const)
}

const subjectWords: Record<string, string> = { message: "a message", conversation: "a conversation", social_post: "a post", location: "a place", location_event: "an event" }

/** decide-report: dismiss (no action) or escalate. Works for every report subject. */
export async function decideReport(ctx: DecisionCtx, body: { id: string; outcome: "dismiss" | "escalate"; reason: string }) {
  const d = await db()
  const r = await d.query.reports.findFirst({ where: (x, { eq }) => eq(x.id, body.id) })
  if (!r) throw notFound()
  assertCan(ctx.actor, reportPermission(r.subjectType, body.outcome))
  const allowed = body.outcome === "dismiss" ? ["open", "in_review", "escalated"] : ["open", "in_review"]
  assertState(allowed.includes(r.status))
  const now = new Date()
  const next = body.outcome === "dismiss" ? { status: "dismissed", decidedBy: ctx.actor.userId, decidedAt: now, decision: "dismissed" } : { status: "escalated", decision: "escalated" }
  const [updated] = await d
    .update(reports)
    .set(next)
    .where(and(eq(reports.id, r.id), inArray(reports.status, allowed)))
    .returning()
  assertState(!!updated)
  const entry = await audit(ctx, {
    action: body.outcome === "dismiss" ? "report.dismissed" : "report.escalated",
    target: `Report on ${subjectWords[r.subjectType] ?? r.subjectType}: ${reasonLabel(r.reason).toLowerCase()}`,
    subjectType: "report",
    subjectId: r.id,
    brandId: r.brandId,
    reason: body.reason,
    meta: { subjectType: r.subjectType, subjectId: r.subjectId, from: r.status },
  })
  if (body.outcome === "dismiss") {
    await notifyReporter(updated, subjectWords[r.subjectType]?.replace(/^an? /, "the ") ?? "your report")
  }
  publishCountsAfterCommit()
  return { item: await caseForReport(updated), audit: entry }
}

/** The queue row for a decided report, whatever its subject. */
async function caseForReport(r: ReportRow) {
  if (MESSAGE_SUBJECTS.includes(r.subjectType)) return (await reportCases([r]))[0]
  const name = await reporterNames([r])
  return toReportRef(r, name(r))
}

/** The minimal DTO a removal publishes: the clients show "Message removed by Yard" (§6.2). */
function removedDto(m: MessageRow) {
  return { id: m.id, seq: m.seq, conversationId: m.conversationId, side: m.senderSide, kind: m.kind, body: null, attachments: [], status: "removed", createdAt: m.createdAt.toISOString(), clientId: m.clientId }
}

async function reportOnConversation(reportId: string | undefined, subjects: { messageId?: string; conversationId: string }) {
  if (!reportId) return
  const d = await db()
  const r = await d.query.reports.findFirst({ where: (x, { eq }) => eq(x.id, reportId) })
  const matches = r && ((r.subjectType === "message" && r.subjectId === subjects.messageId) || (r.subjectType === "conversation" && r.subjectId === subjects.conversationId))
  if (!matches) throw notFound("That report isn't about this message.")
}

/** remove-message: both parties see "Message removed by Yard"; reports on it are actioned. */
export async function removeMessage(ctx: DecisionCtx, body: { id: string; reason: string; reportId?: string }) {
  const d = await db()
  const m = await d.query.messages.findFirst({ where: (x, { eq }) => eq(x.id, body.id) })
  if (!m) throw notFound()
  assertState(m.status !== "removed")
  await reportOnConversation(body.reportId, { messageId: m.id, conversationId: m.conversationId })
  const c = asBrandConv(await d.query.conversations.findFirst({ where: (x, { eq }) => eq(x.id, m.conversationId) }))
  if (!c) throw notFound()
  const [updated] = await d
    .update(messages)
    .set({ status: "removed", removedBy: ctx.actor.userId, removedReason: body.reason })
    .where(and(eq(messages.id, m.id), inArray(messages.status, ["sent", "held"])))
    .returning()
  assertState(!!updated, ALREADY_DECIDED)
  // Its attachments go with it: F2's media serve refuses removed files to the sender and the other
  // side (§5.4), and admins still open them through the report's evidence.
  const attached = await d.select({ mediaId: messageAttachments.mediaId }).from(messageAttachments).where(eq(messageAttachments.messageId, m.id))
  await setMediaModeration(attached.map((a) => a.mediaId), "removed")
  if (c.lastMessageSeq === m.seq) await d.update(conversations).set({ lastPreview: "Message removed by Yard" }).where(eq(conversations.id, c.id))
  const actioned = [
    ...(await actionReports(ctx, "message", m.id, { subjectLabel: "a message" })),
    ...(body.reportId ? await actionReports(ctx, "conversation", c.id, { onlyId: body.reportId, subjectLabel: "a conversation" }) : []),
  ]
  const brands = await brandMap([c.brandId])
  const people = await userMap([c.customerId])
  const sender = m.senderSide === "brand" ? brandRefOf(brands, c.brandId).name : nameOf(people, c.customerId)
  const entry = await audit(ctx, {
    action: "message.removed",
    target: `Message from ${sender} in ${nameOf(people, c.customerId)} and ${brandRefOf(brands, c.brandId).name}'s conversation`,
    subjectType: "message",
    subjectId: m.id,
    brandId: c.brandId,
    reason: body.reason,
    meta: { conversationId: c.id, wasHeld: m.status === "held", ...reportMeta(actioned), attachments: attached.length },
  })
  // A held message was only ever on its sender's side; a sent one is on both. Each side gets I's own
  // DTOs (body and attachments null on the wire) with its conversation summary, so the list preview
  // ("Message removed by Yard") changes at once instead of waiting for a refetch.
  const sides = (m.status === "held" ? [m.senderSide] : ["customer", "brand"]).filter((x): x is "customer" | "brand" => x === "customer" || x === "brand")
  for (const side of sides) {
    const message = (await messageDtoFor(m.id, side)) ?? removedDto(updated)
    const conversation = await summaryFor(c.id, side)
    await publish(side === "customer" ? channels.user(c.customerId) : channels.brand(c.brandId), "message.updated", { message, conversation: conversation ?? undefined })
  }
  // The sender hears why (the reason is shared with them, §8.1).
  if (m.senderSide === "customer") await notify({ kind: "shopper", id: c.customerId }, { key: `msg-removed:${m.id}`, template: "content.removed", vars: { kind: "message", reason: body.reason }, href: `/inbox?thread=${c.id}` })
  else if (m.senderSide === "brand") await notify({ kind: "brand", id: c.brandId }, { key: `msg-removed:${m.id}`, template: "content.removed", vars: { kind: "message", reason: body.reason }, href: `/studio/inbox?thread=${c.id}` })
  publishCountsAfterCommit()
  return { item: (await heldOrReportCase(updated, body.reportId)) ?? (await heldCases([updated]))[0], audit: entry }
}

async function heldOrReportCase(m: MessageRow, reportId?: string) {
  const d = await db()
  if (reportId) {
    const r = await d.query.reports.findFirst({ where: (x, { eq }) => eq(x.id, reportId) })
    if (r) return (await reportCases([r]))[0]
  }
  return m.heldReason ? (await heldCases([m]))[0] : null
}

/** release-held-message: delivers it as if just sent (I's inbox.releaseHeldMessage does steps 9–12). */
export async function releaseHeld(ctx: DecisionCtx, body: { id: string; reason: string }) {
  const d = await db()
  const m = await d.query.messages.findFirst({ where: (x, { eq }) => eq(x.id, body.id) })
  if (!m) throw notFound()
  assertState(m.status === "held")
  // Release delivers it as if just sent, so it's refused for whatever would refuse that send now.
  const convs = await conversationsFor([m.conversationId])
  const why = (await releaseBlockers([m], convs)).get(m.id)
  if (why?.length) throw conflict(`${why.join(" ")} Release is off; remove the message or leave it held.`)
  // I's delivery refreshes the receiver's "New message from …" item (msg:<conversation>); record it first (development).
  const conv = convs.get(m.conversationId)
  if (conv) await recordPriorNote(m.senderSide === "brand" ? { kind: "shopper", id: conv.customerId } : { kind: "brand", id: conv.brandId }, `msg:${conv.id}`)
  const delivered = await tryFeature("inbox.releaseHeldMessage", () => inbox.releaseHeldMessage(m.id))
  const after = await d.query.messages.findFirst({ where: (x, { eq }) => eq(x.id, m.id) })
  // The inbox contract sets the status itself; while it's a stub, only the status changes. heldReason
  // goes too, as I's release clears it: a delivered message must read as delivered to the inbox's
  // visibleTo, so a later removal shows on both sides.
  if (after?.status === "held") await d.update(messages).set({ status: "sent", heldReason: null }).where(eq(messages.id, m.id))
  const c = asBrandConv(await d.query.conversations.findFirst({ where: (x, { eq }) => eq(x.id, m.conversationId) }))
  if (!c) throw notFound()
  const brands = await brandMap([c.brandId])
  const people = await userMap([c.customerId])
  const entry = await audit(ctx, {
    action: "message.released",
    target: `Held message from ${m.senderSide === "brand" ? brandRefOf(brands, c.brandId).name : nameOf(people, c.customerId)} to ${m.senderSide === "brand" ? nameOf(people, c.customerId) : brandRefOf(brands, c.brandId).name}`,
    subjectType: "message",
    subjectId: m.id,
    brandId: c.brandId,
    reason: body.reason,
    meta: { conversationId: c.id, heldReason: m.heldReason, delivered: delivered.ok },
  })
  publishCountsAfterCommit()
  const fresh = (await d.query.messages.findFirst({ where: (x, { eq }) => eq(x.id, m.id) }))!
  return { item: (await heldCases([fresh], new Map([[m.id, m.heldReason]])))[0], audit: entry }
}

/** lock-conversation: nobody can send in it any more; both sides see Yard's notice. */
export async function lockConversation(ctx: DecisionCtx, body: { id: string; reason: string; reportId?: string }) {
  const d = await db()
  const c = await d.query.conversations.findFirst({ where: (x, { eq }) => eq(x.id, body.id) })
  if (!c) throw notFound()
  assertState(!c.locked, "This conversation is already locked — refreshed.")
  if (body.reportId) {
    const r = await d.query.reports.findFirst({ where: (x, { eq }) => eq(x.id, body.reportId!) })
    const ok = r && ((r.subjectType === "conversation" && r.subjectId === c.id) || (r.subjectType === "message" && (await d.query.messages.findFirst({ where: (x, { eq }) => eq(x.id, r.subjectId) }))?.conversationId === c.id))
    if (!ok) throw notFound("That report isn't about this conversation.")
  }
  await d.update(conversations).set({ locked: true }).where(eq(conversations.id, c.id))
  await tryFeature("inbox.publishSystemNotice", () => inbox.publishSystemNotice(c.id, "This conversation was closed by Yard."))
  const named = body.reportId ? await d.select().from(reports).where(eq(reports.id, body.reportId)) : []
  const actioned: Awaited<ReturnType<typeof actionReports>> = []
  for (const r of named) actioned.push(...(await actionReports(ctx, r.subjectType, r.subjectId, { onlyId: r.id, subjectLabel: r.subjectType === "message" ? "a message" : "a conversation" })))
  const brands = await brandMap([c.brandId])
  const people = await userMap([c.customerId])
  const entry = await audit(ctx, {
    action: "conversation.locked",
    target: `${nameOf(people, c.customerId)} and ${brandRefOf(brands, c.brandId).name}`,
    subjectType: "conversation",
    subjectId: c.id,
    brandId: c.brandId,
    reason: body.reason,
    meta: { reportId: body.reportId ?? null, ...reportMeta(actioned) },
  })
  publishCountsAfterCommit()
  if (body.reportId) {
    const [r] = await d.select().from(reports).where(eq(reports.id, body.reportId))
    if (r) return { item: (await reportCases([r]))[0], audit: entry }
  }
  const fresh = asBrandConv(await d.query.conversations.findFirst({ where: (x, { eq }) => eq(x.id, c.id) }))!
  return { item: (await spamCases([fresh]))[0] ?? null, audit: entry }
}
