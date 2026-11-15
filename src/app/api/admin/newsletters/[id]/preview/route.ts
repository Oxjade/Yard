import { newsletterPreviewBody } from "@/lib/api/contracts/newsletter"
import { idParam } from "@/server/catalog/params"
import { previewCampaign } from "@/server/newsletter"
import { route } from "@/server/http/route"

/** POST /api/admin/newsletters/{id}/preview { …unsaved fields } (comms.newsletter) → { subject, html, text }: the real email. Sends nothing. */
export const POST = route(
  { auth: "admin", permission: "comms.newsletter", body: newsletterPreviewBody, maxBody: 32 * 1024, rate: { key: "admin.newsletters.preview", limit: 240, windowSec: 60 } },
  async ({ actor, params, body }) => previewCampaign(actor, idParam(params, "id"), body),
)
