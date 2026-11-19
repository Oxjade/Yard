import { studioPieceActionBody } from "@/lib/api/contracts/imports"
import { idParam } from "@/server/catalog/params"
import { studioPieceAction } from "@/server/catalog/importer/watch"
import { route } from "@/server/http/route"

/**
 * POST /api/studio/catalog/website-pieces/{id} { action: "add" | "skip" } (content.publish) →
 * { items, count, mayAdd, site, productId?, published? }. "add" copies the photos into Yard and
 * creates the product as the brand, published when the brand may publish (as accepting a
 * suggestion does); "skip" (Not this one) passes on it for good. 409 when Yard got there first.
 */
export const POST = route(
  { auth: "brand", permission: "content.publish", body: studioPieceActionBody, rate: { key: "studio.website_pieces.act", limit: 30, windowSec: 60 } },
  async ({ actor, params, body, ipHash }) => studioPieceAction(actor, idParam(params, "id"), body.action, ipHash),
)
