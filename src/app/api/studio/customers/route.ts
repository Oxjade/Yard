import { route } from "@/server/http/route"
import { studioCustomers } from "@/server/analytics"

/** GET /api/studio/customers (any member): the active brand's buyers from its own orders (name, city, orders, spend), memoised two minutes. No contact details. */
export const GET = route(
  { auth: "brand", permission: "any_member", rate: { key: "studio.customers", limit: 60, windowSec: 60 } },
  async ({ actor }) => studioCustomers(actor.brandId, actor.brand.currency),
)
