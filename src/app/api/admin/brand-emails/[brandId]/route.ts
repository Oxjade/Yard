import { brandEmailSendBody } from "@/lib/api/contracts/brand-emails"
import { brandEmailContext, sendBrandEmail } from "@/server/catalog/brand-emails"
import { idParam } from "@/server/catalog/params"
import { route } from "@/server/http/route"

/** GET /api/admin/brand-emails/{brandId} (brands.email) → who gets the brand's email, the last emails Yard sent it, and today's count. */
export const GET = route({ auth: "admin", permission: "brands.email", rate: { key: "admin.brand_emails", limit: 240, windowSec: 60 } }, async ({ params }) => brandEmailContext(idParam(params, "brandId")))

/**
 * POST /api/admin/brand-emails/{brandId} { preset, subject, body, idempotencyKey } (brands.email):
 * emails the brand's owners and admins from a one-tap template. 5 a day per brand; a retry with
 * the same key sends nothing new. Audited (preset and subject, never the body).
 */
export const POST = route(
  { auth: "admin", permission: "brands.email", body: brandEmailSendBody, maxBody: 16 * 1024, rate: { key: "admin.brand_emails.send", limit: 30, windowSec: 3600, daily: 120 } },
  async ({ actor, params, body, ipHash }) => sendBrandEmail(actor, idParam(params, "brandId"), body, ipHash),
)
