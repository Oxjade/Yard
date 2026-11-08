import "server-only"
import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import type { ConversationSummary, MessageDto } from "@/lib/api/contracts/inbox"
import { brandById } from "@/lib/data/brands"
import { db } from "../db"
import { brands, conversationParticipants, conversations, mediaAssets, messageAttachments, messageReactions, messages, users } from "../db/schema"

/**
 * DTO builders (§6.2). Every response and every realtime payload is built here, one per side, so
 * a held or removed body never reaches the wrong side: the other side's held messages are never
 * selected, removed bodies and attachments are null on the wire, and attachment srcs always go
 * through /api/media/<id>?as=<side>.
 */

export type Side = "customer" | "brand"
export type ConvRow = typeof conversations.$inferSelect
export type MessageRow = typeof messages.$inferSelect

export const iso = (v: Date | string | null | undefined) => (v == null ? null : (v instanceof Date ? v : new Date(v)).toISOString())

const lm = alias(messages, "lm")

/** `exists` checks for blocks in each direction, from a conversation row. */
export const blockedByCustomerSql = sql<boolean>`exists(select 1 from blocks bk where bk.blocker_kind = 'shopper' and bk.blocker_id = ${conversations.customerId} and bk.blocked_kind = 'brand' and bk.blocked_id = ${conversations.brandId})`
export const blockedByBrandSql = sql<boolean>`exists(select 1 from blocks bk where bk.blocker_kind = 'brand' and bk.blocker_id = ${conversations.brandId} and bk.blocked_kind = 'shopper' and bk.blocked_id = ${conversations.customerId})`
/** Newest activity first: the last delivered message, else when the conversation started. */
export const sortKeySql = sql<string>`coalesce(${conversations.lastMessageAt}, ${conversations.createdAt})`

function ownHeldSql(side: Side) {
  return sql<string | null>`(select max(hm.created_at) from messages hm where hm.conversation_id = ${conversations.id} and hm.status = 'held' and hm.sender_side = ${side} and hm.seq > ${conversations.lastMessageSeq})`
}

function summaryFields(side: Side) {
  return {
    c: conversations,
    brandHandle: brands.handle,
    brandName: brands.name,
    brandReview: brands.reviewStatus,
    customerName: users.name,
    unread: conversationParticipants.unreadCount,
    markedUnread: conversationParticipants.markedUnread,
    archived: conversationParticipants.archived,
    muted: conversationParticipants.muted,
    lastSide: lm.senderSide,
    blockedByCustomer: blockedByCustomerSql,
    blockedByBrand: blockedByBrandSql,
    ownHeldAt: ownHeldSql(side),
    sortKey: sortKeySql,
  }
}

/** The list/summary query for one side, with any extra conditions, newest first. */
export async function selectSummaries(side: Side, where: SQL | undefined, opts: { limit?: number } = {}) {
  const d = await db()
  const q = d
    .select(summaryFields(side))
    .from(conversations)
    .innerJoin(brands, eq(brands.id, conversations.brandId))
    .innerJoin(users, eq(users.id, conversations.customerId))
    .innerJoin(conversationParticipants, and(eq(conversationParticipants.conversationId, conversations.id), eq(conversationParticipants.side, side)))
    .leftJoin(lm, and(eq(lm.conversationId, conversations.id), eq(lm.seq, conversations.lastMessageSeq)))
    .where(where)
    .orderBy(desc(sortKeySql), desc(conversations.id))
  return opts.limit ? q.limit(opts.limit) : q
}

export type SummaryRow = Awaited<ReturnType<typeof selectSummaries>>[number]

export function toSummary(r: SummaryRow, side: Side): ConversationSummary {
  const c = r.c
  const staticBrand = brandById.get(c.brandId)
  const heldAt = iso(r.ownHeldAt)
  const lastAt = iso(c.lastMessageAt)
  let lastMessage: ConversationSummary["lastMessage"] = null
  if (heldAt && (!lastAt || heldAt >= lastAt)) lastMessage = { preview: "Held for review", at: heldAt, side, held: true }
  else if (lastAt && c.lastMessageSeq > 0) lastMessage = { preview: c.lastPreview, at: lastAt, side: (r.lastSide as "customer" | "brand" | "system" | null) ?? "customer" }
  return {
    id: c.id,
    brand: { id: c.brandId, handle: r.brandHandle, name: r.brandName, mark: { text: staticBrand?.mark.text ?? r.brandName.slice(0, 2).toUpperCase(), style: staticBrand?.mark.style ?? "grotesk" }, verified: r.brandReview === "verified" },
    customer: side === "brand" ? { id: c.customerId, name: r.customerName } : undefined,
    status: c.status as "open" | "resolved",
    // Moderation signals stay with the brand: a marked shopper never learns who marked them (§5.2).
    spamState: side === "brand" ? (c.spamState as "none" | "suspected" | "confirmed") : "none",
    locked: c.locked,
    lastMessage,
    unread: r.unread,
    markedUnread: r.markedUnread,
    archived: r.archived,
    muted: r.muted,
    blocked: side === "customer" ? { byMe: !!r.blockedByCustomer, byThem: !!r.blockedByBrand } : { byMe: !!r.blockedByBrand, byThem: !!r.blockedByCustomer },
    sample: c.sample,
    createdAt: iso(c.createdAt)!,
  }
}

