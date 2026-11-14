import "server-only"
import { asBrandConv } from "../inbox/dto"
import { and, asc, desc, eq, gt, inArray, isNull, lt, or } from "drizzle-orm"
import { publicEvents, publicPlaces } from "../around"
import { activeRestriction, brandListed, type Actor } from "../auth/dal"
import { db } from "../db"
import { messageAttachments, messages } from "../db/schema"
import { notFound } from "../http/errors"

/**
 * Frozen, bounded report evidence (§5.3). The subject must exist AND be visible to the reporter,
 * otherwise 404 (existence never leaks):
 *  - message: a party to its conversation (the shopper, or the conversation's brand as the
 *    active brand) who can see it: delivered (`sent`), or their own held message. The snapshot is
 *    the message plus up to 5 visible messages before it and 2 after, as the reporter sees them;
 *  - conversation: a party to it; the last 8 messages the reporter can see;
 *  - social_post: a post anyone can see publicly (published, ok, brand listed, not paused);
 *  - location / location_event: a place or event around's publicPlaces() returns.
 * Removed messages keep their place with no body. Attachment media ids are recorded at the top
 * level (`mediaIds`), so an admin can open exactly those files (§5.4). The admin evidence view
 * (moderation/evidence.ts) reads this shape.
 */
export type SnapshotMessage = {
  id: string
  seq: number
  side: "customer" | "brand" | "system"
  senderName: string
  kind: string
  body: string | null
  status: string
  createdAt: string
  reported: boolean
  attachments: string[]
  product: { name: string; slug: string } | null
  order: { reference: string; status: string; itemCount: number } | null
}

export type Snapshot = {
  v: 1
  subject: { type: string; id: string }
  capturedAt: string
  reporter: { kind: Actor["kind"]; side: "customer" | "brand" | null }
  brand: { id: string; name: string } | null
  conversationId?: string
  customer?: { id: string; name: string }
  reportedMessageId?: string
  messages?: SnapshotMessage[]
  record?: Record<string, unknown>
  mediaIds: string[]
  note: string | null
}

export type Frozen = { snapshot: Snapshot; brandId: string | null; brandName: string | null }

const BEFORE = 5
const AFTER = 2
const LAST = 8

async function brandName(id: string) {
  const d = await db()
  const b = await d.query.brands.findFirst({ columns: { id: true, name: true, reviewStatus: true }, where: (x, { eq }) => eq(x.id, id) })
  return b ?? null
}

/** The conversation, if the actor is a party to it; the side they read it from. */
async function partyConversation(actor: Actor, conversationId: string) {
  const d = await db()
  const row = await d.query.conversations.findFirst({ where: (cv, { eq }) => eq(cv.id, conversationId) })
  // Yard Support threads (and Yard Support's own messages) can't be reported: Yard answers them.
  const c = asBrandConv(row)
  if (!c) return null
  if (actor.kind === "shopper" && c.customerId === actor.userId) return { c, side: "customer" as const }
  if (actor.kind === "brand" && c.brandId === actor.brandId) return { c, side: "brand" as const }
  return null
}

/**
 * Messages the side can see: delivered ones, its own held ones, and removed ones as placeholders.
 * A held message Yard removed never reached the other side, so it is a placeholder only on its
 * sender's side (the inbox's visibleTo, src/server/inbox/dto.ts).
 */
const visibleTo = (side: "customer" | "brand") =>
  or(eq(messages.status, "sent"), and(eq(messages.status, "removed"), or(isNull(messages.heldReason), eq(messages.senderSide, side))), and(eq(messages.status, "held"), eq(messages.senderSide, side)))

