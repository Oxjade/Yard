import "server-only"
import { and, asc, desc, eq, gt, inArray, lt, ne, or, sql, type SQL } from "drizzle-orm"
import type {
  ConversationsPage,
  CustomerContextDto,
  OrderRefSummary,
  SendMessageBody,
  SendResult,
  StudioFilter,
  StudioSendMessageBody,
  ThreadDto,
} from "@/lib/api/contracts/inbox"
import { MAX_QUICK_REPLIES } from "@/lib/api/contracts/inbox"
import { productById, variantLabel } from "@/lib/data/products"
import { assertOwned, type OwnedRef } from "../auth/owned"
import type { BrandActor, ShopperActor } from "../auth/dal"
import { writeAudit } from "../audit"
import { db, withTx } from "../db"
import {
  abuseAlerts,
  abuseEvents,
  blocks,
  brandMembers,
  brands,
  chartEvents,
  conversationParticipants,
  conversations,
  mediaAssets,
  messageAttachments,
  messageReactions,
  messages,
  orderRefs,
  quickReplies,
  reports,
  users,
} from "../db/schema"
import { badRequest, conflict, notFound, rateLimited, rule } from "../http/errors"
import { newId } from "../ids"
import { markNotifications, notify, notifyAdmins } from "../notify"
import { publish } from "../realtime/bus"
import { channels } from "../realtime/channels"
import { dailyHit, hit, recordAbuse } from "../security/rate-limit"
import {
  blockedByBrandSql,
  blockedByCustomerSql,
  iso,
  messageDtoFor,
  previewOf,
  selectSummaries,
  sortKeySql,
  summaryFor,
  toMessageDtos,
  toSummary,
  visibleTo,
  type ConvRow,
  type MessageRow,
  type Side,
} from "./dto"
import { brandCanInteract, shopperCanInteract, toInteraction, type InteractResult } from "./interact"
import { markReceiptsOn, readVisibleToBrand, receiptsOnSince } from "./receipts"
import { conversationMatch, messageMatch } from "./search"
import { cleanBody, independentSpamMarks, outcome, scoreBrandMessage, scoreShopperMessage, topRule, type SpamScore } from "./spam"

/**
 * The inbox service (§6.2). Every tenant read is scoped by the actor: a shopper's conversations
 * by `customer_id`, a brand's by the ACTIVE brand (and only once a delivered message exists, so a
 * conversation whose only message is held stays invisible to the brand). Writes run in one
 * withTx; publishes and notifications ride afterCommit through publish()/notify().
 */

const other = (side: Side): Side => (side === "customer" ? "brand" : "customer")
const channelOf = (side: Side, conv: Pick<ConvRow, "customerId" | "brandId">) => (side === "customer" ? channels.user(conv.customerId) : channels.brand(conv.brandId))
const threadHref = (side: Side, id: string) => (side === "customer" ? `/inbox?thread=${id}` : `/studio/inbox?thread=${id}`)
const PAGE = 30

/* ------------------------------------------------------------------ loaders */

/** A shopper's own conversation, or null (another shopper's is indistinguishable from none). */
export async function loadShopperConversation(userId: string, id: string) {
  const d = await db()
  const [row] = await d
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.customerId, userId)))
    .limit(1)
  return row ?? null
}

/** A conversation of the active brand that the brand can see (one delivered message at least). */
export async function loadBrandConversation(brandId: string, id: string) {
  const d = await db()
  const [row] = await d
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.brandId, brandId), gt(conversations.lastMessageSeq, 0)))
    .limit(1)
  return row ?? null
}

/* ------------------------------------------------------------------ lists */

type Cursor = { t: string; id: string }
const encodeCursor = (c: Cursor) => Buffer.from(JSON.stringify(c)).toString("base64url")
function decodeCursor(raw?: string): Cursor | null {
  if (!raw) return null
  try {
    const c = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Cursor
    if (typeof c.t !== "string" || typeof c.id !== "string" || Number.isNaN(Date.parse(c.t))) throw new Error("bad")
    return c
  } catch {
    throw badRequest({ cursor: "That page link has expired. Reload the list." })
  }
}
const afterCursor = (c: Cursor | null) => (c ? sql`(${sortKeySql}, ${conversations.id}) < (${c.t}::timestamptz, ${c.id})` : undefined)

async function page(side: Side, where: SQL | undefined, cursorRaw?: string): Promise<ConversationsPage> {
  const cursor = decodeCursor(cursorRaw)
  const rows = await selectSummaries(side, and(where, afterCursor(cursor)), { limit: PAGE + 1 })
  const more = rows.length > PAGE
  const shown = rows.slice(0, PAGE)
  const last = shown[shown.length - 1]
  return { items: shown.map((r) => toSummary(r, side)), nextCursor: more && last ? encodeCursor({ t: iso(last.sortKey)!, id: last.c.id }) : null }
}

export async function listShopper(actor: ShopperActor, q: { q?: string; filter?: "blocked" | "archived"; cursor?: string }) {
  const base = eq(conversations.customerId, actor.userId)
  const filter =
    q.filter === "blocked" ? blockedByCustomerSql : q.filter === "archived" ? and(eq(conversationParticipants.archived, true), sql`not ${blockedByCustomerSql}`) : and(eq(conversationParticipants.archived, false), sql`not ${blockedByCustomerSql}`)
  return page("customer", and(base, filter, q.q ? conversationMatch("customer", q.q) : undefined), q.cursor)
}

const notSpam = ne(conversations.spamState, "confirmed")
const notBlockedByBrand = sql`not ${blockedByBrandSql}`
const unreadSql = or(gt(conversationParticipants.unreadCount, 0), eq(conversationParticipants.markedUnread, true))!

function studioFilter(f: StudioFilter): SQL {
  switch (f) {
    case "open":
      return and(eq(conversations.status, "open"), notSpam, notBlockedByBrand)!
    case "unread":
      return and(unreadSql, notSpam, notBlockedByBrand)!
    case "resolved":
      return and(eq(conversations.status, "resolved"), notSpam, notBlockedByBrand)!
    case "spam":
      return eq(conversations.spamState, "confirmed")
    case "blocked":
      return blockedByBrandSql
  }
}

const studioBase = (brandId: string) => and(eq(conversations.brandId, brandId), gt(conversations.lastMessageSeq, 0))

export async function studioCounts(brandId: string) {
  const d = await db()
  const [r] = await d
    .select({
      open: sql<number>`(count(*) filter (where ${studioFilter("open")}))::int`,
      unread: sql<number>`(count(*) filter (where ${studioFilter("unread")}))::int`,
      resolved: sql<number>`(count(*) filter (where ${studioFilter("resolved")}))::int`,
      spam: sql<number>`(count(*) filter (where ${studioFilter("spam")}))::int`,
      blocked: sql<number>`(count(*) filter (where ${studioFilter("blocked")}))::int`,
    })
    .from(conversations)
    .innerJoin(conversationParticipants, and(eq(conversationParticipants.conversationId, conversations.id), eq(conversationParticipants.side, "brand")))
    .where(studioBase(brandId))
  return r
}

export async function listStudio(actor: BrandActor, q: { q?: string; filter?: StudioFilter; cursor?: string }) {
  const filter = q.filter ?? "open"
  const result = await page("brand", and(studioBase(actor.brandId), studioFilter(filter), q.q ? conversationMatch("brand", q.q) : undefined), q.cursor)
  return { ...result, counts: await studioCounts(actor.brandId) }
}

