import { route } from "@/server/http/route"
import { orderDetail } from "@/server/orders"
import { pathId } from "@/server/orders/access"

/** GET /api/orders/admin/{id} (admin, shipping.view): any order, as Yard's support team sees it. */
export const GET = route({ auth: "admin", permission: "shipping.view", rate: { key: "admin.order", limit: 240, windowSec: 60 } }, async ({ params }) => ({ order: await orderDetail("admin", pathId(params.id), {}) }))
