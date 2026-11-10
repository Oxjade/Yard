import { z } from "zod"
import { listAdminCatalogProducts } from "@/server/catalog/admin"
import { route } from "@/server/http/route"

/** GET /api/admin/catalog/products: every non-archived product, including hidden ones, for moderation. */
export const GET = route({ auth: "admin", permission: "content.moderate", query: z.object({ limit: z.coerce.number().int().min(1).max(200).default(200) }) }, async ({ query }) =>
  listAdminCatalogProducts(query.limit),
)