async function freezeMessages(rows: (typeof messages.$inferSelect)[], ctx: { customerName: string; brandName: string; reportedId?: string }) {
  const d = await db()
  const ids = rows.map((r) => r.id)
  const atts = ids.length ? await d.select({ messageId: messageAttachments.messageId, mediaId: messageAttachments.mediaId, position: messageAttachments.position }).from(messageAttachments).where(inArray(messageAttachments.messageId, ids)).orderBy(asc(messageAttachments.position)) : []
  const out: SnapshotMessage[] = rows.map((m) => {
    const removed = m.status === "removed"
    return {
      id: m.id,
      seq: m.seq,
      side: m.senderSide as SnapshotMessage["side"],
      senderName: m.senderSide === "brand" ? ctx.brandName : m.senderSide === "system" ? "Yard" : ctx.customerName,
      kind: m.kind,
      body: removed ? null : (m.body ?? null),
      status: m.status,
      createdAt: m.createdAt.toISOString(),
      reported: m.id === ctx.reportedId,
      attachments: removed ? [] : atts.filter((a) => a.messageId === m.id).map((a) => a.mediaId),
      product: !removed && m.productSnapshot ? { name: m.productSnapshot.name, slug: m.productSnapshot.slug } : null,
      order: !removed && m.orderSnapshot ? { reference: m.orderSnapshot.reference, status: m.orderSnapshot.status, itemCount: m.orderSnapshot.itemCount } : null,
    }
  })
  return { messages: out, mediaIds: [...new Set(out.flatMap((m) => m.attachments))] }
}

async function customerName(id: string) {
  const d = await db()
  const u = await d.query.users.findFirst({ columns: { name: true }, where: (x, { eq }) => eq(x.id, id) })
  return u?.name ?? "Shopper"
}

function base(actor: Actor, type: string, id: string, side: Snapshot["reporter"]["side"]): Omit<Snapshot, "mediaIds"> {
  return { v: 1, subject: { type, id }, capturedAt: new Date().toISOString(), reporter: { kind: actor.kind, side }, brand: null, note: null }
}

async function freezeMessage(actor: Actor, messageId: string): Promise<Frozen> {
  const d = await db()
  const m = await d.query.messages.findFirst({ where: (x, { eq }) => eq(x.id, messageId) })
  if (!m) throw notFound()
  const party = await partyConversation(actor, m.conversationId)
  if (!party) throw notFound()
  const { c, side } = party
  const visible = m.status === "sent" || (m.status === "held" && m.senderSide === side)
  if (!visible) throw notFound()
  const scope = and(eq(messages.conversationId, c.id), visibleTo(side))
  const before = await d.select().from(messages).where(and(scope, lt(messages.seq, m.seq))).orderBy(desc(messages.seq)).limit(BEFORE)
  const after = await d.select().from(messages).where(and(scope, gt(messages.seq, m.seq))).orderBy(asc(messages.seq)).limit(AFTER)
  const b = await brandName(c.brandId)
  const cust = await customerName(c.customerId)
  const frozen = await freezeMessages([...before.reverse(), m, ...after], { customerName: cust, brandName: b?.name ?? "Brand", reportedId: m.id })
  return {
    snapshot: { ...base(actor, "message", m.id, side), brand: b ? { id: b.id, name: b.name } : null, conversationId: c.id, customer: { id: c.customerId, name: cust }, reportedMessageId: m.id, ...frozen },
    brandId: c.brandId,
    brandName: b?.name ?? null,
  }
}

async function freezeConversation(actor: Actor, conversationId: string): Promise<Frozen> {
  const party = await partyConversation(actor, conversationId)
  if (!party) throw notFound()
  const { c, side } = party
  const d = await db()
  const last = await d.select().from(messages).where(and(eq(messages.conversationId, c.id), visibleTo(side))).orderBy(desc(messages.seq)).limit(LAST)
  const b = await brandName(c.brandId)
  const cust = await customerName(c.customerId)
  const frozen = await freezeMessages(last.reverse(), { customerName: cust, brandName: b?.name ?? "Brand" })
  return {
    snapshot: { ...base(actor, "conversation", c.id, side), brand: b ? { id: b.id, name: b.name } : null, conversationId: c.id, customer: { id: c.customerId, name: cust }, ...frozen },
    brandId: c.brandId,
    brandName: b?.name ?? null,
  }
}

