import { api } from "./client"
import { conversationSummary, sendResult, threadDto, type SendResult, type ThreadDto } from "./contracts/inbox"
import { supportCaseResult, supportConversationDto, supportListDto, type StudioSupportSendBody, type SupportCaseDto, type SupportFilter, type SupportListDto, type SupportSendBody } from "./contracts/support"
import { z } from "zod"
import type { ThreadEndpoints } from "@/components/inbox/use-thread"

/**
 * Typed wrappers over the Yard Support routes. A shopper uses /api/support (`yard_s`), a brand
 * member /api/studio/support (`yard_b`), an admin /api/admin/support. The party's thread answers in
 * the inbox's own DTOs, so the shared chat components read it unchanged.
 */

export type SupportParty = "shopper" | "brand"
const base = (p: SupportParty) => (p === "shopper" ? "/api/support" : "/api/studio/support")

export const getSupportConversation = (p: SupportParty) => api<{ conversation: z.infer<typeof conversationSummary> | null }>(`${base(p)}/conversation`, { schema: supportConversationDto })
export const sendSupportMessage = (p: SupportParty, body: SupportSendBody | StudioSupportSendBody) => api<SendResult>(`${base(p)}/messages`, { body, schema: sendResult })

/** The party's thread endpoints for useThread (there is one thread, so the id is the server's). */
export const supportEndpoints = (p: SupportParty): ThreadEndpoints => ({
  thread: (_id, q = {}) => api<ThreadDto>(`${base(p)}/conversation/messages`, { query: q, schema: threadDto }),
  read: (_id, upToSeq) => api<void>(`${base(p)}/conversation/read`, { body: { upToSeq } }),
  typing: () => api<void>(`${base(p)}/conversation/typing`, { method: "POST" }),
})

/* ---------------- admin */

export const listSupport = (q: { filter?: SupportFilter; mine?: boolean; q?: string; cursor?: string } = {}) =>
  api<SupportListDto>("/api/admin/support", { query: { filter: q.filter, mine: q.mine ? "1" : undefined, q: q.q || undefined, cursor: q.cursor }, schema: supportListDto })
export const getSupportCase = (id: string) => api<{ case: SupportCaseDto }>(`/api/admin/support/${encodeURIComponent(id)}`, { schema: supportCaseResult })
export const patchSupportCase = (id: string, body: { status?: "open" | "resolved"; assignee?: "me" | null }) => api<{ case: SupportCaseDto }>(`/api/admin/support/${encodeURIComponent(id)}`, { method: "PATCH", body, schema: supportCaseResult })
export const replyAsSupport = (id: string, clientId: string, body: string) => api<SendResult>(`/api/admin/support/${encodeURIComponent(id)}/messages`, { body: { clientId, kind: "text", body }, schema: sendResult })

export const adminSupportEndpoints: ThreadEndpoints = {
  thread: (id, q = {}) => api<ThreadDto>(`/api/admin/support/${encodeURIComponent(id)}/messages`, { query: q, schema: threadDto }),
  read: (id, upToSeq) => api<void>(`/api/admin/support/${encodeURIComponent(id)}/read`, { body: { upToSeq } }),
  typing: (id) => api<void>(`/api/admin/support/${encodeURIComponent(id)}/typing`, { method: "POST" }),
}
