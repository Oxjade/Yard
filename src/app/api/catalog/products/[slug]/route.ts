import { route } from "@/server/http/route"
import { publicProduct } from "@/server/catalog/public"
import { idParam } from "@/server/catalog/params"

/** GET /api/catalog/products/{slug or id} (public): one public product with variants, availability and brand; 404 otherwise. */
export const GET = route({ auth: "public", rate: { key: "catalog.product", limit: 240, windowSec: 60, anonGlobal: 5000 }, cache: { public: 30, swr: 60 } }, async ({ params }) => publicProduct(idParam(params, "slug")))
