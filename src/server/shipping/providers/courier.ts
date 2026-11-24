import "server-only"
import { getEnv } from "../../env"
import { readCourierConfig, type CourierConfig } from "./courier-config"
import type { CourierProvider } from "./courier-types"
import { shipbubbleProvider } from "./shipbubble"

/**
 * The courier aggregator this deployment uses (YARD_SHIPPING_PROVIDER), or null when it's off or
 * misconfigured (env.ts reports why at boot). Read at request time; only the chosen provider's key
 * is ever sent anywhere.
 */
let cached: { sig: string; provider: CourierProvider | null } | null = null

export function courierConfig(): CourierConfig {
  const env = getEnv()
  return readCourierConfig(process.env, { dev: env.dev, allowHttp: process.env.YARD_ALLOW_HTTP === "1" }).config
}

export function getCourier(): CourierProvider | null {
  const cfg = courierConfig()
  const sig = cfg.provider === "shipbubble" && cfg.shipbubble ? `sb|${cfg.shipbubble.apiBase}|${cfg.shipbubble.apiKey}|${cfg.shipbubble.webhookSecrets.join(",")}` : "off"
  if (cached?.sig === sig) return cached.provider
  const provider = cfg.provider === "shipbubble" && cfg.shipbubble ? shipbubbleProvider(cfg.shipbubble) : null
  cached = { sig, provider }
  return provider
}

/** The startup line (once per process). */
export function courierStartupLine(): string {
  const p = getCourier()
  if (!p) return "[yard] shipping: couriers off — brands use their own rates and add tracking by hand (YARD_SHIPPING_PROVIDER=shipbubble to connect)"
  return `[yard] shipping: ${p.label}${p.sandbox ? " (SANDBOX key — no real courier is booked)" : " (live)"}`
}
