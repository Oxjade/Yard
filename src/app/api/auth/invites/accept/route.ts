import { inviteAcceptBody } from "@/server/auth/contracts"
import { getShopper } from "@/server/auth/dal"
import { metaOf } from "@/server/auth/http"
import { acceptInvite } from "@/server/auth/invites"
import { route } from "@/server/http/route"

/**
 * POST /api/auth/invites/accept { token, name?, password? } → { status: "signed_in", actor: "brand", profile }.
 * If the invited email has an account: be signed in as that shopper (401 otherwise). If not:
 * send name + password to create the account here.
 */
export const POST = route({ auth: "public", body: inviteAcceptBody, maxBody: 2 * 1024 }, async ({ req, body, ipHash }) => acceptInvite(body, await getShopper(), metaOf(req, ipHash)))