/** Conversations with unread messages for a shopper (the badge, §4.3). */
export async function unreadShopper(userId: string) {
  const d = await db()
  const [r] = await d
    .select({ n: sql<number>`count(*)::int` })
    .from(conversations)
    .innerJoin(conversationParticipants, and(eq(conversationParticipants.conversationId, conversations.id), eq(conversationParticipants.side, "customer")))
    .where(and(eq(conversations.customerId, userId), unreadSql, sql`not ${blockedByCustomerSql}`))
  return r.n
}

/** Conversations with unread messages for a brand: the Studio Unread tab's count. */
export async function unreadBrand(brandId: string) {
  return (await studioCounts(brandId)).unread
}

async function publishUnread(side: Side, conv: Pick<ConvRow, "customerId" | "brandId">) {
  const n = side === "customer" ? await unreadShopper(conv.customerId) : await unreadBrand(conv.brandId)
  await publish(channelOf(side, conv), "unread.counts", { conversations: n })
}

/* ------------------------------------------------------------------ thread */

async function readReceiptsOn(customerId: string) {
  const d = await db()
  const [u] = await d.select({ on: users.readReceipts }).from(users).where(eq(users.id, customerId)).limit(1)
  return u?.on ?? true
}

export async function thread(side: Side, conv: ConvRow, interaction: ThreadDto["conversation"]["interaction"], q: { before?: number; after?: number; limit?: number; q?: string }): Promise<ThreadDto> {
  const d = await db()
  const limit = q.limit ?? 50
  const scope = and(eq(messages.conversationId, conv.id), visibleTo(side))
  let rows: MessageRow[]
  let hasMore = false
  if (q.after !== undefined) {
    rows = await d.select().from(messages).where(and(scope, gt(messages.seq, q.after))).orderBy(asc(messages.seq)).limit(limit)
  } else {
    const desc_ = await d
      .select()
      .from(messages)
      .where(and(scope, q.before !== undefined ? lt(messages.seq, q.before) : undefined))
      .orderBy(desc(messages.seq))
      .limit(limit + 1)
    hasMore = desc_.length > limit
    rows = desc_.slice(0, limit).reverse()
  }
  const summary = await summaryFor(conv.id, side)
  if (!summary) throw notFound()
  const receiptsEnabled = await readReceiptsOn(conv.customerId)
  let theirs: ThreadDto["receipts"]["theirs"] = null
  if (receiptsEnabled) {
    const [p] = await d
      .select({ upTo: conversationParticipants.lastReadSeq, at: conversationParticipants.lastReadAt })
      .from(conversationParticipants)
      .where(and(eq(conversationParticipants.conversationId, conv.id), eq(conversationParticipants.side, other(side))))
      .limit(1)
    // The shopper's position reaches the brand only for a read made while receipts were on (no backfill).
    const shown = p && p.upTo > 0 && (side === "customer" || readVisibleToBrand(p.at, await receiptsOnSince(conv.customerId)))
    if (p && shown) theirs = { upToSeq: p.upTo, at: iso(p.at) }
  }
  let matches: number[] | undefined
  if (q.q) {
    const cond = messageMatch(side, q.q)
    matches = cond ? (await d.select({ seq: messages.seq }).from(messages).where(and(eq(messages.conversationId, conv.id), cond)).orderBy(asc(messages.seq)).limit(200)).map((r) => r.seq) : []
  }
  return { conversation: { ...summary, interaction }, messages: await toMessageDtos(rows, side), hasMore, receipts: { theirs, enabled: receiptsEnabled }, ...(matches ? { matches } : {}) }
}

export async function shopperInteraction(actor: ShopperActor, conv: ConvRow) {
  return toInteraction(await shopperCanInteract(actor, { brandId: conv.brandId, locked: conv.locked }))
}

export async function brandInteraction(actor: BrandActor, conv: ConvRow) {
  return toInteraction(await brandCanInteract(actor, conv), { canReply: actor.permissions.includes("inbox.reply") })
}

/* ------------------------------------------------------------------ publishing */

/** message.created/updated to each side's channel: one DTO per side (§4.1). */
async function publishMessage(conv: Pick<ConvRow, "id" | "customerId" | "brandId">, messageId: string, type: "message.created" | "message.updated", sides: Side[]) {
  for (const side of sides) {
    const message = await messageDtoFor(messageId, side)
    const conversation = await summaryFor(conv.id, side)
    if (message) await publish(channelOf(side, conv), type, { message, conversation: conversation ?? undefined })
  }
}

async function publishConversation(conv: Pick<ConvRow, "id" | "customerId" | "brandId" | "lastMessageSeq">, sides: Side[]) {
  for (const side of sides) {
    if (side === "brand" && conv.lastMessageSeq <= 0) continue
    const conversation = await summaryFor(conv.id, side)
    if (conversation) await publish(channelOf(side, conv), "conversation.updated", { conversation })
  }
}

/** Admin queue counts: held messages plus open message and conversation reports. */
async function publishModerationCounts() {
  const d = await db()
  const [held] = await d.select({ n: sql<number>`count(*)::int` }).from(messages).where(eq(messages.status, "held"))
  const [open] = await d
    .select({ n: sql<number>`count(*)::int` })
    .from(reports)
    .where(and(inArray(reports.subjectType, ["message", "conversation"]), inArray(reports.status, ["open", "in_review"])))
  await publish(channels.admin, "moderation.counts", { messages: held.n + open.n })
}

/* ------------------------------------------------------------------ send */

function checkContent(kind: string, body: string | undefined, has: { productId?: string; orderRefId?: string; attachmentIds?: string[] }) {
  // Bidi controls and zero-width spaces never reach storage, so the recipient reads what was scored (§5.2).
  const text = cleanBody(body ?? "")
  if (kind === "text" && !text) throw badRequest({ body: "Write a message first." })
  if (kind === "product" && !has.productId) throw badRequest({ productId: "Choose a piece to share." })
  if (kind === "order" && !has.orderRefId) throw badRequest({ orderRefId: "Choose an order to share." })
  if (kind === "image" && !has.attachmentIds?.length) throw badRequest({ attachmentIds: "Add a photo first." })
  return text || null
}

function productSnapshotOf(productId: string, variantId?: string) {
  const p = productById.get(productId)
  if (!p) return null
  const v = variantId ? p.variants.find((x) => x.id === variantId) : undefined
  if (variantId && !v) throw badRequest({ variantId: "That size or colour isn't part of this piece." })
  return { slug: p.slug, name: p.name, image: p.images[0]?.src ?? "", price: { amount: p.price, currency: p.currency }, variantLabel: v ? variantLabel(v.options) : undefined, brandId: p.brandId }
}

async function orderSnapshotOf(orderRefId: string) {
  const d = await db()
  const [o] = await d.select().from(orderRefs).where(eq(orderRefs.id, orderRefId)).limit(1)
  if (!o) return null
  const items = (o.items as { qty?: number }[] | null) ?? []
  return { reference: o.reference, status: o.status, placedAt: iso(o.placedAt)!, total: { amount: o.totalMinor, currency: o.currency }, itemCount: items.reduce((s, i) => s + (i.qty ?? 1), 0) }
}