async function freezePost(actor: Actor, postId: string): Promise<Frozen> {
  const d = await db()
  const p = await d.query.socialPosts.findFirst({ where: (x, { and, eq }) => and(eq(x.id, postId), eq(x.visibility, "published"), eq(x.moderationStatus, "ok")) })
  if (!p) throw notFound()
  const b = await brandName(p.brandId)
  if (!b || !brandListed(b) || (await activeRestriction("brand", p.brandId, "social_disabled"))) throw notFound()
  const media = (p.media ?? []).map((x) => ({ mediaId: x.mediaId ?? null, posterMediaId: x.posterMediaId ?? null, src: x.mediaId ? null : x.src, alt: x.alt, kind: x.kind, width: x.width, height: x.height }))
  const record = { id: p.id, kind: p.kind, caption: p.caption, permalink: p.permalink, source: p.source, postedAt: p.postedAt.toISOString(), productIds: p.productIds, sample: p.sample, media }
  return {
    snapshot: { ...base(actor, "social_post", p.id, null), brand: { id: b.id, name: b.name }, record, mediaIds: [...new Set(media.flatMap((x) => [x.mediaId, x.posterMediaId]).filter((x): x is string => !!x))] },
    brandId: p.brandId,
    brandName: b.name,
  }
}

const imageRef = (img: { mediaId?: string; src: string; alt: string } | null | undefined) => (img ? { mediaId: img.mediaId ?? null, src: img.mediaId ? null : img.src, alt: img.alt } : null)

async function freezePlace(actor: Actor, locationId: string): Promise<Frozen> {
  const [l] = await publicPlaces({ id: locationId, limit: 1 })
  if (!l || l.id !== locationId) throw notFound()
  const b = await brandName(l.brandId)
  const images = (l.images ?? []).map(imageRef)
  const record = {
    id: l.id,
    kind: l.kind,
    name: l.name,
    addressLine: l.addressLine,
    neighbourhood: l.neighbourhood,
    city: l.city,
    country: l.country,
    description: l.description,
    hoursNote: l.hoursNote,
    startsAt: l.startsAt?.toISOString() ?? null,
    endsAt: l.endsAt?.toISOString() ?? null,
    sample: l.sample,
    images,
  }
  return {
    snapshot: { ...base(actor, "location", l.id, null), brand: b ? { id: b.id, name: b.name } : null, record, mediaIds: images.map((i) => i?.mediaId).filter((x): x is string => !!x) },
    brandId: l.brandId,
    brandName: b?.name ?? null,
  }
}

async function freezeEvent(actor: Actor, eventId: string): Promise<Frozen> {
  const d = await db()
  const e = await d.query.locationEvents.findFirst({ columns: { id: true, locationId: true }, where: (x, { eq }) => eq(x.id, eventId) })
  if (!e) throw notFound()
  const [place] = await publicPlaces({ id: e.locationId, limit: 1 })
  if (!place) throw notFound()
  const ev = (await publicEvents([place.id])).find((x) => x.id === eventId)
  if (!ev) throw notFound()
  const b = await brandName(ev.brandId)
  const image = imageRef(ev.image)
  const record = {
    id: ev.id,
    kind: ev.kind,
    title: ev.title,
    description: ev.description,
    promoText: ev.promoText,
    startsAt: ev.startsAt.toISOString(),
    endsAt: ev.endsAt.toISOString(),
    dropId: ev.dropId,
    productIds: ev.productIds,
    sample: ev.sample,
    place: { id: place.id, name: place.name, city: place.city },
    image,
  }
  return {
    snapshot: { ...base(actor, "location_event", ev.id, null), brand: b ? { id: b.id, name: b.name } : null, record, mediaIds: image?.mediaId ? [image.mediaId] : [] },
    brandId: ev.brandId,
    brandName: b?.name ?? null,
  }
}

/** The snapshot plus the owning brand. 404 when the subject is missing or the reporter can't see it. */
export async function freezeSubject(actor: Actor, subjectType: string, subjectId: string): Promise<Frozen> {
  switch (subjectType) {
    case "message":
      return freezeMessage(actor, subjectId)
    case "conversation":
      return freezeConversation(actor, subjectId)
    case "social_post":
      return freezePost(actor, subjectId)
    case "location":
      return freezePlace(actor, subjectId)
    case "location_event":
      return freezeEvent(actor, subjectId)
    default:
      throw notFound()
  }
}

/** Frozen, bounded evidence (§5.3) as stored in reports.snapshot. Used by live reports and M's seed. */
export async function buildSnapshot(actor: Actor, subjectType: string, subjectId: string): Promise<Record<string, unknown>> {
  return (await freezeSubject(actor, subjectType, subjectId)).snapshot as unknown as Record<string, unknown>
}

