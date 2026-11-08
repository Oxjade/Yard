import { emailOnlyBody } from "@/server/auth/contracts"
import { metaOf } from "@/server/auth/http"
import { requestMagicLink } from "@/server/auth/identity"
import { route } from "@/server/http/route"

/** POST /api/auth/magic-link { email } → { ok: true } (a 15-minute sign-in link, shoppers only). */
export const POST = route({ auth: "public", body: emailOnlyBody, maxBody: 2 * 1024 }, async ({ req, body, ipHash }) => requestMagicLink(body.email, metaOf(req, ipHash)))
