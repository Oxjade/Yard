import { route } from "@/server/http/route"
import { variantsQuery } from "@/server/catalog/contracts"
import { publicVariants } from "@/server/catalog/public"

/**
 * GET /api/catalog/variants?ids=a&ids=b (public, never cached): live price and availability of
 * sellable variants (CATALOG getSellableVariants). Unsellable or unknown ids are left out.
 */
export const GET = route({ auth: "public", query: variantsQuery, rate: { key: "catalog.variants", limit: 120, windowSec: 60, anonGlobal: 3000 } }, async ({ query }) => publicVariants(query.ids))
