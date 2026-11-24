import "server-only"
import { CourierError, type CourierProvider } from "./courier-types"
import {
  bookingBody,
  parseBooking,
  parseRates,
  parseTracking,
  parseValidatedAddress,
  parseWallet,
  parseWebhookBody,
  pickCategory,
  ratesBody,
  ShipbubbleParseError,
  SHIPBUBBLE_SIGNATURE_HEADER,
  SHIPBUBBLE_TOKEN_TTL_MS,
  validateAddressBody,
  verifyShipbubbleSignature,
} from "./shipbubble-core"

/**
 * The Shipbubble adapter (docs/SHIPPING.md): HTTP on top of shipbubble-core's pure parsing. Every
 * call has a timeout; a 401/403 is "auth", a 4xx "refused" (definite: nothing happened), and a
 * timeout, 5xx or unreadable answer "unavailable"/"bad_response" (the call may have gone through).
 */

const TIMEOUT_MS = 12_000

export function shipbubbleProvider(cfg: { apiKey: string; apiBase: string; webhookSecrets: string[]; sandbox: boolean }): CourierProvider {
  let category: Promise<string | null> | null = null

  async function call(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    let res: Response
    try {
      res = await fetch(`${cfg.apiBase}${path}`, {
        method,
        headers: { Authorization: `Bearer ${cfg.apiKey}`, Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
        cache: "no-store",
      })
    } catch (e) {
      throw new CourierError(`Shipbubble didn't answer (${e instanceof Error && e.name === "AbortError" ? "timeout" : "network error"})`, "unavailable")
    } finally {
      clearTimeout(timer)
    }
    const text = await res.text().catch(() => "")
    let json: unknown = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = null
    }
    const message = (json && typeof json === "object" && typeof (json as { message?: unknown }).message === "string" ? ((json as { message: string }).message as string) : "").slice(0, 200)
    if (res.status === 401 || res.status === 403) throw new CourierError(`Shipbubble refused the API key (${res.status})`, "auth", res.status)
    if (res.status >= 400 && res.status < 500) throw new CourierError(message || `Shipbubble refused the request (${res.status})`, "refused", res.status)
    if (!res.ok) throw new CourierError(`Shipbubble failed (${res.status})`, "unavailable", res.status)
    if (json === null) throw new CourierError("Shipbubble's answer wasn't JSON", "bad_response", res.status)
    return json
  }

  /** Parses or maps the parse error: an answer that says "not success" is a refusal, an unreadable one is bad_response. */
  function read<T>(fn: () => T): T {
    try {
      return fn()
    } catch (e) {
      if (e instanceof ShipbubbleParseError) throw new CourierError(e.message, e.refused ? "refused" : "bad_response")
      throw e
    }
  }

  return {
    id: "shipbubble",
    label: "Shipbubble",
    sandbox: cfg.sandbox,
    tokenTtlMs: SHIPBUBBLE_TOKEN_TTL_MS,
    async validateAddress(a) {
      const json = await call("POST", "/shipping/address/validate", validateAddressBody(a))
      return read(() => parseValidatedAddress(json))
    },
    async quote(input) {
      let categoryId = input.categoryId ?? null
      if (!categoryId) {
        category ??= call("GET", "/shipping/labels/categories")
          .then((j) => read(() => pickCategory(j)))
          .catch((e) => {
            category = null
            throw e
          })
        categoryId = await category
      }
      if (!categoryId) throw new CourierError("Shipbubble listed no package categories", "bad_response")
      const json = await call(
        "POST",
        "/shipping/fetch_rates",
        ratesBody({ senderCode: input.senderCode, receiverCode: input.receiverCode, pickupDate: input.pickupDate, categoryId, items: input.parcel.items, lengthCm: input.parcel.lengthCm, widthCm: input.parcel.widthCm, heightCm: input.parcel.heightCm }),
      )
      return read(() => parseRates(json))
    },
    async book(rate) {
      const json = await call("POST", "/shipping/labels", bookingBody(rate))
      return read(() => parseBooking(json))
    },
    async track(providerOrderId) {
      const json = await call("GET", `/shipping/labels/list/${encodeURIComponent(providerOrderId)}`)
      return read(() => parseTracking(json, providerOrderId))
    },
    verifyWebhook(rawBody, headers) {
      return verifyShipbubbleSignature(rawBody, headers.get(SHIPBUBBLE_SIGNATURE_HEADER), cfg.webhookSecrets)
    },
    parseWebhook(rawBody) {
      return read(() => parseWebhookBody(rawBody))
    },
    async walletBalance() {
      const json = await call("GET", "/shipping/wallet/balance")
      return read(() => parseWallet(json))
    },
  }
}
