import { adminBrandsQuery } from "@/lib/api/contracts/admin-brands"
import { listAdminBrands } from "@/server/admin/brands-directory"
import { route } from "@/server/http/route"

/**
 * GET /api/admin/brands?q=&status=&page=&pageSize= (brands.restrict): Admin › Brands › All brands.
 * Every row of the brands table by name, whatever its application says (none, draft, submitted,
 * approved, rejected), closed and founding brands included, with its latest application and
 * product count. `status` is all | pending_review | verified | restricted | suspended | closed |
 * founding | no_application | draft | rejected. → { items, total, page, pageSize }.
 */
export const GET = route({ rate: { key: "admin.brands.list", limit: 120, windowSec: 60 }, auth: "admin", permission: "brands.restrict", query: adminBrandsQuery }, async ({ query }) => listAdminBrands(query))
