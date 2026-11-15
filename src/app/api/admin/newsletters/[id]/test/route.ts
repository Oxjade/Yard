import { newsletterTestBody } from "@/lib/api/contracts/newsletter"
import { NEWSLETTER_TESTS_PER_HOUR } from "@/lib/newsletter"
import { idParam } from "@/server/catalog/params"
import { testCampaign } from "@/server/newsletter"
import { route } from "@/server/http/route"

/** POST /api/admin/newsletters/{id}/test { idempotencyKey } (comms.newsletter) → { to, created }: the campaign to the admin's own address. 10 an hour. Audited. */
export const POST = route(
  { auth: "admin", permission: "comms.newsletter", body: newsletterTestBody, rate: { key: "admin.newsletters.test", limit: NEWSLETTER_TESTS_PER_HOUR, windowSec: 3600 } },
  async ({ actor, params, body, ipHash }) => testCampaign(actor, idParam(params, "id"), body.idempotencyKey, ipHash),
)
