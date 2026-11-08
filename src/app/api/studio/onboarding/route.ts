import { route } from "@/server/http/route"
import { getOnboarding } from "@/server/catalog/onboarding"

/** GET /api/studio/onboarding (signed-in shopper): the shopper's brand application (null before the first save) and the step order. */
export const GET = route({ auth: "shopper", rate: { key: "onboarding.read", limit: 120, windowSec: 60 } }, async ({ actor }) => getOnboarding(actor))
