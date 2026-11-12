import { disconnectBody } from "@/lib/api/contracts/social"
import { route } from "@/server/http/route"
import { disconnect } from "@/server/social/service"

/** POST …/accounts/{id}/disconnect (social.connect) { deletePosts }: revoke, delete tokens, hide or delete imports. */
export const POST = route({ rate: { key: "studio.social.disconnect", limit: 10, windowSec: 60 }, auth: "brand", permission: "social.connect", body: disconnectBody }, async ({ params, body, ipHash }) => disconnect(params.id ?? "", body.deletePosts, ipHash))
