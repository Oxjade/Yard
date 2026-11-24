import { HttpError } from "@/server/http/errors"
import { route } from "@/server/http/route"
import { log } from "@/server/log"
import { recordCourierWebhook } from "@/server/shipping/courier-webhook"
import { getCourier } from "@/server/shipping/providers"

const MAX = 256 * 1024

const refuse = (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status })

/**
 * POST /api/webhooks/shipbubble (public, no CSRF: Shipbubble calls it server to server). Register
 * https://<domain>/api/webhooks/shipbubble in the Shipbubble dashboard (docs/SHIPPING.md).
 *
 * x-ship-signature must be the hex HMAC-SHA512 of the raw body under the API key (or
 * SHIPBUBBLE_WEBHOOK_SECRET), compared in constant time; anything else answers 400 and nothing is
 * stored. A verified delivery is stored once (by a hash of the body: Shipbubble sends no event id
 * and retries resend the same body) and applied: shipment status, order shipped/delivered, shopper
 * and brand notified. A failure while applying answers 500 so Shipbubble retries (every 5 minutes,
 * 5 times); it expects a 200 within 15 seconds.
 */
export const POST = route(
  { auth: "public", csrf: false, maxBody: MAX, rate: { key: "webhooks.shipbubble", limit: 600, windowSec: 60, anonGlobal: 3000 } },
  async ({ req }) => {
    const p = getCourier()
    if (!p || p.id !== "shipbubble") {
      log.once("courier-webhook-off", "warn", "[yard] Shipbubble webhook refused: YARD_SHIPPING_PROVIDER isn't shipbubble")
      return refuse(400, "unauthenticated", "Invalid signature.")
    }
    const rawBody = await req.text()
    if (rawBody.length > MAX) throw new HttpError(413, "too_large", "This request is too large.")
    if (!p.verifyWebhook(rawBody, req.headers)) {
      log.warn("[yard] Shipbubble webhook with a missing or wrong x-ship-signature was refused")
      return refuse(400, "unauthenticated", "Invalid signature.")
    }
    const r = await recordCourierWebhook(p, rawBody)
    if (r.status === "invalid") return refuse(400, "validation", "Not a Shipbubble shipment event.")
    if (r.status === "failed") return Response.json({ ok: false }, { status: 500 })
    return { ok: true, ...(r.status === "duplicate" ? { duplicate: true } : {}) }
  },
)
