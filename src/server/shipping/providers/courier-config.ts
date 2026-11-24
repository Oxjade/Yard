import { shipbubbleKeyKind, SHIPBUBBLE_BASE } from "./shipbubble-core"

/**
 * Courier aggregator configuration (docs/SHIPPING.md), from the environment only. No server-only
 * and no import-time parsing: env.ts runs `courierConfigProblems` at boot (every problem listed at
 * once, fatal in production like the payment keys), and the shipping code reads `courierConfig()`
 * at request time. Keys never leave the server and are never logged.
 *
 *   YARD_SHIPPING_PROVIDER      off (default) | shipbubble | topship
 *   SHIPBUBBLE_API_KEY          sb_prod_… (live) or sb_sandbox_… (test)
 *   SHIPBUBBLE_WEBHOOK_SECRET   optional: an extra key x-ship-signature is checked with (the API key, which Shipbubble signs with, always counts)
 *   SHIPBUBBLE_API_BASE         optional: default https://api.shipbubble.com/v1 (a local mock in tests)
 *   TOPSHIP_API_KEY             reserved: the Topship adapter isn't available (its API docs aren't public)
 *   YARD_COURIER_ABSORB_CAP     optional: minor units Yard absorbs silently when a re-quote costs more (default 100000 = ₦1,000)
 *   YARD_COURIER_WALLET_LOW     optional: alert Admin under this wallet balance, minor units (default 2000000 = ₦20,000)
 *   YARD_COURIER_QUOTE_MINUTES  optional: how long a shopper's courier price is held (default 30, 5–120)
 */

export type CourierConfig = {
  provider: "off" | "shipbubble"
  shipbubble: { apiKey: string; webhookSecrets: string[]; apiBase: string; sandbox: boolean } | null
  absorbCapMinor: number
  walletLowMinor: number
  quoteTtlMs: number
  /** The currency the provider prices and charges in (Shipbubble: NGN). Courier rates are offered only in it. */
  currency: "NGN"
  /** Countries a brand can ship from with this provider (Shipbubble serves the account's country of origin only). */
  originCountries: string[]
}

type Env = Record<string, string | undefined>
const blank = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined)

function intIn(env: Env, name: string, def: number, min: number, max: number, problems: string[]) {
  const v = blank(env[name])
  if (v === undefined) return def
  const n = Number(v)
  if (!Number.isInteger(n) || n < min || n > max) {
    problems.push(`${name} must be a whole number from ${min} to ${max}`)
    return def
  }
  return n
}

/** Every problem with the courier settings, for the boot check. `ctx.dev` relaxes https for a local mock. */
export function courierConfigProblems(env: Env, ctx: { dev: boolean; allowHttp?: boolean }): string[] {
  return readCourierConfig(env, ctx).problems
}

export function readCourierConfig(env: Env, ctx: { dev: boolean; allowHttp?: boolean }): { config: CourierConfig; problems: string[] } {
  const problems: string[] = []
  const raw = (blank(env.YARD_SHIPPING_PROVIDER) ?? "off").toLowerCase()
  const absorbCapMinor = intIn(env, "YARD_COURIER_ABSORB_CAP", 100_000, 0, 100_000_000, problems)
  const walletLowMinor = intIn(env, "YARD_COURIER_WALLET_LOW", 2_000_000, 0, 10_000_000_000, problems)
  const quoteTtlMs = intIn(env, "YARD_COURIER_QUOTE_MINUTES", 30, 5, 120, problems) * 60_000
  const base: CourierConfig = { provider: "off", shipbubble: null, absorbCapMinor, walletLowMinor, quoteTtlMs, currency: "NGN", originCountries: ["NG"] }

  if (raw !== "off" && raw !== "shipbubble" && raw !== "topship") {
    problems.push("YARD_SHIPPING_PROVIDER must be off, shipbubble or topship")
    return { config: base, problems }
  }
  if (raw === "topship") {
    problems.push("YARD_SHIPPING_PROVIDER=topship isn't available: Topship's API documentation isn't public, so there is no Topship adapter yet (docs/SHIPPING.md). Use shipbubble or off")
    return { config: base, problems }
  }
  if (raw === "off") return { config: base, problems }

  const key = blank(env.SHIPBUBBLE_API_KEY)
  const kind = key ? shipbubbleKeyKind(key) : null
  if (!key) problems.push("YARD_SHIPPING_PROVIDER=shipbubble needs SHIPBUBBLE_API_KEY (sb_prod_… for real bookings, sb_sandbox_… for tests)")
  else if (!kind) problems.push("SHIPBUBBLE_API_KEY must be a Shipbubble API key (sb_prod_… or sb_sandbox_…)")
  let apiBase = SHIPBUBBLE_BASE
  const baseRaw = blank(env.SHIPBUBBLE_API_BASE)
  if (baseRaw) {
    try {
      const u = new URL(baseRaw)
      if (u.protocol !== "https:" && !(u.protocol === "http:" && (ctx.dev || ctx.allowHttp))) problems.push("SHIPBUBBLE_API_BASE must start with https://")
      else apiBase = u.toString().replace(/\/+$/, "")
    } catch {
      problems.push("SHIPBUBBLE_API_BASE must be a URL (default https://api.shipbubble.com/v1)")
    }
  }
  const hook = blank(env.SHIPBUBBLE_WEBHOOK_SECRET)
  if (hook && hook.length < 16) problems.push("SHIPBUBBLE_WEBHOOK_SECRET must be at least 16 characters (or leave it unset: Shipbubble signs webhooks with the API key)")
  if (problems.length || !key || !kind) return { config: base, problems }
  return {
    config: { ...base, provider: "shipbubble", shipbubble: { apiKey: key, webhookSecrets: [...new Set([hook, key].filter((x): x is string => !!x))], apiBase, sandbox: kind === "sandbox" } },
    problems,
  }
}
