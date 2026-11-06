import { studioListQuery } from "@/lib/api/contracts/inbox"
import { route } from "@/server/http/route"
import { listStudio } from "@/server/inbox/service"

/** GET /api/studio/inbox/conversations?filter=open|unread|resolved|spam|blocked&q=&cursor= : the active brand's conversations, with counts per filter. */
export const GET = route({ auth: "brand", permission: "inbox.read", query: studioListQuery, rate: { key: "studio.inbox.list", limit: 180, windowSec: 60 } }, async ({ actor, query }) => listStudio(actor, query))