/** One conversation's summary for a side (inside the caller's transaction, so it sees its writes). */
export async function summaryFor(conversationId: string, side: Side) {
  const [row] = await selectSummaries(side, eq(conversations.id, conversationId), { limit: 1 })
  return row ? toSummary(row, side) : null
}

/** Which messages a side may see: delivered and removed ones, plus its own held messages. */
export function visibleTo(side: Side) {
  // A held message Yard removed never reached the other side, so only its sender sees the
  // "Message removed by Yard" bubble; a delivered message Yard removed shows to both (N, from M2).
  return sql`(${messages.status} = 'sent' or (${messages.status} = 'removed' and (${messages.heldReason} is null or ${messages.senderSide} = ${side})) or (${messages.status} = 'held' and ${messages.senderSide} = ${side}))`
}

const asOf = (side: Side) => (side === "customer" ? "shopper" : "brand")

/** Message DTOs for one side, with attachments and reactions, in the order given. */
export async function toMessageDtos(rows: MessageRow[], side: Side): Promise<MessageDto[]> {
  if (!rows.length) return []
  const d = await db()
  const ids = rows.map((m) => m.id)
  const [atts, reacts] = await Promise.all([
    d
      .select({ messageId: messageAttachments.messageId, mediaId: messageAttachments.mediaId, position: messageAttachments.position, width: mediaAssets.width, height: mediaAssets.height, moderation: mediaAssets.moderationStatus })
      .from(messageAttachments)
      .innerJoin(mediaAssets, eq(mediaAssets.id, messageAttachments.mediaId))
      .where(inArray(messageAttachments.messageId, ids))
      .orderBy(asc(messageAttachments.position)),
    d.select({ messageId: messageReactions.messageId, side: messageReactions.side }).from(messageReactions).where(inArray(messageReactions.messageId, ids)),
  ])
  return rows.map((m) => {
    const removed = m.status === "removed"
    const mine = m.senderSide === side
    const r = reacts.filter((x) => x.messageId === m.id)
    const dto: MessageDto = {
      id: m.id,
      seq: m.seq,
      conversationId: m.conversationId,
      side: m.senderSide as MessageDto["side"],
      kind: m.kind as MessageDto["kind"],
      body: removed ? null : m.body,
      attachments: removed ? [] : atts.filter((a) => a.messageId === m.id && a.moderation !== "removed").map((a) => ({ mediaId: a.mediaId, src: `/api/media/${a.mediaId}?as=${asOf(side)}`, width: a.width, height: a.height })),
      status: m.status as MessageDto["status"],
      createdAt: iso(m.createdAt)!,
      clientId: m.clientId,
    }
    if (!removed && m.productSnapshot && m.productId) {
      const p = m.productSnapshot
      dto.product = { productId: m.productId, slug: p.slug, name: p.name, price: p.price, variantLabel: p.variantLabel, brandId: p.brandId }
    }
    if (!removed && m.orderSnapshot && m.orderRefId) {
      const o = m.orderSnapshot
      dto.order = { orderId: m.orderRefId, reference: o.reference, status: o.status, placedAt: o.placedAt, total: o.total, itemCount: o.itemCount }
    }
    if (m.status === "held" && mine) dto.heldReason = m.heldReason ?? "spam_links"
    if (m.status === "sent" && m.spamScore >= 3 && m.senderSide !== "system") dto.safetyNotice = true
    if (r.length) dto.reaction = { mine: r.some((x) => x.side === side), theirs: r.some((x) => x.side !== side) }
    if (side === "brand" && m.quickReplyId) dto.quickReply = true
    return dto
  })
}

/** One message as `side` sees it, or null when that side can't see it (another side's held message). */
export async function messageDtoFor(messageId: string, side: Side) {
  const d = await db()
  const [row] = await d
    .select()
    .from(messages)
    .where(and(eq(messages.id, messageId), visibleTo(side)))
    .limit(1)
  if (!row) return null
  const [dto] = await toMessageDtos([row], side)
  return dto
}

/** A short list preview built from a delivered message (≤ 140 characters; never another side's held text). */
export function previewOf(m: { kind: string; body: string | null; productName?: string | null; attachments?: number }) {
  const body = (m.body ?? "").replace(/\s+/g, " ").trim()
  if (body) return body.length > 140 ? `${body.slice(0, 139)}…` : body
  if (m.kind === "image") return m.attachments && m.attachments > 1 ? `Sent ${m.attachments} photos` : "Sent a photo"
  if (m.kind === "product") return m.productName ? `Shared ${m.productName}`.slice(0, 140) : "Shared a product"
  if (m.kind === "order") return "Shared an order"
  return "New message"
}