/** Attachments: assertOwned (§2.6), then the target-brand check, then binding them to this message. */
async function checkAttachments(actor: ShopperActor | BrandActor, ids: string[], conv: { id: string | null; brandId: string }) {
  if (!ids.length) return
  if (new Set(ids).size !== ids.length) throw badRequest({ attachmentIds: "Each photo can be attached once." })
  const refs: OwnedRef[] = ids.map((id, i) => (conv.id ? { kind: "attachment", id, field: `attachmentIds.${i}`, conversationId: conv.id } : { kind: "attachment", id, field: `attachmentIds.${i}`, targetBrandId: conv.brandId }))
  await assertOwned(actor, refs)
  const d = await db()
  const rows = await d.select({ id: mediaAssets.id, target: mediaAssets.targetBrandId, mime: mediaAssets.mime }).from(mediaAssets).where(inArray(mediaAssets.id, ids))
  const fields: Record<string, string> = {}
  ids.forEach((id, i) => {
    const m = rows.find((r) => r.id === id)
    if (!m || (m.target && m.target !== conv.brandId) || !m.mime.startsWith("image/")) fields[`attachmentIds.${i}`] = "That file can't be attached here."
  })
  if (Object.keys(fields).length) throw badRequest(fields)
}

async function bindAttachments(messageId: string, conversationId: string, ids: string[]) {
  if (!ids.length) return
  const d = await db()
  await d.update(mediaAssets).set({ conversationId, attachedAt: new Date() }).where(inArray(mediaAssets.id, ids))
  await d.insert(messageAttachments).values(ids.map((mediaId, position) => ({ id: newId("att"), messageId, mediaId, position })))
}

async function insertSystemLine(conversationId: string, text: string) {
  const d = await db()
  const [row] = await d
    .insert(messages)
    .values({ id: newId("msg"), conversationId, senderSide: "system", senderUserId: null, kind: "system", body: text.slice(0, 200), status: "sent", clientId: newId("sys"), createdAt: new Date() })
    .returning()
  return row
}

/**
 * Steps 9–12 of §6.2 for a delivered message (and for a released one): bump the conversation,
 * the other side's unread count and archive state, publish to both sides, notify the other side
 * (template only, never the text) and record `message_started` on the first delivered shopper
 * message. Runs inside the caller's transaction.
 */
async function deliver(conv: ConvRow, m: MessageRow, opts: { senderName: string; brandName: string; attachments: number; release?: boolean; ipHash?: string | null }) {
  const d = await db()
  const senderSide = m.senderSide as Side
  const receiver = other(senderSide)
  const preview = previewOf({ kind: m.kind, body: m.body, productName: m.productSnapshot?.name, attachments: opts.attachments })
  const at = iso(m.createdAt)!
  await d
    .update(conversations)
    .set({
      lastPreview: sql`case when ${m.seq} >= ${conversations.lastMessageSeq} then ${preview} else ${conversations.lastPreview} end`,
      lastMessageAt: sql`greatest(coalesce(${conversations.lastMessageAt}, ${at}::timestamptz), ${at}::timestamptz)`,
      lastMessageSeq: sql`greatest(${conversations.lastMessageSeq}, ${m.seq})`,
    })
    .where(eq(conversations.id, conv.id))
  // The receiver: one more unread (counted from messages, so a retry can't double it), out of the archive.
  await d
    .update(conversationParticipants)
    .set({
      archived: false,
      unreadCount: sql`(select count(*)::int from messages um where um.conversation_id = ${conv.id} and um.sender_side = ${senderSide} and um.status = 'sent' and um.seq > ${conversationParticipants.lastReadSeq})`,
    })
    .where(and(eq(conversationParticipants.conversationId, conv.id), eq(conversationParticipants.side, receiver)))
  if (!opts.release) {
    // Writing in a thread reads it: the sender's counters catch up to their own message.
    await d
      .update(conversationParticipants)
      .set({ archived: false, lastReadSeq: sql`greatest(${conversationParticipants.lastReadSeq}, ${m.seq})`, lastReadAt: new Date(), unreadCount: 0, markedUnread: false })
      .where(and(eq(conversationParticipants.conversationId, conv.id), eq(conversationParticipants.side, senderSide)))
  }
  const fresh = { ...conv, lastMessageSeq: Math.max(conv.lastMessageSeq, m.seq) }
  await publishMessage(fresh, m.id, "message.created", ["customer", "brand"])
  await publishUnread(receiver, conv)
  if (!opts.release) await publishUnread(senderSide, conv)

  const [rp] = await d
    .select({ muted: conversationParticipants.muted })
    .from(conversationParticipants)
    .where(and(eq(conversationParticipants.conversationId, conv.id), eq(conversationParticipants.side, receiver)))
    .limit(1)
  if (!rp?.muted) {
    if (receiver === "brand") await notify({ kind: "brand", id: conv.brandId }, { key: `msg:${conv.id}`, template: "message.new_for_brand", vars: { customer: opts.senderName }, href: threadHref("brand", conv.id) })
    else await notify({ kind: "shopper", id: conv.customerId }, { key: `msg:${conv.id}`, template: "message.reply_for_shopper", vars: { brand: opts.brandName }, href: threadHref("customer", conv.id) })
  }

  if (senderSide === "customer") {
    const [{ n }] = await d
      .select({ n: sql<number>`count(*)::int` })
      .from(messages)
      .where(and(eq(messages.conversationId, conv.id), eq(messages.senderSide, "customer"), eq(messages.status, "sent"), ne(messages.id, m.id)))
    if (n === 0) await recordMessageStarted(conv, m.senderUserId ?? conv.customerId, opts.ipHash ?? null)
  }
}

/** The chart signal for a new conversation (§6.2 rule 12). Staff messaging their own brand don't count. */
async function recordMessageStarted(conv: Pick<ConvRow, "brandId">, userId: string, ipHash: string | null) {
  const d = await db()
  const [u] = await d.select({ createdAt: users.createdAt, status: users.status }).from(users).where(eq(users.id, userId)).limit(1)
  const [member] = await d
    .select({ id: brandMembers.id })
    .from(brandMembers)
    .where(and(eq(brandMembers.brandId, conv.brandId), eq(brandMembers.userId, userId)))
    .limit(1)
  const now = new Date()
  await d.insert(chartEvents).values({
    brandId: conv.brandId,
    kind: "message_started",
    actorKind: "shopper",
    actorId: userId,
    accountAgeDays: u ? Math.floor((now.getTime() - u.createdAt.getTime()) / 86_400_000) : null,
    ipHash,
    day: now.toISOString().slice(0, 10),
    verdict: member ? "excluded_self" : u?.status === "restricted" ? "excluded_restricted" : "counted",
  })
}

async function recordSpam(actorKind: "shopper" | "brand", actorId: string, ipHash: string | null, s: SpamScore, held: string | null, ids: { conversationId: string; messageId: string; brandId: string }) {
  if (s.score < 3 && !held) return
  const d = await db()
  const r = held ?? topRule(s, actorKind === "brand" ? "spam_brand_offplatform" : "spam_links")
  await d.insert(abuseEvents).values({ actorKind, actorId, ipHash, action: "message.send", rule: r, detail: { ...ids, score: s.score, held: !!held, urls: s.urls } })
}

