import { z } from "zod"
import { CONVERSATION_ORIGINS, CONVERSATION_TOPICS, MESSAGE_STATUSES } from "./enums"

/**
 * Inbox contracts (cluster I, §6.2). Request bodies are strict: a client can't slip in a
 * brandId, customerId or row id the server didn't expect.
 *
 * Product cards carry the product id, not an image path: the client draws the photo from the
 * static catalogue, so no inbox DTO ever carries a `/media/` path (I12). Attachments are always
 * `/api/media/<id>?as=<side>`, served through the authorising media route.
 */

export const productCard = z.object({
  productId: z.string(),
  slug: z.string(),
  name: z.string(),
  /** The price when it was shared, in the brand's currency (minor units). */
  price: z.object({ amount: z.number(), currency: z.string() }),
  variantLabel: z.string().optional(),
  brandId: z.string(),
})
export type ProductCard = z.infer<typeof productCard>

export const orderCard = z.object({
  orderId: z.string(),
  reference: z.string(),
  status: z.string(),
  placedAt: z.string(),
  total: z.object({ amount: z.number(), currency: z.string() }),
  itemCount: z.number(),
})
export type OrderCard = z.infer<typeof orderCard>

/** Why a composer can't send, from the viewer's side (§4.4, §5.3). */
export const INTERACTION_REASONS = ["blocked_by_them", "blocked_by_me", "restricted", "locked", "brand_unavailable", "role"] as const
export const interaction = z.object({
  canSend: z.boolean(),
  reason: z.enum(INTERACTION_REASONS).optional(),
  /** For `restricted`: when the restriction ends (null = until Yard lifts it). */
  until: z.string().nullable().optional(),
  /** For `restricted` in Studio: "account" when the member's own account is paused, not the brand. */
  scope: z.enum(["account", "brand"]).optional(),
})
export type Interaction = z.infer<typeof interaction>

export const brandMark = z.object({ text: z.string(), style: z.string() })

export const conversationSummary = z.object({
  id: z.string(),
  brand: z.object({ id: z.string(), handle: z.string(), name: z.string(), mark: brandMark, verified: z.boolean() }),
  customer: z.object({ id: z.string(), name: z.string() }).optional(),
  status: z.enum(["open", "resolved"]),
  spamState: z.enum(["none", "suspected", "confirmed"]),
  locked: z.boolean(),
  lastMessage: z.object({ preview: z.string(), at: z.string(), side: z.enum(["customer", "brand", "system"]), held: z.boolean().optional() }).nullable(),
  unread: z.number(),
  markedUnread: z.boolean(),
  archived: z.boolean(),
  muted: z.boolean(),
  blocked: z.object({ byMe: z.boolean(), byThem: z.boolean() }),
  sample: z.boolean(),
  createdAt: z.string(),
  /** Present on single-conversation reads (the thread), not on list rows. */
  interaction: interaction.optional(),
})
export type ConversationSummary = z.infer<typeof conversationSummary>

export const messageDto = z.object({
  id: z.string(),
  seq: z.number(),
  conversationId: z.string(),
  side: z.enum(["customer", "brand", "system"]),
  kind: z.enum(["text", "product", "order", "image", "system"]),
  /** Null for a message Yard removed ("Message removed by Yard."). */
  body: z.string().nullable().optional(),
  product: productCard.optional(),
  order: orderCard.optional(),
  /** src is always /api/media/<id>?as=<side>: never a /media/ path (I12). */
  attachments: z.array(z.object({ mediaId: z.string(), src: z.string(), width: z.number().nullable(), height: z.number().nullable() })),
  status: z.enum(MESSAGE_STATUSES),
  /** Only on the sender's own held messages. */
  heldReason: z.string().optional(),
  /** Scored 3–5 (§5.2): delivered, with "Keep payments on Yard" shown to the recipient. */
  safetyNotice: z.boolean().optional(),
  reaction: z.object({ mine: z.boolean(), theirs: z.boolean() }).optional(),
  /** Sent from a quick reply (Studio only). */
  quickReply: z.boolean().optional(),
  createdAt: z.string(),
  clientId: z.string(),
})
export type MessageDto = z.infer<typeof messageDto>

