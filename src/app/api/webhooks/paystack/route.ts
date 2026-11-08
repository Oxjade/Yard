import { HttpError } from "@/server/http/errors"
import { route } from "@/server/http/route"
import { log } from "@/server/log"
import { paymentsConfig } from "@/server/payments/config"
import { processEvent, recordProviderEvent } from "@/server/payments/events"
import { verifyPaystackSignature } from "@/server/payments/providers"

const MAX = 256 * 1024

/**
 * POST /api/webhooks/paystack (public, no CSRF: Paystack calls it server to server). The
 * x-paystack-signature header must be the HMAC-SHA512 of the exact raw body under the secret
 * key (constant-time compare); anything else is 401 and nothing is stored (also when no keys are
 * configured: nothing can be verified then). A verified event is
 * stored raw first, then processed idempotently. A processing failure answers 500 so Paystack
 * retries (the retry finds the stored event and processes it again); admins can also replay it.
 */
export const POST = route(
  { auth: "public", csrf: false, maxBody: MAX, rate: { key: "webhooks.paystack", limit: 600, windowSec: 60, anonGlobal: 3000 } },
  async ({ req }) => {
    const signature = req.headers.get("x-paystack-signature")
    // An unsigned request is refused the same way whether or not keys are configured.
    if (!signature || !/^[0-9a-f]{128}$/i.test(signature.trim())) {
      log.warn("[yard] Paystack webhook with a missing or malformed signature was refused")
      return Response.json({ error: { code: "unauthenticated", message: "Invalid signature." } }, { status: 401 })
    }
    const rawBody = await req.text()
    if (rawBody.length > MAX) throw new HttpError(413, "too_large", "This request is too large.")
    // No keys configured: nothing can be verified, so every signature is invalid (401, never processed).
    if (!verifyPaystackSignature(rawBody, signature)) {
      if (!paymentsConfig().webhookKeys.length) log.once("payments-webhook-nokeys", "warn", "[yard] Paystack webhook refused: no PAYSTACK_WEBHOOK_SECRET / PAYSTACK_SECRET_KEY to verify it with.")
      else log.warn("[yard] Paystack webhook with an invalid signature was refused")
      return Response.json({ error: { code: "unauthenticated", message: "Invalid signature." } }, { status: 401 })
    }
    let payload: { event?: unknown; data?: Record<string, unknown> }
    try {
      payload = JSON.parse(rawBody) as typeof payload
    } catch {
      return Response.json({ error: { code: "validation", message: "Body isn't JSON." } }, { status: 400 })
    }
    if (!payload || typeof payload !== "object" || typeof payload.event !== "string") return Response.json({ error: { code: "validation", message: "Not a Paystack event." } }, { status: 400 })
    const ev = await recordProviderEvent({ provider: "paystack", source: "webhook", payload, rawBody, signatureValid: true })
    const r = await processEvent(ev.id)
    if (r.status === "failed") return Response.json({ ok: false, eventId: ev.id }, { status: 500 })
    return { ok: true }
  },
)
