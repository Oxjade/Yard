import { brandEmailPreviewBody } from "@/lib/api/contracts/brand-emails"
import { previewBrandEmail } from "@/server/catalog/brand-emails"
import { idParam } from "@/server/catalog/params"
import { route } from "@/server/http/route"

/** POST /api/admin/brand-emails/{brandId}/preview { preset, subject, body } (brands.email) → { subject, html, text }: the email as the brand would get it. Sends nothing. */
export const POST = route(
  { auth: "admin", permission: "brands.email", body: brandEmailPreviewBody, maxBody: 16 * 1024, rate: { key: "admin.brand_emails.preview", limit: 120, windowSec: 60 } },
  async ({ actor, params, body }) => previewBrandEmail(actor, idParam(params, "brandId"), body),
)
