import { z } from "zod"
import { actorKind } from "./common"

/**
 * Server notifications (§2.7). Titles and bodies come from templates only: never message text,
 * report details, captions or complaint text.
 */
/** A same-origin path ("/inbox?thread=…"): never a scheme, a protocol-relative "//host" or a backslash. */
export const SAME_ORIGIN_PATH = /^\/(?!\/)[^\s\\]*$/
export const isSameOriginPath = (href: unknown): href is string => typeof href === "string" && href.length <= 500 && SAME_ORIGIN_PATH.test(href)

export const notificationDto = z.object({
  id: z.string(),
  /** The server event key, e.g. "msg:cv_seed_ada_ls". The store namespaces it as srv:<kind>:<id>:<key>. */
  key: z.string(),
  recipient: z.object({ kind: actorKind, id: z.string() }),
  category: z.string(),
  title: z.string(),
  body: z.string(),
  /** Where the notification opens: a same-origin path only (notify() refuses anything else). */
  href: z.string().max(500).regex(SAME_ORIGIN_PATH, "Use a path on Yard.").nullable(),
  at: z.string(),
  read: z.boolean(),
})
export type NotificationDto = z.infer<typeof notificationDto>

/** GET /api/notifications?as=&after= */
export const notificationsQuery = z.object({ as: actorKind, after: z.string().datetime({ offset: true }).optional() })
export const notificationsResult = z.object({ items: z.array(notificationDto) })

/** POST /api/notifications/read?as= — server event keys of the current recipient, or all. */
export const notificationsReadBody = z
  .object({
    keys: z.array(z.string().min(1).max(200)).max(200).optional(),
    all: z.boolean().optional(),
    read: z.boolean().optional(),
  })
  .strict()
export const notificationsReadResult = z.object({ updated: z.number(), keys: z.array(z.string()), read: z.boolean() })

/** Payload of notification.read on the realtime channel. */
export const notificationReadEvent = z.object({ recipient: z.object({ kind: actorKind, id: z.string() }), keys: z.array(z.string()), all: z.boolean(), read: z.boolean() })

/**
 * Payload of notification.removed: the recipient's notifications that were deleted on the server
 * (a test-data restore, a removed conversation). Tabs drop those srv: items at once.
 */
export const notificationRemovedEvent = z.object({ recipient: z.object({ kind: actorKind, id: z.string() }), keys: z.array(z.string()) })

/** POST /api/devices: a phone that receives push notifications (the Yard Android app; iOS later). */
export const pushDeviceBody = z
  .object({
    platform: z.enum(["android", "ios"]),
    token: z.string().min(1).max(4096).regex(/^[^\s\u0000-\u001f\u007f]+$/, "Send the push token as the platform gave it."),
    appVersion: z.string().trim().min(1).max(64).regex(/^[^\u0000-\u001f\u007f<>]+$/).optional(),
    /** The app can open Studio: this device also gets Studio pushes (docs/APP.md › Studio in the app). Omitted: unchanged (false for a new device). */
    studio: z.boolean().optional(),
  })
  .strict()
export type PushDeviceBody = z.infer<typeof pushDeviceBody>

/** DELETE /api/devices (the app calls it before it signs out). */
export const pushDeviceDeleteBody = z.object({ token: z.string().min(1).max(4096) }).strict()

/* ---------- iOS Live Activity push tokens (docs/APP.md › Live Activity push) ---------- */

const liveActivityToken = z.string().regex(/^[0-9a-fA-F]{32,512}$/, "Send the push token as hex, as ActivityKit gave it.").transform((t) => t.toLowerCase())

/**
 * POST /api/orders/{id}/live-activity and POST /api/live-activity/push-to-start. `timeZone`: the
 * phone's IANA zone (TimeZone.current.identifier), so the ETA lands at 20:00 on the phone's clock.
 */
export const liveActivityTokenBody = z
  .object({
    token: liveActivityToken,
    timeZone: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_+\-]+(?:\/[A-Za-z0-9_+\-]+)*$/, "Send the time zone's identifier, e.g. Africa/Lagos.").optional(),
    appVersion: z.string().trim().min(1).max(64).regex(/^[^\u0000-\u001f\u007f<>]+$/).optional(),
  })
  .strict()
export type LiveActivityTokenBody = z.infer<typeof liveActivityTokenBody>

/** DELETE of either: the token only. */
export const liveActivityTokenDeleteBody = z.object({ token: liveActivityToken }).strict()
