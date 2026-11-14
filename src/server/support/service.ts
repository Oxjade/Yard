import "server-only"
import { and, asc, desc, eq, gt, inArray, isNull, lt, sql, type SQL } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { YARD_SUPPORT, type ConversationSummary, type MessageDto, type SendResult, type ThreadDto } from "@/lib/api/contracts/inbox"
import type { AdminSupportSendBody, StudioSupportSendBody, SupportCaseDto, SupportFilter, SupportListDto, SupportSendBody } from "@/lib/api/contracts/support"
import { assertOwned, type OwnedRef } from "../auth/owned"
import type { AdminActor, BrandActor, ShopperActor } from "../auth/dal"
import { writeAudit } from "../audit"
import { db, withTx } from "../db"
import { brands, conversationParticipants, conversations, mediaAssets, messages, orderRefs, users } from "../db/schema"
import { badRequest, conflict, notFound, rateLimited } from "../http/errors"
import { newId } from "../ids"
import { iso, previewOf, toMessageDtos, visibleTo, type AnyConvRow, type MessageRow } from "../inbox/dto"
import { bindAttachments, insertSystemLine, orderSnapshotOf, unreadShopper } from "../inbox/service"
import { cleanBody } from "../inbox/spam"
import { markNotifications, notify, notifyAdmins } from "../notify"
import { publish } from "../realtime/bus"
import { channels } from "../realtime/channels"
import { dailyHit, hit, recordAbuse } from "../security/rate-limit"

/**
 * Yard Support (src/lib/api/contracts/support.ts). Support threads live in the inbox's tables:
 * `conversations.kind = 'support'`, one per shopper (customer_id) and one per brand (brand_id),
 * with two participants, the party's side ("customer" or "brand") and Yard's ("support", party
 * id "yard"). Messages are the inbox's messages: the party writes as its side, admins write as
 * "support" (sender_user_id is the admin, which only admin views show). Nothing here is held or
 * spam-scored: Yard's own team reads every message, and Yard Support's messages can't be reported.
 * Writes run in one withTx; publishes and notifications ride afterCommit like the inbox's.
 */

export type Party = { kind: "shopper"; userId: string; name: string } | { kind: "brand"; brandId: string; name: string; userId: string }
type PartySide = "customer" | "brand"

export const partyOfShopper = (a: ShopperActor): Party => ({ kind: "shopper", userId: a.userId, name: a.name })
export const partyOfBrand = (a: BrandActor): Party => ({ kind: "brand", brandId: a.brandId, name: a.brand.name, userId: a.userId })

const sideOf = (p: Pick<Party, "kind">): PartySide => (p.kind === "shopper" ? "customer" : "brand")
const SUPPORT_PARTY_ID = "yard"
const PAGE = 30

/** Where a party opens its support thread on the website (also the notification's data.url). */
export const SUPPORT_HREF = { shopper: "/inbox?support=1", brand: "/studio/support" } as const
export const adminCaseHref = (id: string) => `/admin/support?case=${encodeURIComponent(id)}`

/** The party a support row belongs to. */
function partyOfRow(c: AnyConvRow): { kind: "shopper"; id: string } | { kind: "brand"; id: string } {
  return c.customerId ? { kind: "shopper", id: c.customerId } : { kind: "brand", id: c.brandId! }
}
const channelOfRow = (c: AnyConvRow) => (c.customerId ? channels.user(c.customerId) : channels.brand(c.brandId!))
const partySideOfRow = (c: AnyConvRow): PartySide => (c.customerId ? "customer" : "brand")

/* ------------------------------------------------------------------ loaders */

const partyWhere = (p: Party): SQL =>
  p.kind === "shopper"
    ? and(eq(conversations.kind, "support"), eq(conversations.customerId, p.userId), isNull(conversations.brandId))!
    : and(eq(conversations.kind, "support"), eq(conversations.brandId, p.brandId), isNull(conversations.customerId))!

/** The party's own support conversation, or null before its first message. */
export async function loadPartyConversation(p: Party) {
  const d = await db()
  const [row] = await d.select().from(conversations).where(partyWhere(p)).limit(1)
  return row ?? null
}

