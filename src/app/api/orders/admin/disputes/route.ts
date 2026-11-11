import { db } from "@/server/db"
import { route } from "@/server/http/route"
import { adminDisputesQuery } from "@/server/orders/contracts"
import { listDisputes } from "@/server/orders/disputes"
import { toDisputeDto } from "@/server/orders/views"

/** GET /api/orders/admin/disputes?status=&limit= (admin, shipping.view): payment disputes, newest first. */
export const GET = route({ auth: "admin", permission: "shipping.view", query: adminDisputesQuery, rate: { key: "admin.disputes", limit: 120, windowSec: 60 } }, async ({ query }) => {
  const page = await listDisputes(await db(), query)
  return { ...page, items: page.items.map((r) => toDisputeDto(r, "admin")) }
})
