import { HttpError, notConfigured } from "@/server/http/errors"
import { route } from "@/server/http/route"
import { log } from "@/server/log"
import { paymentsConfig } from "@/server/payments/config"
import { processEvent, recordProviderEvent } from "@/server/payments/events"
import { verifyPaystackSignature } from "@/server/payments/providers"

const MAX = 256 * 1024

/**
 * POST /api/webhooks/paystack (public, no CSRF: Paystack calls it server to server). The
 * x-paystack-signature header must be the HMAC-SHA512 of the exact raw body under the secret
 * key (constant-time compare); anything else is 401 and nothing is stored. A verified event is
 * stored raw first, then processed idempotently. A processing failure answers 500 so Paystack
 * retries (the retry finds the stored event and processes it again); admins can also replay it.
 */
export const POST = route(
  { auth: "public", csrf: false, maxBody: MAX, rate: { key: "webhooks.paystack", limit: 600, windowSec: 60, anonGlobal: 3000 } },
  async ({ req }) => {
    if (!paymentsConfig().webhookKeys.length) throw notConfigured("Payments aren't connected.")
    const rawBody = await req.text()
    if (rawBody.length > MAX) throw new HttpError(413, "too_large", "This request is too large.")
    if (!verifyPaystackSignature(rawBody, req.headers.get("x-paystack-signature"))) {
      log.warn("[yard] Paystack webhook with a missing or invalid signature was refused")
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
