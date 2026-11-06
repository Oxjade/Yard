import { api } from "./client"
import {
  byBrandDto,
  conversationsPage,
  customerContextDto,
  inboxSettings,
  ordersMineDto,
  quickReplyDto,
  sendResult,
  threadDto,
  unreadDto,
  type ByBrandDto,
  type ConversationSummary,
  type ConversationsPage,
  type CustomerContextDto,
  type MessageDto,
  type OrderRefSummary,
  type QuickReplyDto,
  type SendMessageBody,
  type SendResult,
  type StudioFilter,
  type StudioSendMessageBody,
  type ThreadDto,
} from "./contracts/inbox"
import { z } from "zod"

/**
 * Typed wrappers over the inbox API (§1.9). Shopper calls use the `yard_s` session, Studio calls
 * `yard_b`. The thread helpers take a `side` so the shared chat components can talk to either.
 */

export type InboxSide = "customer" | "brand"

const base = (side: InboxSide) => (side === "customer" ? "/api/inbox" : "/api/studio/inbox")

export const listConversations = (q: { q?: string; filter?: "blocked" | "archived"; cursor?: string } = {}) =>
  api<ConversationsPage>("/api/inbox/conversations", { query: q, schema: conversationsPage })

export const listStudioConversations = (q: { q?: string; filter?: StudioFilter; cursor?: string } = {}) =>
  api<ConversationsPage>("/api/studio/inbox/conversations", { query: q, schema: conversationsPage })

export const conversationByBrand = (brandId: string) => api<ByBrandDto>(`/api/inbox/conversations/by-brand/${encodeURIComponent(brandId)}`, { schema: byBrandDto })

export const getThread = (side: InboxSide, id: string, q: { before?: number; after?: number; limit?: number; q?: string } = {}) =>
  api<ThreadDto>(`${base(side)}/conversations/${encodeURIComponent(id)}/messages`, { query: q, schema: threadDto })

export const sendMessage = (body: SendMessageBody) => api<SendResult>("/api/inbox/messages", { body, schema: sendResult })
export const sendStudioMessage = (body: StudioSendMessageBody) => api<SendResult>("/api/studio/inbox/messages", { body, schema: sendResult })

export const postTyping = (side: InboxSide, id: string) => api<void>(`${base(side)}/conversations/${encodeURIComponent(id)}/typing`, { method: "POST" })
export const postRead = (side: InboxSide, id: string, upToSeq: number) => api<void>(`${base(side)}/conversations/${encodeURIComponent(id)}/read`, { body: { upToSeq } })

export const react = (side: InboxSide, messageId: string, emoji: "♥" | null) =>
  api<{ message: MessageDto }>(`${base(side)}/messages/${encodeURIComponent(messageId)}/reaction`, { body: { emoji } })

export const patchConversation = (id: string, body: { archived?: boolean; muted?: boolean }) =>
  api<{ conversation: ConversationSummary }>(`/api/inbox/conversations/${encodeURIComponent(id)}`, { method: "PATCH", body })

export const patchStudioConversation = (id: string, body: { status?: "open" | "resolved"; markedUnread?: boolean; spam?: boolean }) =>
  api<{ conversation: ConversationSummary; alertRaised: boolean }>(`/api/studio/inbox/conversations/${encodeURIComponent(id)}`, { method: "PATCH", body })

export const blockBrand = (brandId: string, on: boolean) => api<{ blocked: boolean }>("/api/inbox/blocks", { method: on ? "POST" : "DELETE", body: { brandId } })
export const blockCustomer = (userId: string, on: boolean) => api<{ blocked: boolean }>("/api/studio/inbox/blocks", { method: on ? "POST" : "DELETE", body: { userId } })

export const getUnread = () => api<{ conversations: number }>("/api/inbox/unread", { schema: unreadDto })
export const getStudioUnread = () => api<{ conversations: number }>("/api/studio/inbox/unread", { schema: unreadDto })

export const getInboxSettings = () => api<{ readReceipts: boolean }>("/api/inbox/settings", { schema: inboxSettings })
export const setInboxSettings = (readReceipts: boolean) => api<{ readReceipts: boolean }>("/api/inbox/settings", { method: "PATCH", body: { readReceipts }, schema: inboxSettings })

export const myOrdersWith = (brandId: string) => api<{ items: OrderRefSummary[] }>("/api/orders/mine", { query: { brand: brandId }, schema: ordersMineDto })

export const customerContext = (id: string) => api<CustomerContextDto>(`/api/studio/inbox/conversations/${encodeURIComponent(id)}`, { schema: customerContextDto })

const qrList = z.object({ items: z.array(quickReplyDto) })
export const listQuickReplies = () => api<{ items: QuickReplyDto[] }>("/api/studio/inbox/quick-replies", { schema: qrList })
export const createQuickReply = (body: { title: string; body: string; shortcut?: string | null }) => api<{ item: QuickReplyDto }>("/api/studio/inbox/quick-replies", { body })
export const updateQuickReply = (id: string, body: { title?: string; body?: string; shortcut?: string | null }) =>
  api<{ item: QuickReplyDto }>(`/api/studio/inbox/quick-replies/${encodeURIComponent(id)}`, { method: "PATCH", body })
export const deleteQuickReply = (id: string) => api<void>(`/api/studio/inbox/quick-replies/${encodeURIComponent(id)}`, { method: "DELETE" })
export const reorderQuickReplies = (ids: string[]) => api<{ items: QuickReplyDto[] }>("/api/studio/inbox/quick-replies/order", { method: "PUT", body: { ids }, schema: qrList })

/** A client id for idempotent sends: retrying with the same one never posts twice. */
export const newClientId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`)
