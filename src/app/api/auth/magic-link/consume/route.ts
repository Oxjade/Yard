import { tokenBody } from "@/server/auth/contracts"
import { metaOf } from "@/server/auth/http"
import { consumeMagicLink } from "@/server/auth/identity"
import { route } from "@/server/http/route"

/** POST /api/auth/magic-link/consume { token } (posted by the /auth/magic page) → { status: "signed_in", actor: "shopper", profile }. */
export const POST = route({ auth: "public", body: tokenBody, maxBody: 2 * 1024 }, async ({ req, body, ipHash }) => consumeMagicLink(body.token, metaOf(req, ipHash)))
