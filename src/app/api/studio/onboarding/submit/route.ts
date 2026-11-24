import { route } from "@/server/http/route"
import { rule } from "@/server/http/errors"
import { humanCheck } from "@/server/http/human-check"
import { onboardingSubmitBody } from "@/server/catalog/contracts"
import { submitOnboarding } from "@/server/catalog/onboarding"

/**
 * POST /api/studio/onboarding/submit (signed-in shopper): re-validates every step and submits the brand for review (creates the brand as pending_review, the owner membership, the storefront draft and the first product as a draft). Idempotent once submitted.
 * Needs a verified, permanent email, one application at a time and a cap on brands per account
 * (catalog/applicant-guard.ts), and passes the bot check (server/http/human-check.ts).
 */
export const POST = route(
  { auth: "shopper", body: onboardingSubmitBody, rate: { key: "onboarding.submit", limit: 10, windowSec: 60, daily: 20 } },
  async ({ req, actor, body, ip, ipHash, bodySha256 }) => {
    if ((await humanCheck(req, body, "apply", ip, bodySha256)) === "bot") throw rule("Something didn't look right with that submission. Reload the page and try again.")
    return submitOnboarding(actor, { revision: body.revision }, ipHash)
  },
)