/** A support conversation by id (admins). Brand conversations are 404 here. */
export async function loadSupportConversation(id: string) {
  const d = await db()
  const [row] = await d
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.kind, "support")))
    .limit(1)
  return row ?? null
}

/* ------------------------------------------------------------------ DTOs */

const lm = alias(messages, "slm")

async function participant(conversationId: string, side: string) {
  const d = await db()
  const [p] = await d
    .select()
    .from(conversationParticipants)
    .where(and(eq(conversationParticipants.conversationId, conversationId), eq(conversationParticipants.side, side)))
    .limit(1)
  return p ?? null
}

async function lastSideOf(c: AnyConvRow) {
  if (c.lastMessageSeq <= 0) return null
  const d = await db()
  const [m] = await d
    .select({ side: messages.senderSide })
    .from(messages)
    .where(and(eq(messages.conversationId, c.id), eq(messages.seq, c.lastMessageSeq)))
    .limit(1)
  return (m?.side as "customer" | "brand" | "system" | "support" | undefined) ?? null
}

/**
 * The party's summary of its support thread, in the inbox's ConversationSummary shape: `brand` is
 * YARD_SUPPORT (the counterpart), `kind` is "support", and nothing can block, lock or spam-mark it.
 */
export async function partySummary(c: AnyConvRow): Promise<ConversationSummary> {
  const side = partySideOfRow(c)
  const [p, lastSide] = await Promise.all([participant(c.id, side), lastSideOf(c)])
  const lastAt = iso(c.lastMessageAt)
  return {
    id: c.id,
    kind: "support",
    brand: { ...YARD_SUPPORT, mark: { ...YARD_SUPPORT.mark } },
    status: c.status as "open" | "resolved",
    spamState: "none",
    locked: false,
    lastMessage: lastAt && c.lastMessageSeq > 0 ? { preview: c.lastPreview, at: lastAt, side: lastSide ?? side } : null,
    unread: p?.unreadCount ?? 0,
    markedUnread: false,
    archived: false,
    muted: false,
    blocked: { byMe: false, byThem: false },
    sample: c.sample,
    createdAt: iso(c.createdAt)!,
    interaction: { canSend: true },
  }
}

async function partyNameOf(c: AnyConvRow) {
  const d = await db()
  if (c.customerId) {
    const [u] = await d.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.id, c.customerId)).limit(1)
    return { kind: "shopper" as const, id: c.customerId, name: u?.name ?? "A shopper", email: u?.email ?? null, handle: null }
  }
  const [b] = await d.select({ id: brands.id, name: brands.name, handle: brands.handle }).from(brands).where(eq(brands.id, c.brandId!)).limit(1)
  return { kind: "brand" as const, id: c.brandId!, name: b?.name ?? "A brand", email: null, handle: b?.handle ?? null }
}

const assignee = alias(users, "assignee")
const shopper = alias(users, "shopper")
const supportPart = alias(conversationParticipants, "sp")

function caseFields() {
  return {
    c: conversations,
    unread: supportPart.unreadCount,
    shopperName: shopper.name,
    shopperEmail: shopper.email,
    brandName: brands.name,
    brandHandle: brands.handle,
    assigneeName: assignee.name,
    lastSide: lm.senderSide,
  }
}

function caseQuery(where: SQL | undefined) {
  return db().then((d) =>
    d
      .select(caseFields())
      .from(conversations)
      .innerJoin(supportPart, and(eq(supportPart.conversationId, conversations.id), eq(supportPart.side, "support")))
      .leftJoin(shopper, eq(shopper.id, conversations.customerId))
      .leftJoin(brands, eq(brands.id, conversations.brandId))
      .leftJoin(assignee, eq(assignee.id, conversations.assignedAdminId))
      .leftJoin(lm, and(eq(lm.conversationId, conversations.id), eq(lm.seq, conversations.lastMessageSeq)))
      .where(and(eq(conversations.kind, "support"), gt(conversations.lastMessageSeq, 0), where)),
  )
}
type CaseRow = Awaited<ReturnType<typeof caseQuery>>[number]

