import { adminSupportQuery } from "@/lib/api/contracts/support"
import { route } from "@/server/http/route"
import { listSupport } from "@/server/support/service"

/** GET /api/admin/support?filter=open|resolved|all&mine=1&q=&cursor= → SupportListDto (unread open conversations first). */
export const GET = route({ auth: "admin", permission: "support.manage", query: adminSupportQuery, rate: { key: "admin.support", limit: 240, windowSec: 60 } }, async ({ actor, query }) => listSupport(actor, query))