/** The other side's read position, when read receipts are on for this pair (§4.4). */
export const receipt = z.object({ upToSeq: z.number(), at: z.string().nullable() })

export const threadDto = z.object({
  conversation: conversationSummary,
  messages: z.array(messageDto),
  /** Older messages exist before the first one returned. */
  hasMore: z.boolean(),
  receipts: z.object({ theirs: receipt.nullable(), enabled: z.boolean() }),
  /** In-thread search (`q`): matching message seqs, oldest first. */
  matches: z.array(z.number()).optional(),
})
export type ThreadDto = z.infer<typeof threadDto>

export const conversationsPage = z.object({
  items: z.array(conversationSummary),
  nextCursor: z.string().nullable(),
  /** Studio only: counts per filter for the status tabs. */
  counts: z.object({ open: z.number(), unread: z.number(), resolved: z.number(), spam: z.number(), blocked: z.number() }).optional(),
})
export type ConversationsPage = z.infer<typeof conversationsPage>

export const byBrandDto = z.object({
  conversation: conversationSummary.nullable(),
  canMessage: z.boolean(),
  reason: z.enum(["blocked", "blocked_by_me", "restricted", "brand_unavailable"]).optional(),
  until: z.string().nullable().optional(),
})
export type ByBrandDto = z.infer<typeof byBrandDto>

export const sendResult = z.object({ message: messageDto, conversation: conversationSummary })
export type SendResult = z.infer<typeof sendResult>

export const sendMessageBody = z
  .object({
    conversationId: z.string().max(80).optional(),
    brandId: z.string().max(80).optional(),
    clientId: z.string().min(8).max(64),
    kind: z.enum(["text", "product", "order", "image"]),
    body: z.string().max(2000, { error: "Keep messages to 2,000 characters." }).optional(),
    productId: z.string().max(80).optional(),
    variantId: z.string().max(80).optional(),
    orderRefId: z.string().max(80).optional(),
    attachmentIds: z.array(z.string().max(80)).max(4, { error: "Attach up to 4 photos." }).optional(),
    topic: z.enum(CONVERSATION_TOPICS).optional(),
    origin: z.enum(CONVERSATION_ORIGINS).optional(),
  })
  .strict()
export type SendMessageBody = z.infer<typeof sendMessageBody>

export const studioSendMessageBody = z
  .object({
    conversationId: z.string({ error: "Brands reply in a conversation a shopper started." }).max(80),
    clientId: z.string().min(8).max(64),
    kind: z.enum(["text", "product", "image"]),
    body: z.string().max(2000, { error: "Keep messages to 2,000 characters." }).optional(),
    productId: z.string().max(80).optional(),
    attachmentIds: z.array(z.string().max(80)).max(4, { error: "Attach up to 4 photos." }).optional(),
    quickReplyId: z.string().max(80).optional(),
  })
  .strict()
export type StudioSendMessageBody = z.infer<typeof studioSendMessageBody>

export const threadQuery = z.object({
  before: z.coerce.number().int().min(0).optional(),
  after: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  q: z.string().max(100).optional(),
})

export const shopperListQuery = z.object({
  q: z.string().max(100).optional(),
  filter: z.enum(["blocked", "archived"]).optional(),
  cursor: z.string().max(200).optional(),
})
export const STUDIO_FILTERS = ["open", "unread", "resolved", "spam", "blocked"] as const
export type StudioFilter = (typeof STUDIO_FILTERS)[number]
export const studioListQuery = z.object({
  q: z.string().max(100).optional(),
  filter: z.enum(STUDIO_FILTERS).optional(),
  cursor: z.string().max(200).optional(),
})

export const readBody = z.object({ upToSeq: z.number().int().min(0) }).strict()
export const reactionBody = z.object({ emoji: z.literal("♥").nullable() }).strict()
export const shopperPatchBody = z.object({ archived: z.boolean().optional(), muted: z.boolean().optional() }).strict()
export const studioPatchBody = z.object({ status: z.enum(["open", "resolved"]).optional(), markedUnread: z.boolean().optional(), spam: z.boolean().optional() }).strict()
export const shopperBlockBody = z.object({ brandId: z.string().min(1).max(80) }).strict()
export const studioBlockBody = z.object({ userId: z.string().min(1).max(80) }).strict()

