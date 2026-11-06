import { shopperListQuery } from "@/lib/api/contracts/inbox"
import { route } from "@/server/http/route"
import { listShopper } from "@/server/inbox/service"

/** GET /api/inbox/conversations?q=&filter=blocked|archived&cursor= (§6.2): the shopper's own conversations, newest first. */
export const GET = route({ auth: "shopper", query: shopperListQuery, rate: { key: "inbox.list", limit: 120, windowSec: 60 } }, async ({ actor, query }) => listShopper(actor, query))
