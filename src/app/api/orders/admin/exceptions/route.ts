import { route } from "@/server/http/route"
import { adminOrderExceptions } from "@/server/orders"
import { adminOrderExceptionsQuery } from "@/server/orders/contracts"

/** GET /api/orders/admin/exceptions?cursor=&limit=: pending returns and pending/failed refunds, oldest first. */
export const GET = route(
  { auth: "admin", permission: "shipping.view", query: adminOrderExceptionsQuery, rate: { key: "admin.order_exceptions", limit: 120, windowSec: 60 } },
  async ({ query }) => adminOrderExceptions(query),
)