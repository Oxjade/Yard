import "server-only"
import { createHash, randomUUID } from "node:crypto"
import { readFileSync, statSync } from "node:fs"
import path from "node:path"
import { unlink } from "node:fs/promises"
import { and, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm"
import { productById, variantLabel } from "@/lib/data/products"
import { removeTestShopperData } from "../../inbox/fixtures"
import { clearReceiptMarkers } from "../../inbox/receipts"
import { resolveStored } from "../../media/store"
import { abuseEvents, auditLog, blocks, conversationParticipants, conversations, mediaAssets, messageAttachments, messages, notifications, orderRefs, quickReplies, users } from "../schema"
import { afterCommit, db } from "../tx"
import type { SeedModule } from "./types"

/**
 * Inbox sample data (cluster I, Appendix D). Fixed ids, so tests and other clusters' seeds can name
 * them (M's safety seed needs msg_seed_u7_1). Every conversation here is a sample one and shows the
 * Sample chip. Test conversations (cv_t_*) are not seeded: a kit creates them with
 * POST /api/inbox/dev/fixtures and removes them with DELETE (src/server/inbox/fixtures.ts), so the
 * demo accounts only ever see the samples (§9.0 test-data hygiene).
 * A reseed is the restore step for the samples: it deletes these conversations (messages,
 * attachments and reactions cascade), what was added to them since (photos, bell items, blocks,
 * inbox audit rows and spam signals about them), whatever I's test shoppers left, and the seeded
 * quick replies, then writes the samples again with the read-receipt setting back on.
 */

type SeedMsg = {
  id?: string
  side: "customer" | "brand" | "system"
  body?: string
  product?: { id: string; variant?: { size?: string; colour?: string } }
  order?: string
  image?: boolean
  /** Minutes before now. */
  ago: number
  held?: { reason: string; score: number }
  score?: number
}
type SeedConv = {
  id: string
  brandId: string
  customerId: string
  status?: "open" | "resolved"
  sample: boolean
  origin: "storefront" | "product" | "order" | "inbox"
  topic?: string
  messages: SeedMsg[]
  /** Trailing messages from the other side each participant hasn't read. */
  unread: { customer: number; brand: number }
}

const LS = "b_lagos_static"
const ADA_FIT = "med_seed_ada_fit"
const FIT_SOURCE = "/media/fashion/tops-black-hoodie-studio-02.jpg"

const conversationsToSeed = (): SeedConv[] => [
  {
    id: "cv_seed_ada_ls",
    brandId: LS,
    customerId: "u_ada",
    sample: true,
    origin: "product",
    topic: "sizing",
    unread: { customer: 1, brand: 0 },
    messages: [
      { id: "msg_seed_ada_ls_1", side: "customer", ago: 4300, product: { id: "p_danfo_heavyweight_hoodie", variant: { size: "M", colour: "Washed black" } }, body: "Hi! What size would you recommend for the Danfo Heavyweight Hoodie? I usually wear a medium." },
      { id: "msg_seed_ada_ls_2", side: "brand", ago: 4262, body: "Hi Ada! It runs true to size with a dropped shoulder. For the oversized look in the photos, go one up to a large." },
      { id: "msg_seed_ada_ls_3", side: "customer", ago: 2900, image: true, body: "Here's how my last hoodie from you fits, for reference." },
      { id: "msg_seed_ada_ls_4", side: "brand", ago: 2861, body: "That fit looks right. A large would sit about 3 cm longer at the hem." },
      { id: "msg_seed_ada_ls_5", side: "customer", ago: 1500, order: "mo_lagos_static_901", body: "Also, any news on this order?" },
      { id: "msg_seed_ada_ls_6", side: "brand", ago: 1442, body: "It shipped yesterday. The tracking number is on your order page." },
      { id: "msg_seed_ada_ls_7", side: "customer", ago: 1400, body: "Great, thank you!" },
      { id: "msg_seed_ada_ls_8", side: "brand", ago: 300, body: "Enjoy it, and tag us when it lands." },
    ],
  },
  {
    id: "cv_seed_ada_nf",
    brandId: "b_null_form",
    customerId: "u_ada",
    status: "resolved",
    sample: true,
    origin: "storefront",
    topic: "delivery",
    unread: { customer: 0, brand: 0 },
    messages: [
      { id: "msg_seed_ada_nf_1", side: "customer", ago: 7000, body: "Do you deliver to Lagos? How long does it usually take to reach Nigeria?" },
      { id: "msg_seed_ada_nf_2", side: "brand", ago: 6905, body: "We do. From Seoul it's usually 8–12 business days to Lagos, and each product page shows Yard's estimate for your country." },
      { id: "msg_seed_ada_nf_3", side: "customer", ago: 6890, body: "Perfect, thanks." },
      { id: "msg_seed_ada_nf_4", side: "system", ago: 6880, body: "Null Form marked this conversation resolved" },
    ],
  },
  {
    id: "cv_seed_u1_ls",
    brandId: LS,
    customerId: "u_1",
    sample: true,
    origin: "product",
    topic: "availability",
    unread: { customer: 0, brand: 1 },
    messages: [{ id: "msg_seed_u1_1", side: "customer", ago: 180, product: { id: "p_third_mainland_tee", variant: { size: "L", colour: "Black" } }, body: "Is the Third Mainland Tee in black coming back in a large?" }],
  },
  {
    id: "cv_seed_u2_ls",
    brandId: LS,
    customerId: "u_2",
    sample: true,
    origin: "storefront",
    topic: "drops",
    unread: { customer: 0, brand: 1 },
    messages: [
      { id: "msg_seed_u2_1", side: "customer", ago: 900, body: "When's your next drop? I missed Drop 06." },
      { id: "msg_seed_u2_2", side: "brand", ago: 862, body: "Drop 07 is close. Tap Notify me on the drop and you'll get the alert when it opens." },
      { id: "msg_seed_u2_3", side: "customer", ago: 850, body: "Done, thank you." },
    ],
  },
  {
    id: "cv_seed_u3_ls",
    brandId: LS,
    customerId: "u_3",
    status: "resolved",
    sample: true,
    origin: "product",
    topic: "sizing",
    unread: { customer: 0, brand: 0 },
    messages: [
      { id: "msg_seed_u3_1", side: "customer", ago: 2600, product: { id: "p_yaba_cargo_trouser" }, body: "Does the Yaba cargo run long? I'm 168 cm." },
      { id: "msg_seed_u3_2", side: "brand", ago: 2540, body: "It has a 79 cm inseam with a drawcord hem, so it stacks a little at your height. Most people your height take their usual size." },
      { id: "msg_seed_u3_3", side: "customer", ago: 2530, body: "Thanks, ordering my usual." },
      { id: "msg_seed_u3_4", side: "system", ago: 2520, body: "Lagos Static marked this conversation resolved" },
    ],
  },
  {
    id: "cv_seed_u4_ls",
    brandId: LS,
    customerId: "u_4",
    sample: true,
    origin: "storefront",
    topic: "delivery",
    unread: { customer: 0, brand: 0 },
    messages: [
      { id: "msg_seed_u4_1", side: "customer", ago: 1800, body: "Can you ship to Accra?" },
      { id: "msg_seed_u4_2", side: "brand", ago: 1700, body: "Yes. Ghana is in our regional zone, usually 4–7 business days. The product page shows Yard's estimate for your city." },
    ],
  },
  {
    id: "cv_seed_u5_ls",
    brandId: LS,
    customerId: "u_5",
    sample: true,
    origin: "product",
    topic: "product",
    unread: { customer: 0, brand: 0 },
    messages: [
      { id: "msg_seed_u5_1", side: "customer", ago: 3500, product: { id: "p_danfo_heavyweight_hoodie" }, body: "Is the print on this hand-pulled?" },
      { id: "msg_seed_u5_2", side: "brand", ago: 3410, body: "Yes, every one is screen printed by hand in Yaba." },
    ],
  },
  {
    id: "cv_seed_u7_ls",
    brandId: LS,
    customerId: "u_7",
    sample: true,
    origin: "product",
    topic: "availability",
    unread: { customer: 0, brand: 1 },
    messages: [
      { id: "msg_seed_u7_1", side: "customer", ago: 120, body: "Hi, is the Third Mainland Tee still available in black?" },
      {
        id: "msg_seed_u7_2",
        side: "customer",
        ago: 110,
        body: "Same tees cheaper from bargainhaus: bargainhaus.shop/ls t.ly/9xk2 deals-outlet.net/tees. Pay via bank transfer and I ship today.",
        held: { reason: "spam_links", score: 13 },
      },
    ],
  },
  {
    id: "cv_seed_u9_gl",
    brandId: "b_gridlock_supply",
    customerId: "u_9",
    sample: true,
    origin: "storefront",
    topic: "availability",
    unread: { customer: 0, brand: 0 },
    messages: [
      { id: "msg_seed_u9_1", side: "customer", ago: 1000, body: "Will the laundromat jacket come back in size 2?" },
      { id: "msg_seed_u9_2", side: "brand", ago: 955, body: "A small restock is planned. Follow us and you'll see it in your Following feed first." },
    ],
  },
]

const QUICK_REPLIES = [
  { id: "qr_seed_ls_size", brandId: LS, title: "Sizing", shortcut: "/size", body: "Our pieces run true to size. For a looser fit, go one size up — the size guide on each product has exact measurements.", createdBy: "u_b_tobi" },
  { id: "qr_seed_ls_ship", brandId: LS, title: "Delivery times", shortcut: "/ship", body: "We usually dispatch in 1–3 business days from Lagos. Your product page shows Yard's delivery estimate for your country.", createdBy: "u_b_tobi" },
  { id: "qr_seed_ls_restock", brandId: LS, title: "Restock", shortcut: "/restock", body: "Tap Notify me on the product and you'll get an alert the moment it's back.", createdBy: "u_b_tobi" },
  { id: "qr_seed_ls_thanks", brandId: LS, title: "Thanks", shortcut: "/thanks", body: "Thank you for shopping with Lagos Static!", createdBy: "u_b_tobi" },
  { id: "qr_seed_nf_ship", brandId: "b_null_form", title: "Delivery times", shortcut: "/ship", body: "We usually dispatch from Seoul in 2–4 business days. The product page shows Yard's estimate for your country.", createdBy: "u_b_minji" },
]

const TEST_SHOPPERS = ["u_t_i1", "u_t_i2", "u_t_i3"]

function snapshotOf(ref: NonNullable<SeedMsg["product"]>) {
  const p = productById.get(ref.id)
  if (!p) return null
  const v = ref.variant ? p.variants.find((x) => (!ref.variant!.size || Object.values(x.options).includes(ref.variant!.size)) && (!ref.variant!.colour || Object.values(x.options).includes(ref.variant!.colour))) : undefined
  return { variantId: v?.id ?? null, snapshot: { slug: p.slug, name: p.name, image: p.images[0]?.src ?? "", price: { amount: p.price, currency: p.currency }, variantLabel: v ? variantLabel(v.options) : undefined, brandId: p.brandId } }
}

const preview = (m: SeedMsg) => {
  const b = (m.body ?? "").replace(/\s+/g, " ").trim()
  if (b) return b.length > 140 ? `${b.slice(0, 139)}…` : b
  return m.image ? "Sent a photo" : m.product ? "Shared a product" : m.order ? "Shared an order" : "New message"
}

const seed: SeedModule = {
  key: "seed:inbox",
  version: 3,
  requires: ["order_refs:mo_lagos_static_901"],
  async run(ctx) {
    const d = await db()
    const convs = conversationsToSeed()
    const ids = convs.map((c) => c.id)

    // Restore: what I's test shoppers left goes first (conversations, photos, bell items, marks).
    await removeTestShopperData(TEST_SHOPPERS)
    // Then the samples (and any live conversation for the same pairs), with what was added to them.
    const pairs = convs.map((c) => and(eq(conversations.brandId, c.brandId), eq(conversations.customerId, c.customerId)))
    const doomed = (await d.select({ id: conversations.id }).from(conversations).where(or(inArray(conversations.id, ids), ...pairs))).map((r) => r.id)
    // Photos sent into them since, plus attachments an earlier reseed orphaned: a bound attachment
    // (attached_at set) whose conversation is gone can never be shown again.
    const added = await d
      .select({ id: mediaAssets.id, storagePath: mediaAssets.storagePath })
      .from(mediaAssets)
      .where(
        and(
          eq(mediaAssets.purpose, "inbox_attachment"),
          ne(mediaAssets.id, ADA_FIT),
          or(doomed.length ? inArray(mediaAssets.conversationId, doomed) : undefined, and(isNull(mediaAssets.conversationId), isNotNull(mediaAssets.attachedAt), sql`not exists (select 1 from message_attachments ma where ma.media_id = ${mediaAssets.id})`)),
        ),
      )
    if (doomed.length) {
      await d.delete(notifications).where(inArray(notifications.eventKey, doomed.map((c) => `msg:${c}`)))
      await d.delete(auditLog).where(and(inArray(auditLog.subjectId, doomed), inArray(auditLog.action, ["conversation.marked_spam", "block.added", "block.removed"])))
      await d.delete(abuseEvents).where(and(sql`${abuseEvents.detail}->>'conversationId' in (${sql.join(doomed.map((c) => sql`${c}`), sql`, `)})`, sql`coalesce(${abuseEvents.detail}->>'seed', '') <> 'true'`))
      await d.delete(conversations).where(inArray(conversations.id, doomed))
    }
    await d.delete(messageAttachments).where(eq(messageAttachments.mediaId, ADA_FIT))
    await d.delete(mediaAssets).where(inArray(mediaAssets.id, [ADA_FIT, ...added.map((m) => m.id)]))
    const files = added.filter((m) => !m.storagePath.startsWith("/media/")).map((m) => resolveStored(m.storagePath)).filter((f): f is string => !!f)
    afterCommit(async () => {
      for (const f of files) await unlink(f).catch(() => {})
    })
    await d.delete(quickReplies).where(inArray(quickReplies.id, QUICK_REPLIES.map((q) => q.id)))
    await d.delete(blocks).where(
      or(
        ...convs.flatMap((c) => [
          and(eq(blocks.blockerKind, "shopper"), eq(blocks.blockerId, c.customerId), eq(blocks.blockedKind, "brand"), eq(blocks.blockedId, c.brandId)),
          and(eq(blocks.blockerKind, "brand"), eq(blocks.blockerId, c.brandId), eq(blocks.blockedKind, "shopper"), eq(blocks.blockedId, c.customerId)),
        ]),
      ),
    )
    // The read-receipt setting (§4.4) is part of the inbox: back to its default for the samples' shoppers.
    const sampleShoppers = [...new Set(convs.map((c) => c.customerId))]
    await d.update(users).set({ readReceipts: true }).where(inArray(users.id, sampleShoppers))
    await clearReceiptMarkers(sampleShoppers)

    // Ada's fit photo: private, copied out of /public so its bytes have no public URL (SEC-31).
    const storagePath = ctx.copyPrivateFixture(FIT_SOURCE, "inbox_attachment", "u_ada", `${ADA_FIT}.jpg`)
    const src = path.join(process.cwd(), "public", FIT_SOURCE)
    const bytes = statSync(src).size
    const sha256 = createHash("sha256").update(readFileSync(src)).digest("hex")

    const [order] = await d.select().from(orderRefs).where(eq(orderRefs.id, "mo_lagos_static_901")).limit(1)
    const orderSnapshot = order
      ? {
          reference: order.reference,
          status: order.status,
          placedAt: order.placedAt.toISOString(),
          total: { amount: order.totalMinor, currency: order.currency },
          itemCount: ((order.items as { qty?: number }[] | null) ?? []).reduce((s, i) => s + (i.qty ?? 1), 0),
        }
      : null

    const at = (ago: number) => new Date(ctx.now.getTime() - ago * 60_000)
    for (const c of convs) {
      const first = c.messages[0]
      await d.insert(conversations).values({
        id: c.id,
        brandId: c.brandId,
        customerId: c.customerId,
        status: c.status ?? "open",
        origin: c.origin,
        originRef: first.product?.id ?? null,
        topic: c.topic ?? null,
        sample: c.sample,
        createdAt: at(first.ago),
        resolvedAt: c.status === "resolved" ? at(c.messages[c.messages.length - 1].ago) : null,
      })
      const inserted: { seq: number; side: string; status: string; m: SeedMsg }[] = []
      for (const [i, m] of c.messages.entries()) {
        const prod = m.product ? snapshotOf(m.product) : null
        const id = m.id ?? `msg_seed_${c.id.slice(3)}_${i + 1}`
        const [row] = await d
          .insert(messages)
          .values({
            id,
            conversationId: c.id,
            senderSide: m.side,
            senderUserId: m.side === "customer" ? c.customerId : m.side === "brand" ? (c.brandId === LS ? "u_b_tobi" : c.brandId === "b_null_form" ? "u_b_minji" : null) : null,
            kind: m.side === "system" ? "system" : m.image ? "image" : prod ? "product" : m.order ? "order" : "text",
            body: m.body ?? null,
            productId: prod ? m.product!.id : null,
            variantId: prod?.variantId ?? null,
            productSnapshot: prod?.snapshot ?? null,
            orderRefId: m.order && orderSnapshot ? m.order : null,
            orderSnapshot: m.order ? orderSnapshot : null,
            status: m.held ? "held" : "sent",
            heldReason: m.held?.reason ?? null,
            spamScore: m.held?.score ?? m.score ?? 0,
            // Random, so no one can derive another side's idempotency key from a message id.
            clientId: randomUUID(),
            createdAt: at(m.ago),
          })
          .returning({ seq: messages.seq })
        inserted.push({ seq: row.seq, side: m.side, status: m.held ? "held" : "sent", m })
        if (m.image) {
          await d.insert(mediaAssets).values({
            id: ADA_FIT,
            ownerKind: "user",
            ownerId: c.customerId,
            conversationId: c.id,
            purpose: "inbox_attachment",
            mime: "image/jpeg",
            ext: "jpg",
            bytes,
            width: 1100,
            height: 1650,
            sha256,
            storagePath,
            visibility: "private",
            moderationStatus: "ok",
            source: "seed",
            createdBy: c.customerId,
            createdAt: at(m.ago + 1),
            attachedAt: at(m.ago),
          })
          await d.insert(messageAttachments).values({ id: "att_seed_ada_fit", messageId: id, mediaId: ADA_FIT, position: 0 })
        }
      }
      // Delivered state: preview and time from the newest sent customer/brand message.
      const delivered = inserted.filter((x) => x.status === "sent" && x.side !== "system")
      const last = delivered[delivered.length - 1]
      if (last) {
        await d
          .update(conversations)
          .set({ lastMessageSeq: last.seq, lastMessageAt: at(last.m.ago), lastPreview: preview(last.m) })
          .where(eq(conversations.id, c.id))
      }
      for (const side of ["customer", "brand"] as const) {
        const theirs = inserted.filter((x) => x.status === "sent" && x.side === (side === "customer" ? "brand" : "customer"))
        const unread = Math.min(c.unread[side], theirs.length)
        const firstUnread = theirs[theirs.length - unread]
        const readUpTo = unread ? inserted.filter((x) => x.seq < firstUnread.seq).reduce((mx, x) => Math.max(mx, x.seq), 0) : inserted.reduce((mx, x) => Math.max(mx, x.seq), 0)
        await d.insert(conversationParticipants).values({
          conversationId: c.id,
          side,
          partyId: side === "customer" ? c.customerId : c.brandId,
          lastReadSeq: readUpTo,
          lastReadAt: readUpTo ? at(Math.max(0, (inserted.find((x) => x.seq === readUpTo)?.m.ago ?? 0) - 2)) : null,
          unreadCount: unread,
        })
      }
    }

    await d
      .insert(quickReplies)
      .values(QUICK_REPLIES.map((q) => ({ ...q, position: QUICK_REPLIES.filter((x) => x.brandId === q.brandId).indexOf(q), updatedAt: ctx.now })))
      .onConflictDoNothing()
  },
}

export default seed
