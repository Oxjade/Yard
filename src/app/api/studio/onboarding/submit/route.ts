import { route } from "@/server/http/route"
import { onboardingSubmitBody } from "@/server/catalog/contracts"
import { submitOnboarding } from "@/server/catalog/onboarding"

/** POST /api/studio/onboarding/submit (signed-in shopper): re-validates every step and submits the brand for review (creates the brand as pending_review, the owner membership, the storefront draft and the first product as a draft). Idempotent once submitted. */
export const POST = route(
  { auth: "shopper", body: onboardingSubmitBody, rate: { key: "onboarding.submit", limit: 10, windowSec: 60, daily: 20 } },
  async ({ actor, body, ipHash }) => submitOnboarding(actor, body, ipHash),
)
