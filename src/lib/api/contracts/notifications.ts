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
