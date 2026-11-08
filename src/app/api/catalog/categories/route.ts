import { route } from "@/server/http/route"
import { publicCategories } from "@/server/catalog/public"

/** GET /api/catalog/categories (public): the marketplace categories with subcategories and public product counts. */
export const GET = route({ auth: "public", rate: { key: "catalog.categories", limit: 120, windowSec: 60, anonGlobal: 3000 }, cache: { public: 300, swr: 600 } }, async () => publicCategories())
