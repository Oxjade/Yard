import { z } from "zod"
import { CONVERSATION_ORIGINS, CONVERSATION_TOPICS, MESSAGE_STATUSES } from "./enums"

/** Inbox contracts (F1 draft; cluster I owns this file in wave 2, §6.2). */
export const productSnapshot = z.object({ slug: z.string(), name: z.string(), image: z.string(), price: z.object({ amount: z.number(), currency: z.string() }), variantLabel: z.string().optional(), brandId: z.string() })
export const orderSnapshot = z.object({ reference: z.string(), status: z.string(), placedAt: z.string(), total: z.object({ amount: z.number(), currency: z.string() }), itemCount: z.number() })

export const conversationSummary = z.object({
  id: z.string(),
  brand: z.object({ id: z.string(), handle: z.string(), name: z.string(), mark: z.unknown().optional(), verified: z.boolean() }),
  customer: z.object({ id: z.string(), name: z.string() }).optional(),
  status: z.enum(["open", "resolved"]),
  spamState: z.enum(["none", "suspected", "confirmed"]),
  locked: z.boolean(),
  lastMessage: z.object({ preview: z.string(), at: z.string(), side: z.enum(["customer", "brand", "system"]) }).nullable(),
  unread: z.number(),
  markedUnread: z.boolean(),
  archived: z.boolean(),
  blocked: z.object({ byMe: z.boolean(), byThem: z.boolean() }),
  sample: z.boolean(),
})
export type ConversationSummary = z.infer<typeof conversationSummary>

export const messageDto = z.object({
  id: z.string(),
  seq: z.number(),
  conversationId: z.string(),
  side: z.enum(["customer", "brand", "system"]),
  kind: z.enum(["text", "product", "order", "image", "system"]),
  body: z.string().nullable().optional(),
  product: productSnapshot.optional(),
  order: orderSnapshot.optional(),
  /** src is always /api/media/<id>?as=<side>: never a /media/ path (I12). */
  attachments: z.array(z.object({ mediaId: z.string(), src: z.string(), width: z.number().nullable(), height: z.number().nullable() })),
  status: z.enum(MESSAGE_STATUSES),
  heldReason: z.string().optional(),
  safetyNotice: z.boolean().optional(),
  reaction: z.object({ mine: z.boolean(), theirs: z.boolean() }).optional(),
  createdAt: z.string(),
  clientId: z.string(),
})
export type MessageDto = z.infer<typeof messageDto>

export const sendMessageBody = z
  .object({
    conversationId: z.string().optional(),
    brandId: z.string().optional(),
    clientId: z.string().min(8).max(64),
    kind: z.enum(["text", "product", "order", "image"]),
    body: z.string().max(2000, { error: "Keep messages to 2,000 characters." }).optional(),
    productId: z.string().optional(),
    variantId: z.string().optional(),
    orderRefId: z.string().optional(),
    attachmentIds: z.array(z.string()).max(4).optional(),
    topic: z.enum(CONVERSATION_TOPICS).optional(),
    origin: z.enum(CONVERSATION_ORIGINS).optional(),
  })
  .strict()

export const studioSendMessageBody = z
  .object({
    conversationId: z.string(),
    clientId: z.string().min(8).max(64),
    kind: z.enum(["text", "product", "image"]),
    body: z.string().max(2000).optional(),
    productId: z.string().optional(),
    attachmentIds: z.array(z.string()).max(4).optional(),
    quickReplyId: z.string().optional(),
  })
  .strict()

export const quickReplyDto = z.object({ id: z.string(), title: z.string(), body: z.string(), shortcut: z.string().nullable(), position: z.number(), usageCount: z.number() })
export const quickReplyBody = z
  .object({ title: z.string().min(1).max(40), body: z.string().min(1).max(1000), shortcut: z.string().regex(/^\/[a-z0-9-]{2,20}$/, { error: "Shortcuts look like /size." }).nullable().optional() })
  .strict()

export const unreadDto = z.object({ conversations: z.number() })
export const inboxSettings = z.object({ readReceipts: z.boolean() })

/** Payloads this feature publishes (imported by contracts/realtime.ts). */
export const inboxRealtimeEvents = {
  "message.created": z.object({ message: messageDto, conversation: conversationSummary.optional() }),
  "message.updated": z.object({ message: messageDto }),
  "conversation.updated": z.object({ conversation: conversationSummary }),
  typing: z.object({ conversationId: z.string(), side: z.enum(["customer", "brand"]), until: z.string() }),
  read: z.object({ conversationId: z.string(), side: z.enum(["customer", "brand"]), upToSeq: z.number(), at: z.string() }),
  "unread.counts": unreadDto,
}