async function limits(checks: { key: string; limit: number; windowSec: number; rule?: "rate_limit" | "first_contact_cap" }[], daily: { key: string; limit: number; rule?: "daily_cap" | "first_contact_cap" }[], who: { kind: "shopper" | "brand"; id: string; ipHash: string | null }, action: string) {
  for (const c of checks) {
    const r = hit(c.key, c.limit, c.windowSec)
    if (!r.ok) {
      await recordAbuse(c.key, who, action, c.rule ?? "rate_limit", { limit: c.limit, windowSec: c.windowSec }).catch(() => {})
      throw rateLimited(r.retryAfter, "You're sending messages quickly. Try again in a moment.")
    }
  }
  for (const c of daily) {
    const r = await dailyHit(c.key, c.limit)
    if (!r.ok) {
      await recordAbuse(c.key, who, action, c.rule ?? "daily_cap", { limit: c.limit }).catch(() => {})
      throw rateLimited(r.retryAfter, "You've reached today's message limit. Try again tomorrow.")
    }
  }
}

/**
 * Idempotency (§6.2 rule 2) is scoped to the sender: a retry finds only the sender's own message
 * (for a shopper, their own user; for a brand, its side). A clientId the other side already used
 * is a 409 and never returns their message, so a guessed key can't read a held message.
 */
async function existingByClientId(conversationId: string, clientId: string, sender: { side: Side; userId: string }) {
  const d = await db()
  const [row] = await d
    .select({ id: messages.id, side: messages.senderSide, userId: messages.senderUserId })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.clientId, clientId)))
    .limit(1)
  if (!row) return null
  const mine = row.side === sender.side && (sender.side === "brand" || row.userId === sender.userId)
  if (!mine) throw conflict("This message couldn't be sent. Send it again.")
  return row.id
}

async function sendResultFor(conversationId: string, messageId: string, side: Side): Promise<SendResult> {
  // messageDtoFor only returns what `side` may see (visibleTo), so a replay can never hand back
  // another side's held message.
  const [message, conversation] = await Promise.all([messageDtoFor(messageId, side), summaryFor(conversationId, side)])
  if (!message || !conversation || message.side !== side) throw notFound()
  return { message, conversation }
}

/** A shopper's message (§6.2 server rules on send). 201 for a new message; 200 for a retried clientId. */
export async function sendAsShopper(actor: ShopperActor, body: SendMessageBody, ipHash: string | null): Promise<{ status: 200 | 201; result: SendResult }> {
  const text = checkContent(body.kind, body.body, body)
  const d = await db()
  let conv: ConvRow | null = null
  if (body.conversationId) {
    conv = await loadShopperConversation(actor.userId, body.conversationId)
    if (!conv) throw notFound("We couldn't find that conversation.")
    if (body.brandId && body.brandId !== conv.brandId) throw badRequest({ brandId: "That brand isn't part of this conversation." })
  } else if (body.brandId) {
    const [b] = await d.select({ id: brands.id }).from(brands).where(eq(brands.id, body.brandId)).limit(1)
    if (!b) throw notFound("We couldn't find that brand.")
    const [existing] = await d
      .select()
      .from(conversations)
      .where(and(eq(conversations.brandId, body.brandId), eq(conversations.customerId, actor.userId)))
      .limit(1)
    conv = existing ?? null
  } else {
    throw badRequest({ conversationId: "Choose a conversation or a brand to message." })
  }
  const brandId = conv?.brandId ?? body.brandId!
  if (conv) {
    const dup = await existingByClientId(conv.id, body.clientId, { side: "customer", userId: actor.userId })
    if (dup) return { status: 200, result: await sendResultFor(conv.id, dup, "customer") }
  }

  const gate = await shopperCanInteract(actor, { brandId, locked: conv?.locked })
  if (!gate.ok) {
    await recordAbuse(`blocked_send:${actor.userId}`, { kind: "shopper", id: actor.userId, ipHash }, "message.send", "blocked_send", { brandId, reason: gate.reason }).catch(() => {})
    throw gate.error
  }
  const who = { kind: "shopper" as const, id: actor.userId, ipHash }
  await limits(
    [{ key: `inbox.send:shopper:${actor.userId}`, limit: 20, windowSec: 60 }, ...(conv ? [] : [{ key: `inbox.start:shopper:${actor.userId}`, limit: 5, windowSec: 3600, rule: "first_contact_cap" as const }])],
    [{ key: `inbox.send:day:shopper:${actor.userId}`, limit: 300 }, ...(conv ? [] : [{ key: `inbox.start:day:shopper:${actor.userId}`, limit: 20, rule: "first_contact_cap" as const }])],
    who,
    conv ? "message.send" : "conversation.start",
  )

  const out = await withTx(async () => {
    const tx = await db()
    let c = conv
    if (!c) {
      await tx
        .insert(conversations)
        .values({
          id: newId("cv"),
          brandId,
          customerId: actor.userId,
          origin: body.origin ?? (body.productId ? "product" : body.orderRefId ? "order" : "inbox"),
          originRef: body.productId ?? body.orderRefId ?? null,
          topic: body.topic ?? null,
        })
        .onConflictDoNothing()
      ;[c] = await tx
        .select()
        .from(conversations)
        .where(and(eq(conversations.brandId, brandId), eq(conversations.customerId, actor.userId)))
        .limit(1)
      if (!c) throw notFound("We couldn't find that brand.")
      await tx
        .insert(conversationParticipants)
        .values([
          { conversationId: c.id, side: "customer", partyId: actor.userId },
          { conversationId: c.id, side: "brand", partyId: brandId },
        ])
        .onConflictDoNothing()
    }
    const dup = await existingByClientId(c.id, body.clientId, { side: "customer", userId: actor.userId })
    if (dup) return { status: 200 as const, conversationId: c.id, messageId: dup }

    const refs: OwnedRef[] = []
    if (body.productId) refs.push({ kind: "product", id: body.productId, field: "productId", brandId })
    if (body.orderRefId) refs.push({ kind: "orderRef", id: body.orderRefId, field: "orderRefId", brandId })
    if (refs.length) await assertOwned(actor, refs)
    const productSnapshot = body.productId ? productSnapshotOf(body.productId, body.variantId) : null
    if (body.variantId && !body.productId) throw badRequest({ variantId: "Choose the piece first." })
    const orderSnapshot = body.orderRefId ? await orderSnapshotOf(body.orderRefId) : null
    const attachmentIds = body.attachmentIds ?? []
    await checkAttachments(actor, attachmentIds, { id: conv ? c.id : null, brandId })

    const score = await scoreShopperMessage({ userId: actor.userId, accountCreatedAt: actor.createdAt, conversationId: conv ? c.id : null, brandId, body: text ?? "" })
    const decision = outcome("customer", score, { shadowHold: gate.hold === "spam_marked_by_brand" })

    if (decision.status === "sent" && c.status === "resolved") {
      const line = await insertSystemLine(c.id, "Reopened")
      await tx.update(conversations).set({ status: "open", resolvedAt: null, resolvedBy: null }).where(eq(conversations.id, c.id))
      c = { ...c, status: "open" }
      await publishMessage(c, line.id, "message.created", c.lastMessageSeq > 0 ? ["customer", "brand"] : ["customer"])
    }
    if (body.topic && !c.topic) await tx.update(conversations).set({ topic: body.topic }).where(eq(conversations.id, c.id))

    const [m] = await tx
      .insert(messages)
      .values({
        id: newId("msg"),
        conversationId: c.id,
        senderSide: "customer",
        senderUserId: actor.userId,
        kind: body.kind,
        body: text,
        productId: productSnapshot ? body.productId : null,
        variantId: productSnapshot ? (body.variantId ?? null) : null,
        productSnapshot,
        orderRefId: orderSnapshot ? body.orderRefId : null,
        orderSnapshot,
        status: decision.status,
        heldReason: decision.heldReason,
        spamScore: Math.min(score.score, 999),
        clientId: body.clientId,
        createdAt: new Date(),
      })
      .returning()
    await bindAttachments(m.id, c.id, attachmentIds)
    await recordSpam("shopper", actor.userId, ipHash, score, decision.heldReason, { conversationId: c.id, messageId: m.id, brandId })

    if (decision.status === "sent") {
      const [b] = await tx.select({ name: brands.name }).from(brands).where(eq(brands.id, brandId)).limit(1)
      await deliver(c, m, { senderName: actor.name, brandName: b?.name ?? "The brand", attachments: attachmentIds.length, ipHash })
    } else {
      // Held (§6.2 rule 10): the sender's own channel and the admin counts only.
      await publishMessage(c, m.id, "message.created", ["customer"])
      await publishModerationCounts()
    }
    return { status: 201 as const, conversationId: c.id, messageId: m.id }
  })
  return { status: out.status, result: await sendResultFor(out.conversationId, out.messageId, "customer") }
}

