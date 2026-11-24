import { emailRequestBody } from "@/server/auth/contracts"
import { metaOf } from "@/server/auth/http"
import { requestMagicLink } from "@/server/auth/identity"
import { humanCheck } from "@/server/http/human-check"
import { route } from "@/server/http/route"

/** POST /api/auth/magic-link { email, turnstileToken?, hp?, formStartedAt? } → { ok: true } (a 15-minute sign-in link, shoppers only). A bot gets the same answer and no email. */
export const POST = route({ auth: "public", body: emailRequestBody, maxBody: 4 * 1024 }, async ({ req, body, ip, ipHash, bodySha256 }) => {
  if ((await humanCheck(req, body, "magic", ip, bodySha256)) === "bot") return { ok: true as const }
  return requestMagicLink(body.email, metaOf(req, ipHash))
})
