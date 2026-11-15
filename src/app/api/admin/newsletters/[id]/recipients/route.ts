import { newsletterRecipientsQuery } from "@/lib/api/contracts/newsletter"
import { idParam } from "@/server/catalog/params"
import { campaignRecipients } from "@/server/newsletter"
import { route } from "@/server/http/route"

/** GET /api/admin/newsletters/{id}/recipients?status=&offset= (comms.newsletter) → { items, nextOffset }: per-recipient status, 50 at a time. */
export const GET = route({ auth: "admin", permission: "comms.newsletter", query: newsletterRecipientsQuery, rate: { key: "admin.newsletters", limit: 240, windowSec: 60 } }, async ({ params, query }) => campaignRecipients(idParam(params, "id"), query))