/** A brand member's reply (brands never start conversations, §5.2). */
export async function sendAsBrand(actor: BrandActor, conv: ConvRow, body: StudioSendMessageBody, ipHash: string | null): Promise<{ status: 200 | 201; result: SendResult }> {
  const text = checkContent(body.kind, body.body, body)
  const dup = await existingByClientId(conv.id, body.clientId, { side: "brand", userId: actor.userId })
  if (dup) return { status: 200, result: await sendResultFor(conv.id, dup, "brand") }
  const gate = await brandCanInteract(actor, conv)
  if (!gate.ok) {
    await recordAbuse(`blocked_send:brand:${actor.userId}`, { kind: "brand", id: actor.userId, ipHash }, "message.send", "blocked_send", { brandId: actor.brandId, reason: gate.reason }).catch(() => {})
    throw gate.error
  }
  await limits([{ key: `inbox.brand_send:member:${actor.userId}`, limit: 60, windowSec: 60 }], [{ key: `inbox.brand_send:day:brand:${actor.brandId}`, limit: 2000 }], { kind: "brand", id: actor.userId, ipHash }, "message.send")

  const out = await withTx(async () => {
    const tx = await db()
    const again = await existingByClientId(conv.id, body.clientId, { side: "brand", userId: actor.userId })
    if (again) return { status: 200 as const, messageId: again }
    const refs: OwnedRef[] = []
    if (body.productId) refs.push({ kind: "product", id: body.productId, field: "productId" })
    if (body.quickReplyId) refs.push({ kind: "quickReply", id: body.quickReplyId, field: "quickReplyId" })
    if (refs.length) await assertOwned(actor, refs)
    const productSnapshot = body.productId ? productSnapshotOf(body.productId) : null
    const attachmentIds = body.attachmentIds ?? []
    await checkAttachments(actor, attachmentIds, { id: conv.id, brandId: conv.brandId })
    const score = await scoreBrandMessage({ brandId: actor.brandId, userId: actor.userId, conversationId: conv.id, body: text ?? "", fromQuickReply: !!body.quickReplyId })
    const decision = outcome("brand", score, { brandVerified: actor.brand.reviewStatus === "verified" })
    const [m] = await tx
      .insert(messages)
      .values({
        id: newId("msg"),
        conversationId: conv.id,
        senderSide: "brand",
        senderUserId: actor.userId,
        kind: body.kind,
        body: text,
        productId: productSnapshot ? body.productId : null,
        productSnapshot,
        quickReplyId: body.quickReplyId ?? null,
        status: decision.status,
        heldReason: decision.heldReason,
        spamScore: Math.min(score.score, 999),
        clientId: body.clientId,
        createdAt: new Date(),
      })
      .returning()
    if (body.quickReplyId) await tx.update(quickReplies).set({ usageCount: sql`${quickReplies.usageCount} + 1` }).where(and(eq(quickReplies.id, body.quickReplyId), eq(quickReplies.brandId, actor.brandId)))
    await bindAttachments(m.id, conv.id, attachmentIds)
    await recordSpam("brand", actor.userId, ipHash, score, decision.heldReason, { conversationId: conv.id, messageId: m.id, brandId: actor.brandId })
    if (decision.status === "sent") {
      await deliver(conv, m, { senderName: actor.brand.name, brandName: actor.brand.name, attachments: attachmentIds.length, ipHash })
    } else {
      await publishMessage(conv, m.id, "message.created", ["brand"])
      await publishModerationCounts()
    }
    return { status: 201 as const, messageId: m.id }
  })
  return { status: out.status, result: await sendResultFor(conv.id, out.messageId, "brand") }
}

/* ------------------------------------------------------------------ read, typing, reactions */

/**
 * Read receipts (§4.4): the reader's counters always update (a blocked shopper can still clear
 * their badge); the `read` event reaches the other side only when the pair may interact and the
 * shopper has receipts on (reciprocal).
 */
export async function markRead(side: Side, conv: ConvRow, upToSeq: number, mayPublish: boolean) {
  await withTx(async () => {
    const d = await db()
    const [{ max }] = await d
      .select({ max: sql<number>`coalesce(max(${messages.seq}), 0)::int` })
      .from(messages)
      .where(and(eq(messages.conversationId, conv.id), visibleTo(side)))
    const target = Math.min(upToSeq, max)
    const [before] = await d
      .select({ upTo: conversationParticipants.lastReadSeq, marked: conversationParticipants.markedUnread })
      .from(conversationParticipants)
      .where(and(eq(conversationParticipants.conversationId, conv.id), eq(conversationParticipants.side, side)))
      .limit(1)
    if (!before) return
    const now = new Date()
    await d
      .update(conversationParticipants)
      .set({
        lastReadSeq: sql`greatest(${conversationParticipants.lastReadSeq}, ${target})`,
        // The read time moves only with the position, so it always names a real read.
        lastReadAt: sql`case when ${target} > ${conversationParticipants.lastReadSeq} or ${conversationParticipants.lastReadAt} is null then ${now.toISOString()}::timestamptz else ${conversationParticipants.lastReadAt} end`,
        markedUnread: false,
        unreadCount: sql`(select count(*)::int from messages um where um.conversation_id = ${conv.id} and um.sender_side = ${other(side)} and um.status = 'sent' and um.seq > greatest(${conversationParticipants.lastReadSeq}, ${target}))`,
      })
      .where(and(eq(conversationParticipants.conversationId, conv.id), eq(conversationParticipants.side, side)))
    await markNotifications(side === "customer" ? { kind: "shopper", id: conv.customerId } : { kind: "brand", id: conv.brandId }, { keys: [`msg:${conv.id}`] })
    await publishUnread(side, conv)
    const advanced = target > before.upTo
    if (advanced || before.marked) await publishConversation(conv, [side])
    if (advanced && mayPublish && (await readReceiptsOn(conv.customerId)) && (side === "brand" || conv.lastMessageSeq > 0)) {
      await publish(channelOf(other(side), conv), "read", { conversationId: conv.id, side, upToSeq: Math.max(before.upTo, target), at: now.toISOString() })
    }
  })
}

/**
 * The typing limits, checked by the routes before any database work (§4.4): 60 a minute per
 * actor, then 1 per 2 s per conversation. Excess is a silent 204, so the contract stays 204.
 */
