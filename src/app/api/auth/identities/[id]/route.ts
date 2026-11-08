import { metaOf } from "@/server/auth/http"
import { unlinkIdentity } from "@/server/auth/oauth/flow"
import { route } from "@/server/http/route"

/** DELETE /api/auth/identities/{id}?as=shopper|brand. Refused (422) when it's the only way left to sign in. */
export const DELETE = route({ auth: "multi", as: ["shopper", "brand"] }, async ({ req, actor, params, ipHash }) =>
  unlinkIdentity({ userId: actor.userId, name: actor.name, kind: actor.kind === "brand" ? "brand" : "shopper" }, params.id ?? "", metaOf(req, ipHash)),
)
