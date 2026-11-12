import { HttpError } from "@/server/http/errors"
import { route } from "@/server/http/route"
import { log } from "@/server/log"
import { processEvent, recordProviderEvent } from "@/server/payments/events"
import { verifyBachsSignature } from "@/server/payments/providers"

const MAX = 256 * 1024

const refuse = (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status })

/**
 * POST /api/webhooks/bachs (public, no CSRF: Bachs calls it server to server). Register
 * https://<domain>/api/webhooks/bachs in the Bachs developer portal (docs/BACHS.md).
 *
 * X-Bachs-Signature-V2 ("t=…,v1=…") must be the HMAC-SHA256 of `${t}.${raw body}` under
 * BACHS_WEBHOOK_SECRET, with t within 5 minutes of now; any v1 may match (secret rotation).
 * Constant-time compare. Anything else answers 400 and nothing is stored (Bachs stops retrying a
 * 4xx), also when no secret is configured.
 *
 * A verified event is stored raw first, deduplicated by its event id (a redelivery of an event
 * already handled answers 200 and changes nothing), then processed: charge events are checked with
 * the Bachs API before anything is applied, then go through the same capture path as Paystack
 * (orders paid, stock committed, ledger posted), refund events through the same refund path. A
 * processing failure (including "Bachs doesn't report it as paid yet") answers 500 so Bachs
 * delivers it again; admins can also replay it from the payment event log.
 */
export const POST = route(
  { auth: "public", csrf: false, maxBody: MAX, rate: { key: "webhooks.bachs", limit: 600, windowSec: 60, anonGlobal: 3000 } },
  async ({ req }) => {
    const header = req.headers.get("x-bachs-signature-v2")
    if (!header || !/^t=\d{1,12}(,v1=[0-9a-fA-F]{64})+$/.test(header.replace(/\s+/g, ""))) {
      log.warn("[yard] Bachs webhook with a missing or malformed X-Bachs-Signature-V2 was refused")
      return refuse(400, "unauthenticated", "Invalid signature.")
    }
    const rawBody = await req.text()
    if (rawBody.length > MAX) throw new HttpError(413, "too_large", "This request is too large.")
    const check = verifyBachsSignature(rawBody, header)
    if (!check.ok) {
      if (check.reason === "no_secret") log.once("payments-bachs-webhook-nosecret", "warn", "[yard] Bachs webhook refused: BACHS_WEBHOOK_SECRET isn't set (or YARD_PAYMENTS isn't bachs), so nothing can be verified.")
      else log.warn(`[yard] Bachs webhook refused: signature ${check.reason}`)
      return refuse(400, "unauthenticated", "Invalid signature.")
    }
    let payload: { id?: unknown; type?: unknown; data?: Record<string, unknown> }
    try {
      payload = JSON.parse(rawBody) as typeof payload
    } catch {
      return refuse(400, "validation", "Body isn't JSON.")
    }
    if (!payload || typeof payload !== "object" || typeof payload.type !== "string" || typeof payload.id !== "string" || !/^[\w.:-]{1,120}$/.test(payload.id)) {
      return refuse(400, "validation", "Not a Bachs event.")
    }
    const ev = await recordProviderEvent({ provider: "bachs", source: "webhook", payload, rawBody, signatureValid: true })
    // A redelivery of an event already handled: nothing to do.
    if (ev.status === "processed" || ev.status === "ignored") return { ok: true, duplicate: true }
    const r = await processEvent(ev.id)
    if (r.status === "failed") return Response.json({ ok: false, eventId: ev.id }, { status: 500 })
    return { ok: true }
  },
)
