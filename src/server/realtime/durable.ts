import "server-only"

/**
 * The redacted form of an event as stored in realtime_events (§4.1). Stored rows never hold
 * user-written text: message events keep only ids and status, conversation updates drop the
 * preview. Replay sends this form with "partial": true and the client fetches the rest through
 * the scoped API, so a body Yard removed is never replayed from the 24-hour log.
 */
export function toDurable(type: string, payload: unknown): Record<string, unknown> {
  const p = (payload ?? {}) as Record<string, unknown>
  switch (type) {
    case "message.created":
    case "message.updated": {
      const m = (p.message ?? p) as Record<string, unknown>
      return { conversationId: m.conversationId ?? p.conversationId, messageId: m.id ?? m.messageId ?? p.messageId, seq: m.seq ?? p.seq, status: m.status ?? p.status }
    }
    case "conversation.updated": {
      const c = (p.conversation ?? p) as Record<string, unknown>
      const out: Record<string, unknown> = { ...c }
      if (out.lastMessage && typeof out.lastMessage === "object") {
        const lm = { ...(out.lastMessage as Record<string, unknown>) }
        delete lm.preview
        out.lastMessage = lm
      }
      delete out.lastPreview
      return p.conversation ? { ...p, conversation: out } : out
    }
    default:
      // Other event types carry no user text by contract (§4.2) and are stored as they are.
      return p
  }
}
