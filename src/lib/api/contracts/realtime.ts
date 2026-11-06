import { z } from "zod"
import { inboxRealtimeEvents } from "./inbox"
import { notificationDto, notificationReadEvent } from "./notifications"
import { shippingRealtimeEvents } from "./shipping"
import { socialRealtimeEvents } from "./social"

/**
 * Realtime event payloads (§4.2). The union imports each feature's payloads from that feature's
 * own contract file, so the owning cluster can change them without editing this one (F2 owns it
 * in wave 2). Replayed events carry the redacted durable form with `partial: true`.
 */
export const realtimeEvents = {
  ...inboxRealtimeEvents,
  ...shippingRealtimeEvents,
  ...socialRealtimeEvents,
  "notification.created": notificationDto,
  "notification.read": notificationReadEvent,
  "moderation.counts": z.object({ messages: z.number(), content: z.number(), places: z.number(), charts: z.number(), delivery: z.number(), abuse: z.number() }).partial(),
  "session.ended": z.object({ reason: z.string() }),
  resync: z.object({}),
  hello: z.object({ lastSeq: z.number(), serverTime: z.string() }),
  /** reason: "replaced" (a 5th stream on this session), "refresh" (10-minute rotation) or "error". */
  bye: z.object({ reason: z.string() }),
  selftest: z.object({ run: z.string(), variant: z.string() }),
}
export type RealtimeEventType = keyof typeof realtimeEvents
export type RealtimePayload<K extends RealtimeEventType> = z.infer<(typeof realtimeEvents)[K]>

export type Surface = "market" | "studio" | "admin"
export type RealtimeStatus = "idle" | "connecting" | "open" | "retrying" | "polling" | "offline"

/**
 * GET /api/realtime/<surface>/poll?after=<seq>: the redacted events after `after`. `resync` says
 * the log no longer holds everything after it (refetch lists instead of trusting the events).
 */
export const pollResult = z.object({ events: z.array(z.object({ seq: z.number(), type: z.string(), payload: z.unknown(), partial: z.literal(true) })), lastSeq: z.number(), resync: z.boolean() })
export type PollResult = z.infer<typeof pollResult>

/** What a handler learns besides the payload: the event id (durable events only) and whether it is a replayed, redacted copy. */
export type RealtimeMeta = { seq?: number; partial: boolean }
