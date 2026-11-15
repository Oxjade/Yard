import { newsletterAudienceQuery } from "@/lib/api/contracts/newsletter"
import { audienceCount } from "@/server/newsletter"
import { route } from "@/server/http/route"

/** GET /api/admin/newsletters/audience?kind=&type=&brandId=&country= (comms.newsletter) → { count }: how many people it would reach right now. */
export const GET = route({ auth: "admin", permission: "comms.newsletter", query: newsletterAudienceQuery, rate: { key: "admin.newsletters.audience", limit: 240, windowSec: 60 } }, async ({ query }) => audienceCount(query))
