import { route } from "@/server/http/route"
import { stockAdjustBody } from "@/server/catalog/contracts"
import { idParam } from "@/server/catalog/params"
import { adjustStock } from "@/server/catalog/stock"

/**
 * POST /api/studio/catalog/variants/{id}/stock (orders.fulfil): mode adjust (add qty, may be
 * negative) or set (a stock count). Writes an append-only movement and an audit row; never below
 * what live checkouts hold (422).
 */
export const POST = route(
  { auth: "brand", permission: "orders.fulfil", body: stockAdjustBody, rate: { key: "studio.catalog.stock", limit: 120, windowSec: 60 } },
  async ({ actor, params, body, ipHash }) => adjustStock(actor, idParam(params, "id"), body, ipHash),
)
