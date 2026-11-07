import { route } from "@/server/http/route"
import { unreadShopper } from "@/server/inbox/service"

/** GET /api/inbox/unread → { conversations }: the shopper's unread badge (§4.3). */
export const GET = route({ auth: "shopper", rate: { key: "inbox.unread", limit: 120, windowSec: 60 } }, async ({ actor }) => ({ conversations: await unreadShopper(actor.userId) }))
