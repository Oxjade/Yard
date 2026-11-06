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
  bye: z.object({ reason: z.string() }),
  selftest: z.object({ run: z.string(), variant: z.string() }),
}
export type RealtimeEventType = keyof typeof realtimeEvents
export type RealtimePayload<K extends RealtimeEventType> = z.infer<(typeof realtimeEvents)[K]>

export type Surface = "market" | "studio" | "admin"
export type RealtimeStatus = "idle" | "connecting" | "open" | "retrying" | "polling" | "offline"

export const pollResult = z.object({ events: z.array(z.object({ seq: z.number(), type: z.string(), payload: z.unknown(), partial: z.literal(true) })), lastSeq: z.number() })
