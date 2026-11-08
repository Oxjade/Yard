import { oauthStartBody } from "@/server/auth/contracts"
import { metaOf } from "@/server/auth/http"
import { parseProvider, startOAuth } from "@/server/auth/oauth/flow"
import { route } from "@/server/http/route"

/**
 * POST /api/auth/oauth/{google|apple}/start { mode = signin | link | reauth, actor = shopper | brand, brandId? }
 *  → { url }; the client then navigates to it. 503 not_configured when the provider has no keys
 * (check GET /api/auth/providers first and hide the button). link / reauth need a signed-in
 * session of `actor`. The callback ends at /auth/complete?provider=&mode=&actor=&result=.
 */
export const POST = route({ auth: "public", body: oauthStartBody, maxBody: 2 * 1024 }, async ({ req, body, params, ipHash }) =>
  startOAuth({ provider: parseProvider(params.provider), mode: body.mode, actor: body.actor, brandId: body.brandId ?? null }, metaOf(req, ipHash)),
)