export const quickReplyDto = z.object({ id: z.string(), title: z.string(), body: z.string(), shortcut: z.string().nullable(), position: z.number(), usageCount: z.number() })
export type QuickReplyDto = z.infer<typeof quickReplyDto>
export const quickReplyBody = z
  .object({
    title: z.string().trim().min(1, { error: "Give it a title." }).max(40, { error: "Keep titles to 40 characters." }),
    body: z.string().trim().min(1, { error: "Write the reply." }).max(1000, { error: "Keep replies to 1,000 characters." }),
    shortcut: z.string().regex(/^\/[a-z0-9-]{2,20}$/, { error: "Shortcuts look like /size: a slash, then 2–20 lower-case letters, numbers or dashes." }).nullable().optional(),
  })
  .strict()
export const quickReplyPatchBody = quickReplyBody.partial().strict()
export const quickReplyOrderBody = z.object({ ids: z.array(z.string().max(80)).max(30) }).strict()
export const MAX_QUICK_REPLIES = 30

export const orderRefSummary = z.object({
  id: z.string(),
  reference: z.string(),
  status: z.string(),
  placedAt: z.string(),
  total: z.object({ amount: z.number(), currency: z.string() }),
  itemCount: z.number(),
  items: z.array(z.object({ productId: z.string(), name: z.string(), qty: z.number() })),
  shipTo: z.object({ country: z.string().nullable(), city: z.string().nullable() }),
})
export type OrderRefSummary = z.infer<typeof orderRefSummary>

export const customerContextDto = z.object({
  conversation: conversationSummary,
  customer: z.object({
    id: z.string(),
    name: z.string(),
    customerSince: z.string().nullable(),
    ordersCount: z.number(),
    /** Orders still awaiting payment (counted in ordersCount, never in spentMinor). */
    awaitingPayment: z.number(),
    /** Paid orders only (paid, processing, shipped, delivered), in the brand's currency. */
    spentMinor: z.number(),
    currency: z.string(),
    /** Paid orders in other currencies, per currency; never converted. */
    spentOther: z.array(z.object({ amount: z.number(), currency: z.string() })),
    lastShipToCity: z.string().nullable(),
    lastShipToCountry: z.string().nullable(),
  }),
  orders: z.array(orderRefSummary),
  productsDiscussed: z.array(z.object({ productId: z.string(), slug: z.string(), name: z.string(), price: z.object({ amount: z.number(), currency: z.string() }) })),
})
export type CustomerContextDto = z.infer<typeof customerContextDto>

export const ordersMineQuery = z.object({ brand: z.string().min(1).max(80) })
export const ordersMineDto = z.object({ items: z.array(orderRefSummary) })

export const unreadDto = z.object({ conversations: z.number() })
export const inboxSettings = z.object({ readReceipts: z.boolean() })
export const inboxSettingsBody = z.object({ readReceipts: z.boolean() }).strict()

/** Payloads this feature publishes (imported by contracts/realtime.ts). */
export const inboxRealtimeEvents = {
  "message.created": z.object({ message: messageDto, conversation: conversationSummary.optional() }),
  "message.updated": z.object({ message: messageDto, conversation: conversationSummary.optional() }),
  "conversation.updated": z.object({ conversation: conversationSummary }),
  typing: z.object({ conversationId: z.string(), side: z.enum(["customer", "brand"]), until: z.string() }),
  read: z.object({ conversationId: z.string(), side: z.enum(["customer", "brand"]), upToSeq: z.number(), at: z.string() }),
  "unread.counts": unreadDto,
}

/** What a held message's sender is told (§5.2). */
export const heldCopy = {
  customer: "Held for review. Messages with several links or payment requests outside Yard are checked first.",
  brand: "Held for review — Yard checks messages that ask for payment outside checkout.",
} as const

/** The safety notice above a 3–5 message (§5.2), for whoever receives it. */
export const safetyCopy = {
  customer: "Keep payments on Yard. Never pay a brand outside checkout.",
  brand: "Keep payments on Yard. Never pay a brand or shopper outside checkout.",
} as const
