import { tokenBody } from "@/server/auth/contracts"
import { metaOf } from "@/server/auth/http"
import { previewInvite } from "@/server/auth/invites"
import { route } from "@/server/http/route"

/** POST /api/auth/invites/preview { token } → { brand, role, roleLabel, email (masked), hasAccount, expiresAt } | 404. */
export const POST = route({ auth: "public", body: tokenBody, maxBody: 1024 }, async ({ req, body, ipHash }) => previewInvite(body.token, metaOf(req, ipHash)))