function toCase(r: CaseRow): SupportCaseDto {
  const c = r.c
  const lastAt = iso(c.lastMessageAt)
  return {
    id: c.id,
    party: c.customerId
      ? { kind: "shopper", id: c.customerId, name: r.shopperName ?? "A shopper", email: r.shopperEmail ?? null, handle: null }
      : { kind: "brand", id: c.brandId!, name: r.brandName ?? "A brand", email: null, handle: r.brandHandle ?? null },
    status: c.status as "open" | "resolved",
    unread: r.unread,
    lastMessage: lastAt ? { preview: c.lastPreview, at: lastAt, side: (r.lastSide as "customer" | "brand" | "system" | "support" | null) ?? partySideOfRow(c) } : null,
    assignee: c.assignedAdminId ? { id: c.assignedAdminId, name: r.assigneeName ?? "An admin" } : null,
    createdAt: iso(c.createdAt)!,
    resolvedAt: iso(c.resolvedAt),
  }
}

export async function caseFor(id: string): Promise<SupportCaseDto | null> {
  const [row] = await caseQuery(eq(conversations.id, id))
  return row ? toCase(row) : null
}

/** The admin's summary in the inbox shape (for the shared thread hook): the party is `customer`. */
async function adminSummary(c: AnyConvRow): Promise<ConversationSummary> {
  const [p, who, lastSide] = await Promise.all([participant(c.id, "support"), partyNameOf(c), lastSideOf(c)])
  const lastAt = iso(c.lastMessageAt)
  return {
    id: c.id,
    kind: "support",
    brand: { ...YARD_SUPPORT, mark: { ...YARD_SUPPORT.mark } },
    customer: { id: who.id, name: who.name },
    status: c.status as "open" | "resolved",
    spamState: "none",
    locked: false,
    lastMessage: lastAt && c.lastMessageSeq > 0 ? { preview: c.lastPreview, at: lastAt, side: lastSide ?? partySideOfRow(c) } : null,
    unread: p?.unreadCount ?? 0,
    markedUnread: false,
    archived: false,
    muted: false,
    blocked: { byMe: false, byThem: false },
    sample: c.sample,
    createdAt: iso(c.createdAt)!,
    interaction: { canSend: true },
  }
}

/** Admin views name the admin behind each Yard Support message; party views never do. */
async function withAuthors(dtos: MessageDto[], rows: MessageRow[]) {
  const ids = [...new Set(rows.filter((m) => m.senderSide === "support" && m.senderUserId).map((m) => m.senderUserId!))]
  if (!ids.length) return dtos
  const d = await db()
  const names = new Map((await d.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids))).map((u) => [u.id, u.name]))
  const by = new Map(rows.map((m) => [m.id, m.senderUserId]))
  return dtos.map((m) => {
    const uid = m.side === "support" ? by.get(m.id) : null
    return uid ? { ...m, author: { id: uid, name: names.get(uid) ?? "An admin" } } : m
  })
}

type Viewer = PartySide | "support"

async function messageDto(id: string, viewer: Viewer) {
  const d = await db()
  const [row] = await d.select().from(messages).where(eq(messages.id, id)).limit(1)
  if (!row) return null
  const [dto] = await toMessageDtos([row], viewer)
  return viewer === "support" ? (await withAuthors([dto], [row]))[0] : dto
}

async function readReceiptsOn(c: AnyConvRow) {
  if (!c.customerId) return true
  const d = await db()
  const [u] = await d.select({ on: users.readReceipts }).from(users).where(eq(users.id, c.customerId)).limit(1)
  return u?.on ?? true
}

/** The thread as `viewer` sees it, in the inbox's ThreadDto shape (§6.2 paging: before / after / limit). */
export async function supportThread(c: AnyConvRow, viewer: Viewer, q: { before?: number; after?: number; limit?: number }): Promise<ThreadDto> {
  const d = await db()
  const limit = q.limit ?? 50
  const scope = and(eq(messages.conversationId, c.id), visibleTo(viewer))
  let rows: MessageRow[]
  let hasMore = false
  if (q.after !== undefined) {
    rows = await d.select().from(messages).where(and(scope, gt(messages.seq, q.after))).orderBy(asc(messages.seq)).limit(limit)
  } else {
    const newest = await d
      .select()
      .from(messages)
      .where(and(scope, q.before !== undefined ? lt(messages.seq, q.before) : undefined))
      .orderBy(desc(messages.seq))
      .limit(limit + 1)
    hasMore = newest.length > limit
    rows = newest.slice(0, limit).reverse()
  }
  const enabled = await readReceiptsOn(c)
  const otherSide = viewer === "support" ? partySideOfRow(c) : "support"
  const p = enabled ? await participant(c.id, otherSide) : null
  const conversation = viewer === "support" ? await adminSummary(c) : await partySummary(c)
  let dtos = await toMessageDtos(rows, viewer)
  if (viewer === "support") dtos = await withAuthors(dtos, rows)
  return { conversation, messages: dtos, hasMore, receipts: { theirs: p && p.lastReadSeq > 0 ? { upToSeq: p.lastReadSeq, at: iso(p.lastReadAt) } : null, enabled } }
}

