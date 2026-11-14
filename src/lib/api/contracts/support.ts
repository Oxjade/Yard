import { z } from "zod"
import { conversationSummary } from "./inbox"

/**
 * Yard Support contracts. A support conversation is a row of the inbox's `conversations` table
 * with kind "support": one per shopper and one per brand, answered by Yard's team as "Yard
 * Support". The party (shopper or brand) reads it with the inbox's own DTOs (ConversationSummary,
 * ThreadDto, MessageDto, SendResult): its `brand` is always YARD_SUPPORT and Yard's replies have
 * side "support". Admin views get SupportCaseDto rows and the same ThreadDto as side "support".
 */

const clientId = z.string().min(8).max(64)
const body = z.string().max(2000, { error: "Keep messages to 2,000 characters." }).optional()
const attachmentIds = z.array(z.string().max(80)).max(4, { error: "Attach up to 4 photos." }).optional()

/** POST /api/support/messages (shopper). `orderRefId`: one of the shopper's own orders (kind "order"). */
export const supportSendBody = z
  .object({
    clientId,
    kind: z.enum(["text", "image", "order"]),
    body,
    attachmentIds,
    orderRefId: z.string().max(80).optional(),
  })
  .strict()
export type SupportSendBody = z.infer<typeof supportSendBody>

/** POST /api/studio/support/messages (brand member). */
export const studioSupportSendBody = z.object({ clientId, kind: z.enum(["text", "image"]), body, attachmentIds }).strict()
export type StudioSupportSendBody = z.infer<typeof studioSupportSendBody>

/** POST /api/admin/support/{id}/messages: Yard Support writes text only. */
export const adminSupportSendBody = z.object({ clientId, kind: z.literal("text").default("text"), body: z.string().max(2000, { error: "Keep messages to 2,000 characters." }) }).strict()
export type AdminSupportSendBody = z.infer<typeof adminSupportSendBody>

/** GET /api/support/conversation and GET /api/studio/support/conversation. */
export const supportConversationDto = z.object({ conversation: conversationSummary.nullable() })
export type SupportConversationDto = z.infer<typeof supportConversationDto>

export const SUPPORT_FILTERS = ["open", "resolved", "all"] as const
export type SupportFilter = (typeof SUPPORT_FILTERS)[number]
export const adminSupportQuery = z.object({
  filter: z.enum(SUPPORT_FILTERS).default("open"),
  /** "1": only conversations assigned to the caller. */
  mine: z.enum(["1"]).optional(),
  q: z.string().max(100).optional(),
  cursor: z.string().max(40).optional(),
})

export const supportParty = z.object({
  kind: z.enum(["shopper", "brand"]),
  /** users.id for a shopper, brands.id for a brand. */
  id: z.string(),
  name: z.string(),
  /** Shopper only. */
  email: z.string().nullable(),
  /** Brand only. */
  handle: z.string().nullable(),
})
export type SupportParty = z.infer<typeof supportParty>

/** One row of Admin › Support (and the header of a case). */
export const supportCaseDto = z.object({
  id: z.string(),
  party: supportParty,
  status: z.enum(["open", "resolved"]),
  /** Messages from the party Yard Support hasn't read yet. */
  unread: z.number(),
  lastMessage: z.object({ preview: z.string(), at: z.string(), side: z.enum(["customer", "brand", "system", "support"]) }).nullable(),
  assignee: z.object({ id: z.string(), name: z.string() }).nullable(),
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
})
export type SupportCaseDto = z.infer<typeof supportCaseDto>

export const supportListDto = z.object({
  items: z.array(supportCaseDto),
  nextCursor: z.string().nullable(),
  counts: z.object({ open: z.number(), resolved: z.number(), unread: z.number(), mine: z.number() }),
})
export type SupportListDto = z.infer<typeof supportListDto>

export const supportCaseResult = z.object({ case: supportCaseDto })

export const adminSupportPatchBody = z
  .object({
    status: z.enum(["open", "resolved"]).optional(),
    /** "me" takes the conversation; null gives it back to the queue. */
    assignee: z.enum(["me"]).nullable().optional(),
  })
  .strict()

/** Payloads this feature publishes (imported by contracts/realtime.ts). */
export const supportRealtimeEvents = {
  /** Admin channel only: a support conversation changed; refetch it through the API (ids only, no text). */
  "support.updated": z.object({ conversationId: z.string() }),
}
