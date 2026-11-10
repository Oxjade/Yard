import { route } from "@/server/http/route"
import { adminOrders } from "@/server/orders"
import { ordersListQuery } from "@/server/orders/contracts"

/** GET /api/orders/admin?before=&limit= (admin, shipping.view): paginated order summaries. */
export const GET = route(
  { auth: "admin", permission: "shipping.view", query: ordersListQuery, rate: { key: "admin.orders", limit: 120, windowSec: 60 } },
  async ({ query }) => adminOrders(query),
)