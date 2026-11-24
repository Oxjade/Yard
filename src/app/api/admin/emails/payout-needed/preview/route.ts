import { z } from "zod"
import { previewPayoutNeeded } from "@/server/ledger/payout-needed"
import { route } from "@/server/http/route"

const query = z.object({
  /** "sale" (default): the email on a paid order. "reminder": the one reminder 3 days later. */
  variant: z.enum(["sale", "reminder"]).default("sale"),
  brand: z.string().trim().min(1).max(60).optional(),
  sales: z.coerce.number().int().min(1).max(999).optional(),
  /** "html": the email itself, to open in a browser tab. Default: JSON { subject, html, text }. */
  format: z.enum(["json", "html"]).default("json"),
})

/**
 * GET /api/admin/emails/payout-needed/preview (comms.newsletter): the "Add your payout account"
 * email (`brand_payout_needed`, docs/BRAND-EMAILS.md) with sample figures, as a brand without a
 * payout account gets it. Sends nothing. `?format=html` serves the email itself in a sandbox.
 */
export const GET = route(
  { auth: "admin", permission: "comms.newsletter", query, rate: { key: "admin.emails.preview", limit: 120, windowSec: 60 } },
  async ({ query }) => {
    const r = previewPayoutNeeded({ variant: query.variant, brand: query.brand, sales: query.sales })
    if (query.format === "html") {
      return new Response(r.html, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          // The email is static markup: no scripts, no forms, no same-origin powers.
          "Content-Security-Policy": "sandbox allow-popups allow-popups-to-escape-sandbox; default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline'; font-src https: data:",
        },
      })
    }
    return { subject: r.subject, html: r.html, text: r.text }
  },
)
