import { newsletterCreateBody } from "@/lib/api/contracts/newsletter"
import { createCampaign, listCampaigns } from "@/server/newsletter"
import { route } from "@/server/http/route"

/** GET /api/admin/newsletters (comms.newsletter) → { items, counts }: the newest 200 campaigns with their send stats. */
export const GET = route({ auth: "admin", permission: "comms.newsletter", rate: { key: "admin.newsletters", limit: 240, windowSec: 60 } }, async () => listCampaigns())

/** POST /api/admin/newsletters { kind? } (comms.newsletter) → { campaign }: a new, empty draft. Audited. */
export const POST = route(
  { auth: "admin", permission: "comms.newsletter", body: newsletterCreateBody, rate: { key: "admin.newsletters.create", limit: 30, windowSec: 3600 } },
  async ({ actor, body }) => createCampaign(actor, body),
)