/* ------------------------------------------------------------------ publishing */

/** The admin queue changed: an id-only signal on the shared admin channel, then each admin refetches what their role may see. */
async function publishAdmin(conversationId: string) {
  await publish(channels.admin, "support.updated", { conversationId })
  await publish(channels.admin, "moderation.counts", {})
}

async function publishToParty(c: AnyConvRow, type: "message.created" | "message.updated", messageId: string) {
  const side = partySideOfRow(c)
  const message = await messageDto(messageId, side)
  if (message) await publish(channelOfRow(c), type, { message, conversation: await partySummary(c) })
}

async function publishPartyConversation(c: AnyConvRow) {
  await publish(channelOfRow(c), "conversation.updated", { conversation: await partySummary(c) })
}

/** The shopper's inbox badge counts their support thread too; a brand's Studio inbox badge never does. */
async function publishPartyUnread(c: AnyConvRow) {
  if (c.customerId) await publish(channels.user(c.customerId), "unread.counts", { conversations: await unreadShopper(c.customerId) })
}

/* ------------------------------------------------------------------ send */

async function limitsFor(key: string, who: { kind: "shopper" | "brand" | "admin"; id: string; ipHash: string | null }, starting: boolean) {
  const checks = [{ key: `support.send:${key}`, limit: 20, windowSec: 60 }, ...(starting ? [{ key: `support.start:${key}`, limit: 5, windowSec: 3600 }] : [])]
  for (const c of checks) {
    const r = hit(c.key, c.limit, c.windowSec)
    if (!r.ok) {
      await recordAbuse(c.key, who, "support.send", "rate_limit", { limit: c.limit, windowSec: c.windowSec }).catch(() => {})
      throw rateLimited(r.retryAfter, "You're sending messages quickly. Try again in a moment.")
    }
  }
  const day = await dailyHit(`support.send:day:${key}`, who.kind === "admin" ? 3000 : 300)
  if (!day.ok) {
    await recordAbuse(`support.send:day:${key}`, who, "support.send", "daily_cap", { limit: 300 }).catch(() => {})
    throw rateLimited(day.retryAfter, "You've reached today's message limit. Try again tomorrow.")
  }
}

/** A retried clientId returns the sender's own message; one the other side used is a 409. */
async function existingByClientId(conversationId: string, clientId: string, side: Viewer, userId: string) {
  const d = await db()
  const [row] = await d
    .select({ id: messages.id, side: messages.senderSide, userId: messages.senderUserId })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.clientId, clientId)))
    .limit(1)
  if (!row) return null
  // A brand's side is the brand (any member may retry it); a shopper and an admin are themselves.
  if (row.side !== side || (side !== "brand" && row.userId !== userId)) throw conflict("This message couldn't be sent. Send it again.")
  return row.id
}

async function checkPhotos(actor: ShopperActor | BrandActor, ids: string[], conversationId: string) {
  if (!ids.length) return
  if (new Set(ids).size !== ids.length) throw badRequest({ attachmentIds: "Each photo can be attached once." })
  const refs: OwnedRef[] = ids.map((id, i) => ({ kind: "attachment", id, field: `attachmentIds.${i}`, conversationId }))
  await assertOwned(actor, refs)
  const d = await db()
  const rows = await d.select({ id: mediaAssets.id, mime: mediaAssets.mime }).from(mediaAssets).where(inArray(mediaAssets.id, ids))
  const fields: Record<string, string> = {}
  ids.forEach((id, i) => {
    if (!rows.find((r) => r.id === id)?.mime.startsWith("image/")) fields[`attachmentIds.${i}`] = "That file can't be attached here."
  })
  if (Object.keys(fields).length) throw badRequest(fields)
}

