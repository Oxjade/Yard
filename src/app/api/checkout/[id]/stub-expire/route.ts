import { isSafeId } from "@/lib/api/contracts/common"
import { getEnv } from "@/server/env"
import { notFound } from "@/server/http/errors"
import { route } from "@/server/http/route"
import { simulateStubExpiry } from "@/server/payments/checkout"
import { paymentsConfig } from "@/server/payments/config"

/**
 * POST /api/checkout/{id}/stub-expire — DEVELOPMENT ONLY, and only while the payment STUB is
 * active. Runs the expiry job for the shopper's own pending stub checkout as if its hold had run
 * out (payment abandoned, stock hold and drop claims released, ORDERS told). 404 everywhere else.
 */
export const POST = route({ auth: "shopper", rate: { key: "checkout.stub", limit: 20, windowSec: 60 } }, async ({ actor, params }) => {
  if (!getEnv().dev || paymentsConfig().provider !== "stub" || !isSafeId(params.id)) throw notFound()
  return simulateStubExpiry(actor, params.id)
})