export function typingAllowed(actorKey: string, conversationId: string) {
  if (!hit(`inbox.typing:${actorKey}`, 60, 60).ok) return false
  return hit(`inbox.typing:${actorKey}:${conversationId}`, 1, 2).ok
}

/** Typing (§4.4): ephemeral; refusals are silent. The routes apply typingAllowed() first. */
export async function typing(side: Side, conv: ConvRow, gate: InteractResult) {
  if (!gate.ok) return
  if (side === "customer" && conv.lastMessageSeq <= 0) return
  await publish(channelOf(other(side), conv), "typing", { conversationId: conv.id, side, until: new Date(Date.now() + 5000).toISOString() }, { durable: false })
}

/** ♥ on a message from the other side (§6.2). `null` removes it. */
export async function react(side: Side, conv: ConvRow, messageId: string, emoji: "♥" | null, userId: string) {
  return withTx(async () => {
    const d = await db()
    const [m] = await d
      .select()
      .from(messages)
      .where(and(eq(messages.id, messageId), eq(messages.conversationId, conv.id), visibleTo(side)))
      .limit(1)
    if (!m) throw notFound("We couldn't find that message.")
    if (m.status !== "sent" || m.senderSide !== other(side)) throw rule("You can react to messages you received.")
    if (emoji) await d.insert(messageReactions).values({ messageId, side, userId, emoji }).onConflictDoUpdate({ target: [messageReactions.messageId, messageReactions.side], set: { userId, emoji, createdAt: new Date() } })
    else await d.delete(messageReactions).where(and(eq(messageReactions.messageId, messageId), eq(messageReactions.side, side)))
    await publishMessage(conv, messageId, "message.updated", ["customer", "brand"])
    return (await messageDtoFor(messageId, side))!
  })
}

/* ------------------------------------------------------------------ conversation state */

export async function patchShopper(conv: ConvRow, patch: { archived?: boolean; muted?: boolean }) {
  return withTx(async () => {
    const d = await db()
    const set: Partial<typeof conversationParticipants.$inferInsert> = {}
    if (patch.archived !== undefined) set.archived = patch.archived
    if (patch.muted !== undefined) set.muted = patch.muted
    if (Object.keys(set).length) await d.update(conversationParticipants).set(set).where(and(eq(conversationParticipants.conversationId, conv.id), eq(conversationParticipants.side, "customer")))
    await publishConversation(conv, ["customer"])
    if (patch.archived !== undefined) await publishUnread("customer", conv)
    return (await summaryFor(conv.id, "customer"))!
  })
}

export async function patchStudio(actor: BrandActor, conv: ConvRow, patch: { status?: "open" | "resolved"; markedUnread?: boolean; spam?: boolean }, ipHash: string | null) {
  return withTx(async () => {
    const d = await db()
    let alertRaised = false
    if (patch.status && patch.status !== conv.status) {
      const resolved = patch.status === "resolved"
      await d
        .update(conversations)
        .set({ status: patch.status, resolvedAt: resolved ? new Date() : null, resolvedBy: resolved ? actor.userId : null })
        .where(eq(conversations.id, conv.id))
      const line = await insertSystemLine(conv.id, resolved ? `${actor.brand.name} marked this conversation resolved` : "Reopened")
      await publishMessage(conv, line.id, "message.created", ["customer", "brand"])
      await publishConversation(conv, ["customer"])
    }
    if (patch.markedUnread !== undefined) {
      await d.update(conversationParticipants).set({ markedUnread: patch.markedUnread }).where(and(eq(conversationParticipants.conversationId, conv.id), eq(conversationParticipants.side, "brand")))
    }
    if (patch.spam !== undefined && (patch.spam ? conv.spamState !== "confirmed" : conv.spamState !== "none")) {
      await d.update(conversations).set({ spamState: patch.spam ? "confirmed" : "none" }).where(eq(conversations.id, conv.id))
      if (patch.spam) {
        await d.insert(abuseEvents).values({ actorKind: "brand", actorId: actor.userId, ipHash, action: "conversation.mark_spam", rule: "spam_marked_by_brand", detail: { conversationId: conv.id, customerId: conv.customerId, brandId: actor.brandId, markedBy: actor.userId } })
        await writeAudit({ actor: { kind: "brand", id: actor.userId, name: actor.name, role: actor.role }, action: "conversation.marked_spam", target: `Conversation with a shopper`, subjectType: "conversation", subjectId: conv.id, brandId: actor.brandId, ipHash, meta: { customerId: conv.customerId } })
        alertRaised = await maybeRaiseSpamAlert(conv.customerId)
      }
    }
    await publishConversation(conv, ["brand"])
    await publishUnread("brand", conv)
    return { conversation: (await summaryFor(conv.id, "brand"))!, alertRaised }
  })
}

/** ≥ 3 independent marks within 7 days → an abuse alert and an admin notification; no automatic restriction (§5.2). */
async function maybeRaiseSpamAlert(customerId: string) {
  const marks = await independentSpamMarks(customerId, 7)
  if (marks.count < 3) return false
  const d = await db()
  const [open] = await d
    .select({ id: abuseAlerts.id })
    .from(abuseAlerts)
    .where(and(eq(abuseAlerts.subjectKind, "user"), eq(abuseAlerts.subjectId, customerId), eq(abuseAlerts.kind, "spam_marks"), eq(abuseAlerts.status, "open")))
    .limit(1)
  if (open) {
    await d.update(abuseAlerts).set({ evidence: { count: marks.count, brands: marks.brands, markers: marks.users, conversations: marks.conversations } }).where(eq(abuseAlerts.id, open.id))
    return false
  }
  const id = newId("aa")
  await d.insert(abuseAlerts).values({ id, subjectKind: "user", subjectId: customerId, kind: "spam_marks", evidence: { count: marks.count, brands: marks.brands, markers: marks.users, conversations: marks.conversations } })
  const [u] = await d.select({ name: users.name }).from(users).where(eq(users.id, customerId)).limit(1)
  await notifyAdmins("abuse.view", { key: `abuse:${id}`, template: "abuse.alert", vars: { kind: "spam marks", subject: u?.name ?? "A shopper", count: marks.count }, href: "/admin/users?tab=abuse" })
  const [{ n }] = await d.select({ n: sql<number>`count(*)::int` }).from(abuseAlerts).where(eq(abuseAlerts.status, "open"))
  await publish(channels.admin, "moderation.counts", { abuse: n })
  return true
}

/* ------------------------------------------------------------------ blocks */

export async function shopperBlock(actor: ShopperActor, brandId: string, on: boolean) {
  return withTx(async () => {
    const d = await db()
    const [b] = await d.select({ id: brands.id }).from(brands).where(eq(brands.id, brandId)).limit(1)
    if (!b) throw notFound("We couldn't find that brand.")
    if (on) await d.insert(blocks).values({ id: newId("blk"), blockerKind: "shopper", blockerId: actor.userId, blockedKind: "brand", blockedId: brandId, createdBy: actor.userId }).onConflictDoNothing()
    else await d.delete(blocks).where(and(eq(blocks.blockerKind, "shopper"), eq(blocks.blockerId, actor.userId), eq(blocks.blockedKind, "brand"), eq(blocks.blockedId, brandId)))
    const [conv] = await d
      .select()
      .from(conversations)
      .where(and(eq(conversations.brandId, brandId), eq(conversations.customerId, actor.userId)))
      .limit(1)
    if (conv) {
      await publishConversation(conv, ["customer", "brand"])
      await publishUnread("customer", conv)
      if (conv.lastMessageSeq > 0) await publishUnread("brand", conv)
    }
    return { blocked: on, conversation: conv ? await summaryFor(conv.id, "customer") : null }
  })
}

