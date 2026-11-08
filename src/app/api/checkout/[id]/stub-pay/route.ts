import { isSafeId } from "@/lib/api/contracts/common"
import { getEnv } from "@/server/env"
import { notFound } from "@/server/http/errors"
import { route } from "@/server/http/route"
import { simulateStubPayment, stubPayBody } from "@/server/payments/checkout"
import { paymentsConfig } from "@/server/payments/config"

/**
 * POST /api/checkout/{id}/stub-pay { outcome: "success" | "failed" } — DEVELOPMENT ONLY, and only
 * while the payment STUB is active (no PAYSTACK_SECRET_KEY). Simulates the provider's answer for
 * a stub payment so the paid / failed paths can be exercised. 404 everywhere else.
 */
export const POST = route({ auth: "shopper", body: stubPayBody, maxBody: 512, rate: { key: "checkout.stub", limit: 20, windowSec: 60 } }, async ({ actor, params, body }) => {
  if (!getEnv().dev || paymentsConfig().provider !== "stub" || !isSafeId(params.id)) throw notFound()
  return simulateStubPayment(actor, params.id, body.outcome)
})
