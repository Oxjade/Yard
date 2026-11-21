import { studioApplyBody } from "@/lib/api/contracts/studio-app"
import { json, route } from "@/server/http/route"
import { applyFromApp, getApplication } from "@/server/studio-app"

/** GET /api/studio/apply (signed-in shopper) → { application | null }: the latest application, short or full. */
export const GET = route({ auth: "shopper", rate: { key: "studio.apply.read", limit: 120, windowSec: 60 } }, async ({ actor }) => getApplication(actor))

/**
 * POST /api/studio/apply (signed-in shopper): the app's short "Sell on Yard" application (shop
 * name, Instagram or website, category, city and country). 201 with the submitted application;
 * 200 with the one already waiting (idempotent). See docs/APP.md › Studio in the app.
 */
export const POST = route(
  { auth: "shopper", body: studioApplyBody, maxBody: 4 * 1024, rate: { key: "studio.apply", limit: 10, windowSec: 60, daily: 20 } },
  async ({ actor, body, ipHash }) => {
    const out = await applyFromApp(actor, body, ipHash)
    return json(out.result, out.status)
  },
)