/** A brand blocks a shopper it has a conversation with; anyone else is 404 (§5.3). */
export async function studioBlock(actor: BrandActor, userId: string, on: boolean, ipHash: string | null) {
  return withTx(async () => {
    const d = await db()
    const [conv] = await d
      .select()
      .from(conversations)
      .where(and(eq(conversations.brandId, actor.brandId), eq(conversations.customerId, userId), gt(conversations.lastMessageSeq, 0)))
      .limit(1)
    if (!conv) throw notFound()
    if (on) {
      const inserted = await d.insert(blocks).values({ id: newId("blk"), blockerKind: "brand", blockerId: actor.brandId, blockedKind: "shopper", blockedId: userId, createdBy: actor.userId }).onConflictDoNothing().returning({ id: blocks.id })
      if (inserted.length) await writeAudit({ actor: { kind: "brand", id: actor.userId, name: actor.name, role: actor.role }, action: "block.added", target: "A shopper", subjectType: "conversation", subjectId: conv.id, brandId: actor.brandId, ipHash, meta: { customerId: userId } })
    } else {
      const removed = await d.delete(blocks).where(and(eq(blocks.blockerKind, "brand"), eq(blocks.blockerId, actor.brandId), eq(blocks.blockedKind, "shopper"), eq(blocks.blockedId, userId))).returning({ id: blocks.id })
      if (removed.length) await writeAudit({ actor: { kind: "brand", id: actor.userId, name: actor.name, role: actor.role }, action: "block.removed", target: "A shopper", subjectType: "conversation", subjectId: conv.id, brandId: actor.brandId, ipHash, meta: { customerId: userId } })
    }
    await publishConversation(conv, ["customer", "brand"])
    await publishUnread("brand", conv)
    return { blocked: on, conversation: await summaryFor(conv.id, "brand") }
  })
}

/* ------------------------------------------------------------------ quick replies */

export function toQuickReply(r: typeof quickReplies.$inferSelect) {
  return { id: r.id, title: r.title, body: r.body, shortcut: r.shortcut, position: r.position, usageCount: r.usageCount }
}

export async function listQuickReplies(brandId: string) {
  const d = await db()
  const rows = await d.select().from(quickReplies).where(eq(quickReplies.brandId, brandId)).orderBy(asc(quickReplies.position), asc(quickReplies.id))
  return rows.map(toQuickReply)
}

async function shortcutTaken(brandId: string, shortcut: string | null | undefined, exceptId?: string) {
  if (!shortcut) return false
  const d = await db()
  const [row] = await d
    .select({ id: quickReplies.id })
    .from(quickReplies)
    .where(and(eq(quickReplies.brandId, brandId), eq(quickReplies.shortcut, shortcut), exceptId ? ne(quickReplies.id, exceptId) : undefined))
    .limit(1)
  return !!row
}

export async function createQuickReply(actor: BrandActor, input: { title: string; body: string; shortcut?: string | null }) {
  return withTx(async () => {
    const d = await db()
    const [{ n, max }] = await d.select({ n: sql<number>`count(*)::int`, max: sql<number>`coalesce(max(${quickReplies.position}), -1)::int` }).from(quickReplies).where(eq(quickReplies.brandId, actor.brandId))
    if (n >= MAX_QUICK_REPLIES) throw rule(`You can save up to ${MAX_QUICK_REPLIES} quick replies. Delete one to add another.`)
    if (await shortcutTaken(actor.brandId, input.shortcut)) throw badRequest({ shortcut: "Another quick reply uses that shortcut." })
    const title = cleanBody(input.title)
    const body = cleanBody(input.body)
    if (!title) throw badRequest({ title: "Give it a title." })
    if (!body) throw badRequest({ body: "Write the reply." })
    const [row] = await d
      .insert(quickReplies)
      .values({ id: newId("qr"), brandId: actor.brandId, title, body, shortcut: input.shortcut ?? null, position: max + 1, createdBy: actor.userId })
      .returning()
    return toQuickReply(row)
  })
}

export async function loadQuickReply(brandId: string, id: string) {
  const d = await db()
  const [row] = await d
    .select()
    .from(quickReplies)
    .where(and(eq(quickReplies.id, id), eq(quickReplies.brandId, brandId)))
    .limit(1)
  return row ?? null
}

export async function updateQuickReply(actor: BrandActor, id: string, patch: { title?: string; body?: string; shortcut?: string | null }) {
  return withTx(async () => {
    const d = await db()
    if (patch.shortcut !== undefined && (await shortcutTaken(actor.brandId, patch.shortcut, id))) throw badRequest({ shortcut: "Another quick reply uses that shortcut." })
    const clean = { ...patch, ...(patch.title !== undefined ? { title: cleanBody(patch.title) } : {}), ...(patch.body !== undefined ? { body: cleanBody(patch.body) } : {}) }
    if (clean.title === "") throw badRequest({ title: "Give it a title." })
    if (clean.body === "") throw badRequest({ body: "Write the reply." })
    const [row] = await d
      .update(quickReplies)
      .set({ ...clean, updatedAt: new Date() })
      .where(and(eq(quickReplies.id, id), eq(quickReplies.brandId, actor.brandId)))
      .returning()
    if (!row) throw notFound()
    return toQuickReply(row)
  })
}

export async function deleteQuickReply(actor: BrandActor, id: string) {
  const d = await db()
  const rows = await d
    .delete(quickReplies)
    .where(and(eq(quickReplies.id, id), eq(quickReplies.brandId, actor.brandId)))
    .returning({ id: quickReplies.id })
  if (!rows.length) throw notFound()
}

/** Reorders the brand's quick replies: `ids` must be exactly the brand's set. */
export async function reorderQuickReplies(actor: BrandActor, ids: string[]) {
  return withTx(async () => {
    const d = await db()
    const rows = await d.select({ id: quickReplies.id }).from(quickReplies).where(eq(quickReplies.brandId, actor.brandId))
    const mine = new Set(rows.map((r) => r.id))
    if (ids.length !== mine.size || new Set(ids).size !== ids.length || ids.some((id) => !mine.has(id))) throw conflict("Your quick replies changed in another tab. Reload and try again.")
    for (const [i, id] of ids.entries()) await d.update(quickReplies).set({ position: i }).where(and(eq(quickReplies.id, id), eq(quickReplies.brandId, actor.brandId)))
    return listQuickReplies(actor.brandId)
  })
}

/* ------------------------------------------------------------------ context, orders, settings */

function toOrderSummary(o: typeof orderRefs.$inferSelect): OrderRefSummary {
  const items = ((o.items as { productId: string; name: string; qty: number }[] | null) ?? []).map((i) => ({ productId: i.productId, name: i.name, qty: i.qty }))
  return {
    id: o.id,
    reference: o.reference,
    status: o.status,
    placedAt: iso(o.placedAt)!,
    total: { amount: o.totalMinor, currency: o.currency },
    itemCount: items.reduce((s, i) => s + i.qty, 0),
    items,
    shipTo: { country: o.shipToCountry ?? null, city: o.shipToCity ?? null },
  }
}

