import { z } from "zod"
import { listAdminCatalogProducts } from "@/server/catalog/admin"
import { route } from "@/server/http/route"

const query = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  cursor: z.string().max(200).optional(),
  q: z.string().trim().max(120).optional(),
  moderation: z.enum(["hidden", "ok"]).optional(),
  category: z.string().trim().max(60).optional(),
})

/**
 * GET /api/admin/catalog/products?q=&moderation=hidden|ok&category=&cursor=&limit=: every non-archived
 * product, including hidden ones, for moderation. Newest edit first, paged by nextCursor.
 */
export const GET = route({ auth: "admin", permission: "content.moderate", query }, async ({ query }) => listAdminCatalogProducts(query))
