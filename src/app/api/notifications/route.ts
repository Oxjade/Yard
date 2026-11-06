import { notificationsQuery } from "@/lib/api/contracts/notifications"
import { route } from "@/server/http/route"
import { listNotifications, recipientOf } from "@/server/notify"

/**
 * GET /api/notifications?as=shopper|brand|admin&after=<iso> (§2.7). Only the `as` cookie is
 * read. A brand member reads the active brand's notifications.
 */
export const GET = route(
  { auth: "multi", as: ["shopper", "brand", "admin"], query: notificationsQuery, rate: { key: "notifications.read", limit: 120, windowSec: 60 } },
  async ({ actor, query }) => ({ items: await listNotifications(recipientOf(actor), query.after ? new Date(query.after) : undefined) }),
)