/** The shopper's orders with one brand (Order help), newest first. */
export async function ordersMine(userId: string, brandId: string) {
  const d = await db()
  const rows = await d
    .select()
    .from(orderRefs)
    .where(and(eq(orderRefs.customerId, userId), eq(orderRefs.brandId, brandId)))
    .orderBy(desc(orderRefs.placedAt))
    .limit(20)
  return rows.map(toOrderSummary)
}

const PAID_STATUSES = new Set(["paid", "processing", "shipped", "delivered"])

/** Studio's context panel: this customer with this brand only (§6.2). */
export async function customerContext(actor: BrandActor, conv: ConvRow): Promise<CustomerContextDto> {
  const d = await db()
  const [summary, [customer], orders, discussed] = await Promise.all([
    summaryFor(conv.id, "brand"),
    d.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, conv.customerId)).limit(1),
    d
      .select()
      .from(orderRefs)
      .where(and(eq(orderRefs.customerId, conv.customerId), eq(orderRefs.brandId, actor.brandId)))
      .orderBy(desc(orderRefs.placedAt)),
    d
      .select({ productId: messages.productId, snap: messages.productSnapshot })
      .from(messages)
      .where(and(eq(messages.conversationId, conv.id), visibleTo("brand"), eq(messages.status, "sent"), sql`${messages.productId} is not null`))
      .orderBy(desc(messages.seq))
      .limit(30),
  ])
  if (!summary || !customer) throw notFound()
  // "Spent with you" counts paid orders only: an order awaiting payment, cancelled or refunded
  // never moved money. Orders in another currency are listed beside it, never converted.
  const paid = orders.filter((o) => PAID_STATUSES.has(o.status))
  const spentOther = new Map<string, number>()
  for (const o of paid) if (o.currency !== actor.brand.currency) spentOther.set(o.currency, (spentOther.get(o.currency) ?? 0) + o.totalMinor)
  const seen = new Set<string>()
  const productsDiscussed: CustomerContextDto["productsDiscussed"] = []
  for (const r of discussed) {
    if (!r.productId || !r.snap || seen.has(r.productId)) continue
    seen.add(r.productId)
    productsDiscussed.push({ productId: r.productId, slug: r.snap.slug, name: r.snap.name, price: r.snap.price })
  }
  return {
    conversation: { ...summary, interaction: await brandInteraction(actor, conv) },
    customer: {
      id: customer.id,
      name: customer.name,
      customerSince: orders.length ? iso(orders[orders.length - 1].placedAt) : null,
      ordersCount: orders.length,
      awaitingPayment: orders.filter((o) => o.status === "pending_payment").length,
      spentMinor: paid.reduce((s, o) => s + (o.currency === actor.brand.currency ? o.totalMinor : 0), 0),
      currency: actor.brand.currency,
      spentOther: [...spentOther].map(([currency, amount]) => ({ amount, currency })),
      lastShipToCity: orders[0]?.shipToCity ?? null,
      lastShipToCountry: orders[0]?.shipToCountry ?? null,
    },
    orders: orders.slice(0, 10).map(toOrderSummary),
    productsDiscussed: productsDiscussed.slice(0, 8),
  }
}

/** GET /api/inbox/conversations/by-brand/{brandId}: the existing thread, and whether a new message would go through. */
export async function byBrand(actor: ShopperActor, brandId: string) {
  const d = await db()
  const [b] = await d.select({ id: brands.id }).from(brands).where(eq(brands.id, brandId)).limit(1)
  if (!b) throw notFound("We couldn't find that brand.")
  const [conv] = await d
    .select()
    .from(conversations)
    .where(and(eq(conversations.brandId, brandId), eq(conversations.customerId, actor.userId)))
    .limit(1)
  const gate = await shopperCanInteract(actor, { brandId, locked: conv?.locked })
  const reason = gate.ok ? undefined : gate.reason === "blocked_by_them" ? "blocked" : gate.reason === "blocked_by_me" ? "blocked_by_me" : gate.reason === "brand_unavailable" ? "brand_unavailable" : "restricted"
  return {
    conversation: conv ? await summaryFor(conv.id, "customer") : null,
    canMessage: gate.ok,
    ...(reason ? { reason: reason as "blocked" | "blocked_by_me" | "restricted" | "brand_unavailable" } : {}),
    ...(!gate.ok && gate.until ? { until: gate.until.toISOString() } : {}),
  }
}

export async function getSettings(userId: string) {
  return { readReceipts: await readReceiptsOn(userId) }
}

export async function setSettings(userId: string, readReceipts: boolean) {
  return withTx(async () => {
    const d = await db()
    const [before] = await d.select({ on: users.readReceipts }).from(users).where(eq(users.id, userId)).limit(1)
    await d.update(users).set({ readReceipts }).where(eq(users.id, userId))
    // Turning receipts on never reveals reads made while they were off (receipts.ts).
    if (before && !before.on && readReceipts) await markReceiptsOn(userId, new Date())
    // Receipts are reciprocal: brands with this shopper's thread open re-read it, so a "Seen"
    // already on their screen goes (or comes back). The event carries the summary only.
    if (before && before.on !== readReceipts) {
      const convs = await d.select().from(conversations).where(eq(conversations.customerId, userId))
      for (const c of convs) await publishConversation(c, ["brand"])
    }
    return { readReceipts }
  })
}

/* ------------------------------------------------------------------ contract functions (M) */

/** A centred system line in a conversation, delivered to both sides (§1.8 contract). */
export async function publishSystemNotice(conversationId: string, text: string) {
  await withTx(async () => {
    const d = await db()
    const [conv] = await d.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1)
    if (!conv) throw notFound()
    const line = await insertSystemLine(conv.id, text)
    await publishMessage(conv, line.id, "message.created", conv.lastMessageSeq > 0 ? ["customer", "brand"] : ["customer"])
    await publishConversation(conv, ["customer", "brand"])
  })
}

/** M's release-held-message: steps 9–12 as if the message had just been sent (§6.2). */
export async function releaseHeldMessage(messageId: string) {
  await withTx(async () => {
    const d = await db()
    const [m] = await d.select().from(messages).where(eq(messages.id, messageId)).limit(1)
    if (!m) throw notFound()
    if (m.status !== "held") throw conflict("Someone already decided this — refreshed.")
    const [conv] = await d.select().from(conversations).where(eq(conversations.id, m.conversationId)).limit(1)
    const [released] = await d.update(messages).set({ status: "sent", heldReason: null }).where(eq(messages.id, messageId)).returning()
    let c = conv
    if (released.senderSide === "customer" && c.status === "resolved") {
      await d.update(conversations).set({ status: "open", resolvedAt: null, resolvedBy: null }).where(eq(conversations.id, c.id))
      c = { ...c, status: "open" }
    }
    const [b] = await d.select({ name: brands.name }).from(brands).where(eq(brands.id, c.brandId)).limit(1)
    const [u] = await d.select({ name: users.name }).from(users).where(eq(users.id, c.customerId)).limit(1)
    const [{ n }] = await d.select({ n: sql<number>`count(*)::int` }).from(messageAttachments).where(eq(messageAttachments.messageId, messageId))
    await deliver(c, released, { senderName: released.senderSide === "brand" ? (b?.name ?? "The brand") : (u?.name ?? "A shopper"), brandName: b?.name ?? "The brand", attachments: n, release: true })
    await publishModerationCounts()
  })
}