/**
 * Bumps the conversation and both participants for a delivered message (the inbox's deliver()
 * steps, for a support thread): the receiver's unread count is recounted from messages, the
 * sender's read position catches up to its own message.
 */
async function bump(c: AnyConvRow, m: MessageRow, attachments: number) {
  const d = await db()
  const preview = previewOf({ kind: m.kind, body: m.body, attachments })
  const at = iso(m.createdAt)!
  await d
    .update(conversations)
    .set({
      lastPreview: sql`case when ${m.seq} >= ${conversations.lastMessageSeq} then ${preview} else ${conversations.lastPreview} end`,
      lastMessageAt: sql`greatest(coalesce(${conversations.lastMessageAt}, ${at}::timestamptz), ${at}::timestamptz)`,
      lastMessageSeq: sql`greatest(${conversations.lastMessageSeq}, ${m.seq})`,
    })
    .where(eq(conversations.id, c.id))
  const senderSide = m.senderSide
  const receiver = senderSide === "support" ? partySideOfRow(c) : "support"
  await d
    .update(conversationParticipants)
    .set({ unreadCount: sql`(select count(*)::int from messages um where um.conversation_id = ${c.id} and um.sender_side = ${senderSide} and um.status = 'sent' and um.seq > ${conversationParticipants.lastReadSeq})` })
    .where(and(eq(conversationParticipants.conversationId, c.id), eq(conversationParticipants.side, receiver)))
  await d
    .update(conversationParticipants)
    .set({ lastReadSeq: sql`greatest(${conversationParticipants.lastReadSeq}, ${m.seq})`, lastReadAt: new Date(), unreadCount: 0, markedUnread: false })
    .where(and(eq(conversationParticipants.conversationId, c.id), eq(conversationParticipants.side, senderSide)))
  const [fresh] = await d.select().from(conversations).where(eq(conversations.id, c.id)).limit(1)
  return fresh
}

async function sendResult(conversationId: string, messageId: string, viewer: Viewer): Promise<SendResult> {
  const c = await loadSupportConversation(conversationId)
  const message = await messageDto(messageId, viewer)
  if (!c || !message) throw notFound()
  return { message, conversation: viewer === "support" ? await adminSummary(c) : await partySummary(c) }
}

/**
 * A shopper's or a brand's message to Yard Support. Creates the thread on the first message
 * (201); a retried clientId returns the original (200). Photos need the thread to exist (they
 * upload into it); `orderRefId` attaches one of the shopper's own orders as an order card.
 */
