import { z } from "zod"
import { notificationsReadBody } from "@/lib/api/contracts/notifications"
import { withTx } from "@/server/db"
import { badRequest } from "@/server/http/errors"
import { route } from "@/server/http/route"
import { markNotifications, recipientOf } from "@/server/notify"

/**
 * POST /api/notifications/read?as= { keys?, all?, read? } (§2.7). Only the current recipient's
 * rows change; notification.read goes to every tab of that recipient.
 */
export const POST = route(
  { auth: "multi", as: ["shopper", "brand", "admin"], query: z.object({ as: z.enum(["shopper", "brand", "admin"]) }), body: notificationsReadBody, rate: { key: "notifications.mark", limit: 60, windowSec: 60 } },
  async ({ actor, body }) => {
    if (!body.all && !body.keys?.length) throw badRequest({ keys: "Name the notifications to mark, or send all: true." })
    return withTx(() => markNotifications(recipientOf(actor), { keys: body.keys, all: body.all, read: body.read }))
  },
)
