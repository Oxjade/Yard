import { metaOf } from "@/server/auth/http"
import { revokeInvite } from "@/server/auth/invites"
import { route } from "@/server/http/route"

/** DELETE /api/auth/invites/{id} → { invite } (revoked). 404 for another brand's invite. */
export const DELETE = route({ rate: { key: "auth.invites.revoke", limit: 30, windowSec: 600 }, auth: "brand", permission: "any_member" }, async ({ req, actor, params, ipHash }) => ({ invite: await revokeInvite(actor, params.id ?? "", metaOf(req, ipHash)) }))
