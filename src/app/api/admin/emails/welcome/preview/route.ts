import { z } from "zod"
import { previewShopperWelcome } from "@/server/email/welcome"
import { route } from "@/server/http/route"

const query = z.object({
  /** "live" (default): the brands a send would pick now. 0–4: that many of them (0 = no list). */
  brands: z.union([z.literal("live"), z.coerce.number().int().min(0).max(4)]).default("live"),
  name: z.string().trim().min(1).max(60).optional(),
  /** "html": the email itself, to open in a browser tab. Default: JSON { subject, html, text, brands }. */
  format: z.enum(["json", "html"]).default("json"),
})

/**
 * GET /api/admin/emails/welcome/preview (comms.newsletter): the shopper welcome email
 * (`shopper_welcome`) as a new shopper would get it, with the brands to follow picked the way a
 * send picks them. Sends nothing. `?format=html` serves the email itself in a sandbox.
 */
export const GET = route(
  { auth: "admin", permission: "comms.newsletter", query, rate: { key: "admin.emails.preview", limit: 120, windowSec: 60 } },
  async ({ query }) => {
    const r = await previewShopperWelcome({ brands: query.brands, name: query.name })
    if (query.format === "html") {
      return new Response(r.html, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          // The email is static markup: no scripts, no forms, no same-origin powers.
          "Content-Security-Policy": "sandbox allow-popups allow-popups-to-escape-sandbox; default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline'; font-src https: data:",
        },
      })
    }
    return { subject: r.subject, html: r.html, text: r.text, brands: r.brands }
  },
)
