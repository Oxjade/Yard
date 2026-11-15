import { newsletterBrandsQuery } from "@/lib/api/contracts/newsletter"
import { searchBrands } from "@/server/newsletter"
import { route } from "@/server/http/route"

/** GET /api/admin/newsletters/brands?q= (comms.newsletter) → { brands }: brands to pick for "Followers of a brand", with follower counts. */
export const GET = route({ auth: "admin", permission: "comms.newsletter", query: newsletterBrandsQuery, rate: { key: "admin.newsletters.brands", limit: 240, windowSec: 60 } }, async ({ query }) => searchBrands(query.q))