export async function sendAsParty(actor: ShopperActor | BrandActor, body: SupportSendBody | StudioSupportSendBody, ipHash: string | null): Promise<{ status: 200 | 201; result: SendResult }> {
  const party = actor.kind === "shopper" ? partyOfShopper(actor) : partyOfBrand(actor)
  const side = sideOf(party)
  const text = cleanBody(body.body ?? "") || null
  const orderRefId = "orderRefId" in body ? body.orderRefId : undefined
  const attachmentIds = body.attachmentIds ?? []
  if (body.kind === "text" && !text) throw badRequest({ body: "Write a message first." })
  if (body.kind === "image" && !attachmentIds.length) throw badRequest({ attachmentIds: "Add a photo first." })
  if (body.kind === "order" && !orderRefId) throw badRequest({ orderRefId: "Choose an order first." })
  if (body.kind !== "order" && orderRefId) throw badRequest({ orderRefId: "Send an order with kind \"order\"." })
  if (body.kind !== "image" && attachmentIds.length) throw badRequest({ attachmentIds: "Send photos with kind \"image\"." })

  let conv = await loadPartyConversation(party)
  if (conv) {
    const dup = await existingByClientId(conv.id, body.clientId, side, actor.userId)
    if (dup) return { status: 200, result: await sendResult(conv.id, dup, side) }
  }
  if (attachmentIds.length && !conv) throw badRequest({ attachmentIds: "Send your first message to Yard Support as text, then add photos." })
  const key = party.kind === "shopper" ? `shopper:${party.userId}` : `brand:${party.brandId}:${actor.userId}`
  await limitsFor(key, { kind: party.kind, id: actor.userId, ipHash }, !conv)

  const out = await withTx(async () => {
    const d = await db()
    if (!conv) {
      await d
        .insert(conversations)
        .values({
          id: newId("cv"),
          kind: "support",
          brandId: party.kind === "brand" ? party.brandId : null,
          customerId: party.kind === "shopper" ? party.userId : null,
          origin: orderRefId ? "order" : "inbox",
          originRef: orderRefId ?? null,
          topic: orderRefId ? "order" : null,
        })
        .onConflictDoNothing()
      conv = await loadPartyConversation(party)
      if (!conv) throw conflict("This message couldn't be sent. Send it again.")
      await d
        .insert(conversationParticipants)
        .values([
          { conversationId: conv.id, side, partyId: party.kind === "shopper" ? party.userId : party.brandId },
          { conversationId: conv.id, side: "support", partyId: SUPPORT_PARTY_ID },
        ])
        .onConflictDoNothing()
    }
    let c: AnyConvRow = conv
    const again = await existingByClientId(c.id, body.clientId, side, actor.userId)
    if (again) return { status: 200 as const, conversationId: c.id, messageId: again }

    let orderSnapshot = null
    if (orderRefId) {
      const [o] = await d
        .select({ id: orderRefs.id })
        .from(orderRefs)
        .where(and(eq(orderRefs.id, orderRefId), party.kind === "shopper" ? eq(orderRefs.customerId, party.userId) : eq(orderRefs.brandId, party.brandId)))
        .limit(1)
      if (!o) throw badRequest({ orderRefId: "That order isn't one of yours." })
      orderSnapshot = await orderSnapshotOf(orderRefId)
    }
    await checkPhotos(actor, attachmentIds, c.id)

    if (c.status === "resolved") {
      // A new message from the party reopens the conversation for Yard.
      const line = await insertSystemLine(c.id, "Reopened")
      await d.update(conversations).set({ status: "open", resolvedAt: null, resolvedBy: null }).where(eq(conversations.id, c.id))
      c = { ...c, status: "open", resolvedAt: null, resolvedBy: null }
      await publishToParty(c, "message.created", line.id)
    }
    const [m] = await d
      .insert(messages)
      .values({
        id: newId("msg"),
        conversationId: c.id,
        senderSide: side,
        senderUserId: actor.userId,
        kind: body.kind,
        body: text,
        orderRefId: orderSnapshot ? orderRefId : null,
        orderSnapshot,
        status: "sent",
        clientId: body.clientId,
        createdAt: new Date(),
      })
      .returning()
    await bindAttachments(m.id, c.id, attachmentIds)
    c = await bump(c, m, attachmentIds.length)
    await publishToParty(c, "message.created", m.id)
    await publishPartyUnread(c)
    await publishAdmin(c.id)
    await notifyAdmins("support.manage", { key: `support:${c.id}`, template: "support.new_for_admin", vars: { who: party.name, party: party.kind }, href: adminCaseHref(c.id) })
    return { status: 201 as const, conversationId: c.id, messageId: m.id }
  })
  return { status: out.status, result: await sendResult(out.conversationId, out.messageId, side) }
}

