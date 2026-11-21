import { studioSwitchBody } from "@/lib/api/contracts/studio-app"
import { metaOf } from "@/server/auth/http"
import { route } from "@/server/http/route"
import { switchToBrand } from "@/server/studio-app"

/**
 * POST /api/studio/session/switch { brandId } (signed-in shopper) → { actor: "brand", profile }
 * and the brand session cookie (`yard_b`) in this client's jar: the app's way into Studio without
 * a second sign-in (docs/APP.md › Studio in the app). 403 `forbidden` for a brand the account isn't
 * an active member of, 403 `suspended` for a suspended brand. Replaces this client's brand session.
 */
export const POST = route(
  { auth: "shopper", body: studioSwitchBody, maxBody: 1024, rate: { key: "studio.session_switch", limit: 30, windowSec: 60 } },
  async ({ req, actor, body, ipHash }) => switchToBrand(actor, body.brandId, metaOf(req, ipHash)),
)
