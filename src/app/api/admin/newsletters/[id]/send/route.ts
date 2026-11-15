import { newsletterSendBody } from "@/lib/api/contracts/newsletter"
import { idParam } from "@/server/catalog/params"
import { sendCampaign } from "@/server/newsletter"
import { route } from "@/server/http/route"

/**
 * POST /api/admin/newsletters/{id}/send { when: "now" | "later", at?, expectedCount, confirmed, idempotencyKey }
 * (comms.newsletter) → { campaign }. Both refuse (409) when the audience no longer matches the
 * confirmed count, type and audience; a retry with the same key changes nothing. Audited.
 */
export const POST = route(
  { auth: "admin", permission: "comms.newsletter", body: newsletterSendBody, rate: { key: "admin.newsletters.send", limit: 20, windowSec: 3600 } },
  async ({ actor, params, body, ipHash }) => sendCampaign(actor, idParam(params, "id"), body, ipHash),
)