/** Yard Support's reply (an admin with support.manage). Takes an unassigned conversation for the replier. */
export async function sendAsSupport(admin: AdminActor, conv: AnyConvRow, body: AdminSupportSendBody, ipHash: string | null): Promise<{ status: 200 | 201; result: SendResult }> {
  const text = cleanBody(body.body)
  if (!text) throw badRequest({ body: "Write a message first." })
  const dup = await existingByClientId(conv.id, body.clientId, "support", admin.userId)
  if (dup) return { status: 200, result: await sendResult(conv.id, dup, "support") }
  await limitsFor(`admin:${admin.userId}`, { kind: "admin", id: admin.userId, ipHash }, false)
  const out = await withTx(async () => {
    const d = await db()
    const again = await existingByClientId(conv.id, body.clientId, "support", admin.userId)
    if (again) return { status: 200 as const, messageId: again }
    const [m] = await d
      .insert(messages)
      .values({ id: newId("msg"), conversationId: conv.id, senderSide: "support", senderUserId: admin.userId, kind: "text", body: text, status: "sent", clientId: body.clientId, createdAt: new Date() })
      .returning()
    if (!conv.assignedAdminId) await d.update(conversations).set({ assignedAdminId: admin.userId }).where(and(eq(conversations.id, conv.id), isNull(conversations.assignedAdminId)))
    const c = await bump(conv, m, 0)
    await publishToParty(c, "message.created", m.id)
    await publishPartyUnread(c)
    await publishAdmin(c.id)
    const who = partyOfRow(c)
    // The normal in-app notification (a shopper's also goes to their phones as a push).
    if (who.kind === "shopper") await notify({ kind: "shopper", id: who.id }, { key: `support:${c.id}`, template: "support.reply_for_shopper", href: SUPPORT_HREF.shopper })
    else await notify({ kind: "brand", id: who.id }, { key: `support:${c.id}`, template: "support.reply_for_brand", href: SUPPORT_HREF.brand })
    // Replying reads the party's messages: the admins' "new message" notification goes.
    await markNotifications({ kind: "admin", id: admin.userId }, { keys: [`support:${c.id}`] })
    return { status: 201 as const, messageId: m.id }
  })
  return { status: out.status, result: await sendResult(conv.id, out.messageId, "support") }
}

/* ------------------------------------------------------------------ read, typing */

/** Read position for the party or for Yard (`viewer` "support"). The other side gets a `read` event when receipts are on. */
export async function markSupportRead(c: AnyConvRow, viewer: Viewer, upToSeq: number, admin?: AdminActor) {
  await withTx(async () => {
    const d = await db()
    const [{ max }] = await d
      .select({ max: sql<number>`coalesce(max(${messages.seq}), 0)::int` })
      .from(messages)
      .where(and(eq(messages.conversationId, c.id), visibleTo(viewer)))
    const target = Math.min(upToSeq, max)
    const before = await participant(c.id, viewer)
    if (!before) return
    const other = viewer === "support" ? partySideOfRow(c) : "support"
    const now = new Date()
    await d
      .update(conversationParticipants)
      .set({
        lastReadSeq: sql`greatest(${conversationParticipants.lastReadSeq}, ${target})`,
        lastReadAt: sql`case when ${target} > ${conversationParticipants.lastReadSeq} or ${conversationParticipants.lastReadAt} is null then ${now.toISOString()}::timestamptz else ${conversationParticipants.lastReadAt} end`,
        markedUnread: false,
        unreadCount: sql`(select count(*)::int from messages um where um.conversation_id = ${c.id} and um.sender_side = ${other} and um.status = 'sent' and um.seq > greatest(${conversationParticipants.lastReadSeq}, ${target}))`,
      })
      .where(and(eq(conversationParticipants.conversationId, c.id), eq(conversationParticipants.side, viewer)))
    const advanced = target > before.lastReadSeq
    const receipts = await readReceiptsOn(c)
    if (viewer === "support") {
      if (admin) await markNotifications({ kind: "admin", id: admin.userId }, { keys: [`support:${c.id}`] })
      if (advanced) await publishAdmin(c.id)
      if (advanced && receipts) await publish(channelOfRow(c), "read", { conversationId: c.id, side: "support", upToSeq: Math.max(before.lastReadSeq, target), at: now.toISOString() })
    } else {
      const who = partyOfRow(c)
      await markNotifications({ kind: who.kind, id: who.id }, { keys: [`support:${c.id}`] })
      await publishPartyUnread(c)
      if (advanced) {
        await publishPartyConversation(c)
        await publishAdmin(c.id)
      }
    }
  })
}

/** Typing: ephemeral; the party's reaches the admin channel (ids only), Yard's reaches the party. */
export async function supportTyping(c: AnyConvRow, viewer: Viewer) {
  if (c.lastMessageSeq <= 0) return
  const until = new Date(Date.now() + 5000).toISOString()
  if (viewer === "support") await publish(channelOfRow(c), "typing", { conversationId: c.id, side: "support", until }, { durable: false })
  else await publish(channels.admin, "typing", { conversationId: c.id, side: viewer, until }, { durable: false })
}

/* ------------------------------------------------------------------ admin queue */

