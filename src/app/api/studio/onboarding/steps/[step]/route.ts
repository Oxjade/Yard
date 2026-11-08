import { route } from "@/server/http/route"
import { onboardingStepBody, onboardingStepSchemas, type OnboardingStep } from "@/server/catalog/contracts"
import { saveOnboardingStep } from "@/server/catalog/onboarding"
import { notFound } from "@/server/http/errors"

/**
 * PUT /api/studio/onboarding/steps/{account|brand|storefront|business|product|payments} (signed-in
 * shopper): validates and saves one step. `revision` is the application revision you loaded (0
 * for the first save); a stale one is 409. Field errors come back as `data.<field>`.
 */
export const PUT = route(
  { auth: "shopper", body: onboardingStepBody, maxBody: 64 * 1024, rate: { key: "onboarding.save", limit: 60, windowSec: 60, daily: 1000 } },
  async ({ actor, params, body }) => {
    const step = params.step as OnboardingStep
    if (!Object.hasOwn(onboardingStepSchemas, step)) throw notFound()
    return saveOnboardingStep(actor, step, body)
  },
)
