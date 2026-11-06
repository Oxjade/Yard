import "server-only"
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm"
import { db, withTx } from "../db"
import { conversations, messageAttachments, messages, reports } from "../db/schema"
import { conflict, notFound } from "../http/errors"
import * as inbox from "../inbox"
import { mediaSrc } from "../media"
import { notify } from "../notify"
import { publish } from "../realtime/bus"
import { channels } from "../realtime/channels"
import { heldReasonLabel, type EvidenceResult, type HeldViewResult, type MessageCaseDto, type MessageListDto, type MessageTab } from "@/lib/api/contracts/admin"
import { normaliseEvidence } from "./evidence"
import {
  actionReports,
  ALREADY_DECIDED,
  assertCan,
  assertState,
  audit,
  brandMap,
  brandRefOf,
  iso,
  nameOf,
  OPEN_REPORT,
  notifyReporter,
  publishCountsAfterCommit,
  reasonLabel,
  reporterNames,
  toReportRef,
  tryFeature,
  userMap,
  type DecisionCtx,
} from "./shared"

/**
 * Admin › Messages (§8.1): metadata-first. Rows never carry a body; the frozen evidence and the
 * held message itself are opened through audited POSTs. There is no endpoint that browses a
 * conversation.
 */

type ReportRow = typeof reports.$inferSelect
type MessageRow = typeof messages.$inferSelect
type ConversationRow = typeof conversations.$inferSelect

const LIMIT = 200
const MESSAGE_SUBJECTS = ["message", "conversation"]
const CLOSED = ["actioned", "dismissed"]

async function conversationsFor(ids: string[]) {
  const d = await db()
  const out = new Map<string, ConversationRow>()
  if (!ids.length) return out
  for (const c of await d.select().from(conversations).where(inArray(conversations.id, [...new Set(ids)]))) out.set(c.id, c)
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
      customer: { id: c?.customerId ?? "", name: nameOf(people, c?.customerId, "Unknown shopper") },
      conversationId: c?.id ?? (r.subjectType === "conversation" ? r.subjectId : ""),
      messageId: m?.id ?? null,
      messageStatus: (m?.status as MessageCaseDto["messageStatus"]) ?? null,
      conversationLocked: !!c?.locked,
      spamScore: m ? m.spamScore : null,
      createdAt: r.createdAt.toISOString(),
      decidedAt: iso(r.decidedAt),
      decision: r.decision,
      sample: !!c?.sample,
    }
  })
}

async function heldCases(rows: MessageRow[]): Promise<MessageCaseDto[]> {
  const convs = await conversationsFor(rows.map((m) => m.conversationId))
  const brands = await brandMap([...convs.values()].map((c) => c.brandId))
  const people = await userMap([...convs.values()].map((c) => c.customerId))
  return rows.map((m) => {
    const c = convs.get(m.conversationId)
    return {
      id: m.id,
      kind: "held",
      status: m.status,
      reason: m.heldReason,
      reasonLabel: heldReasonLabel(m.heldReason),
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
    }
  })
}

async function spamCases(rows: ConversationRow[]): Promise<MessageCaseDto[]> {
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
  else if (tab === "spam") items = await spamCases(await d.select().from(conversations).where(inArray(conversations.spamState, ["suspected", "confirmed"])).orderBy(desc(conversations.lastMessageAt)).limit(LIMIT))
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
    const m = await d.query.messages.findFirst({ where: (x, { eq }) => eq(x.id, id) })
    if (!m || !m.heldReason) throw notFound()
    return (await heldCases([m]))[0]
  }
  if (id.startsWith("cv_")) {
    const c = await d.query.conversations.findFirst({ where: (x, { eq }) => eq(x.id, id) })
    if (!c) throw notFound()
    return (await spamCases([c]))[0]
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
      meta: { conversationId: row.conversationId, messages: evidence.kind === "messages" ? evidence.messages.length : 0 },
    })
    return { reportId: r.id, capturedAt: r.createdAt.toISOString(), evidence, audit: entry }
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
      meta: { conversationId: m.conversationId, side: m.senderSide },
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
    meta: { subjectType: r.subjectType, subjectId: r.subjectId },
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
  const c = (await d.query.conversations.findFirst({ where: (x, { eq }) => eq(x.id, m.conversationId) }))!
  const [updated] = await d
    .update(messages)
    .set({ status: "removed", removedBy: ctx.actor.userId, removedReason: body.reason })
    .where(and(eq(messages.id, m.id), inArray(messages.status, ["sent", "held"])))
    .returning()
  assertState(!!updated, ALREADY_DECIDED)
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
    meta: { conversationId: c.id, wasHeld: m.status === "held", reportIds: actioned.map((r) => r.id) },
  })
  // A held message was only ever on its sender's side; a sent one is on both.
  const dto = removedDto(updated)
  const sides = m.status === "held" ? [m.senderSide] : ["customer", "brand"]
  if (sides.includes("customer")) await publish(channels.user(c.customerId), "message.updated", { message: dto })
  if (sides.includes("brand")) await publish(channels.brand(c.brandId), "message.updated", { message: dto })
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
  const delivered = await tryFeature("inbox.releaseHeldMessage", () => inbox.releaseHeldMessage(m.id))
  const after = await d.query.messages.findFirst({ where: (x, { eq }) => eq(x.id, m.id) })
  // The inbox contract sets the status itself; while it's a stub, only the status changes.
  if (after?.status === "held") await d.update(messages).set({ status: "sent" }).where(eq(messages.id, m.id))
  const c = (await d.query.conversations.findFirst({ where: (x, { eq }) => eq(x.id, m.conversationId) }))!
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
  return { item: (await heldCases([fresh]))[0], audit: entry }
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
  const actioned = body.reportId ? await d.select().from(reports).where(eq(reports.id, body.reportId)) : []
  for (const r of actioned) await actionReports(ctx, r.subjectType, r.subjectId, { onlyId: r.id, subjectLabel: r.subjectType === "message" ? "a message" : "a conversation" })
  const brands = await brandMap([c.brandId])
  const people = await userMap([c.customerId])
  const entry = await audit(ctx, {
    action: "conversation.locked",
    target: `${nameOf(people, c.customerId)} and ${brandRefOf(brands, c.brandId).name}`,
    subjectType: "conversation",
    subjectId: c.id,
    brandId: c.brandId,
    reason: body.reason,
    meta: { reportId: body.reportId ?? null },
  })
  publishCountsAfterCommit()
  if (body.reportId) {
    const [r] = await d.select().from(reports).where(eq(reports.id, body.reportId))
    if (r) return { item: (await reportCases([r]))[0], audit: entry }
  }
  const fresh = (await d.query.conversations.findFirst({ where: (x, { eq }) => eq(x.id, c.id) }))!
  return { item: (await spamCases([fresh]))[0], audit: entry }
}