/** Admin › Support: unread open conversations first, then newest activity. Offset paging (`cursor` is the offset). */
export async function listSupport(admin: AdminActor, q: { filter: SupportFilter; mine?: "1"; q?: string; cursor?: string }): Promise<SupportListDto> {
  const offset = q.cursor && /^\d{1,6}$/.test(q.cursor) ? Number(q.cursor) : 0
  const status = q.filter === "all" ? undefined : eq(conversations.status, q.filter)
  const mine = q.mine ? eq(conversations.assignedAdminId, admin.userId) : undefined
  const needle = q.q?.trim()
  const like = needle ? `%${needle.replace(/[\\%_]/g, (x) => `\\${x}`)}%` : null
  const search = like ? sql`(${shopper.name} ilike ${like} or ${shopper.email} ilike ${like} or ${brands.name} ilike ${like} or ${brands.handle} ilike ${like})` : undefined
  const rows = await caseQuery(and(status, mine, search))
  // Unread open conversations first, then newest activity (the queue is ordered here, after the joins).
  const sorted = rows.sort((a, b) => {
    const ua = a.unread > 0 && a.c.status === "open" ? 0 : 1
    const ub = b.unread > 0 && b.c.status === "open" ? 0 : 1
    if (ua !== ub) return ua - ub
    return (b.c.lastMessageAt?.getTime() ?? 0) - (a.c.lastMessageAt?.getTime() ?? 0) || (a.c.id < b.c.id ? 1 : -1)
  })
  const shown = sorted.slice(offset, offset + PAGE)
  return { items: shown.map(toCase), nextCursor: sorted.length > offset + PAGE ? String(offset + PAGE) : null, counts: await supportCounts(admin.userId) }
}

export async function supportCounts(adminId?: string) {
  const d = await db()
  const [r] = await d
    .select({
      open: sql<number>`(count(*) filter (where ${conversations.status} = 'open'))::int`,
      resolved: sql<number>`(count(*) filter (where ${conversations.status} = 'resolved'))::int`,
      unread: sql<number>`(count(*) filter (where ${conversations.status} = 'open' and ${conversationParticipants.unreadCount} > 0))::int`,
      mine: adminId ? sql<number>`(count(*) filter (where ${conversations.status} = 'open' and ${conversations.assignedAdminId} = ${adminId}))::int` : sql<number>`0`,
    })
    .from(conversations)
    .innerJoin(conversationParticipants, and(eq(conversationParticipants.conversationId, conversations.id), eq(conversationParticipants.side, "support")))
    .where(and(eq(conversations.kind, "support"), gt(conversations.lastMessageSeq, 0)))
  return { open: r?.open ?? 0, resolved: r?.resolved ?? 0, unread: r?.unread ?? 0, mine: r?.mine ?? 0 }
}

/** Resolve / reopen and assign. A system line tells the party when Yard resolves or reopens it. */
export async function patchSupport(admin: AdminActor, conv: AnyConvRow, patch: { status?: "open" | "resolved"; assignee?: "me" | null }, ipHash: string | null) {
  await withTx(async () => {
    const d = await db()
    let c = conv
    if (patch.assignee !== undefined) {
      const to = patch.assignee === "me" ? admin.userId : null
      if (to !== c.assignedAdminId) {
        await d.update(conversations).set({ assignedAdminId: to }).where(eq(conversations.id, c.id))
        c = { ...c, assignedAdminId: to }
      }
    }
    if (patch.status && patch.status !== c.status) {
      const resolved = patch.status === "resolved"
      await d
        .update(conversations)
        .set({ status: patch.status, resolvedAt: resolved ? new Date() : null, resolvedBy: resolved ? admin.userId : null })
        .where(eq(conversations.id, c.id))
      c = { ...c, status: patch.status, resolvedAt: resolved ? new Date() : null, resolvedBy: resolved ? admin.userId : null }
      const line = await insertSystemLine(c.id, resolved ? "Yard Support marked this conversation resolved. Write again any time to reopen it." : "Reopened")
      await publishToParty(c, "message.created", line.id)
      await writeAudit({ actor: { kind: "admin", id: admin.userId, name: admin.name, role: admin.role }, action: resolved ? "support.resolved" : "support.reopened", target: "Yard Support conversation", subjectType: "conversation", subjectId: c.id, ipHash })
    }
    await publishPartyConversation(c)
    await publishAdmin(c.id)
  })
  return (await caseFor(conv.id))!
}
