import "server-only"
import { and, desc, eq, gt, inArray, lt } from "drizzle-orm"
import type { CurrencyCode } from "@/config/markets"
import { convert } from "@/lib/money"
import { memo, invalidateMemo } from "../cache"
import { db } from "../db"
import { catalogProducts } from "../db/schema/catalog"
import { courierEvents, courierQuotes, courierSettings } from "../db/schema/courier"
import { newId } from "../ids"
import { log } from "../log"
import { COURIER_PROVIDER_PREFIX, courierOptionKey, pickupDateFor, quoteCacheKey } from "./courier-core"
import type { BrandShipping } from "./profile"
import { courierConfig, getCourier } from "./providers"
import { CourierError, type CourierAddress, type CourierProvider, type CourierRate, type Parcel } from "./providers/courier-types"
import type { QuoteOption } from "./providers/types"

/**
 * Live courier rates for one brand group (docs/SHIPPING.md). Offered only when a courier
 * aggregator is connected, the brand has a verified pickup address, it ships from a country the
 * provider serves, the checkout charges in the provider's currency (NGN) and the shopper's full
 * address is known. Anything going wrong returns no courier options: the brand's own rates stand,
 * so checkout never breaks. Prices are held for YARD_COURIER_QUOTE_MINUTES (courier_quotes), so
 * the price shown is the price charged.
 */

export type ShopperAddress = { name: string; email: string; phone: string; line1: string; city: string; region?: string; postcode?: string; country: string }

type SettingsRow = typeof courierSettings.$inferSelect

export function invalidateCourierSettings(brandId: string) {
  invalidateMemo(`courier:settings:${brandId}`)
}

export function courierSettingsFor(brandId: string): Promise<SettingsRow | null> {
  return memo(`courier:settings:${brandId}`, 30_000, async () => {
    const d = await db()
    const [row] = await d.select().from(courierSettings).where(eq(courierSettings.brandId, brandId)).limit(1)
    return row ?? null
  })
}

/** Why this brand's shoppers get no courier rates (null when they can, given an address). */
export function courierBlocker(s: Pick<BrandShipping, "profile">, settings: SettingsRow | null, provider: CourierProvider | null): string | null {
  const cfg = courierConfig()
  if (!provider) return "No courier service is connected on Yard yet."
  if (!settings) return "Add your pickup address so couriers can collect."
  if (!settings.providerAddressCode || settings.provider !== provider.id || !settings.verifiedAt) return `Your pickup address isn't verified with ${provider.label} yet. Save it again to verify it.`
  if (!cfg.originCountries.includes(s.profile.originCountry) || !cfg.originCountries.includes(settings.country)) return `${provider.label} collects in ${cfg.originCountries.join(", ")} only.`
  return null
}

/* ---------- Receiver address codes (cached a day per address) ---------- */

const receiverCodes = new Map<string, { code: string; at: number }>()
const RECEIVER_TTL = 24 * 3600_000

export const oneLineAddress = (a: { line1: string; city: string; region?: string | null; postcode?: string | null }) => [a.line1, a.city, a.region, a.postcode].map((x) => x?.trim()).filter(Boolean).join(", ")

async function receiverCode(p: CourierProvider, a: CourierAddress, fresh = false): Promise<string> {
  const key = quoteCacheKey([p.id, a.name.toLowerCase(), a.email.toLowerCase(), a.phone.replace(/\D/g, ""), a.address.toLowerCase().replace(/\s+/g, " ")])
  const hit = receiverCodes.get(key)
  if (hit && !fresh && Date.now() - hit.at < RECEIVER_TTL) return hit.code
  const v = await p.validateAddress(a)
  if (receiverCodes.size > 5000) receiverCodes.clear()
  receiverCodes.set(key, { code: v.code, at: Date.now() })
  return v.code
}

/* ---------- Parcels ---------- */

export type ParcelLine = { productId: string; qty: number; unitMinor: number; currency: string }

/** The parcel: each product's own packed weight when it has one, else the brand's default weight per piece; the brand's box size. */
export async function parcelFor(settings: SettingsRow, lines: ParcelLine[], providerCurrency: CurrencyCode): Promise<Parcel> {
  const ids = [...new Set(lines.map((l) => l.productId))]
  const d = await db()
  const rows = ids.length ? await d.select({ id: catalogProducts.id, title: catalogProducts.title, weight: catalogProducts.weightGrams }).from(catalogProducts).where(inArray(catalogProducts.id, ids)) : []
  const byId = new Map(rows.map((r) => [r.id, r]))
  return {
    items: lines.map((l) => {
      const p = byId.get(l.productId)
      const title = (p?.title ?? "Fashion item").slice(0, 100)
      return {
        name: title,
        description: title,
        unitWeightGrams: p?.weight ?? settings.parcelWeightGrams,
        unitAmountMinor: convert(l.unitMinor, l.currency as CurrencyCode, providerCurrency),
        quantity: l.qty,
      }
    }),
    lengthCm: settings.parcelLengthCm,
    widthCm: settings.parcelWidthCm,
    heightCm: settings.parcelHeightCm,
  }
}

/* ---------- Failures (Admin › Delivery) ---------- */

/** One row per kind, brand and 10 minutes at most, so a provider outage doesn't flood the log. */
export async function noteCourierFailure(provider: string, kind: "quote_failed" | "book_failed" | "track_failed" | "wallet_failed", e: unknown, ref: { brandId?: string; orderRefId?: string; shipmentId?: string } = {}) {
  const detail = (e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").slice(0, 300)
  const bucket = Math.floor(Date.now() / 600_000)
  try {
    const d = await db()
    await d
      .insert(courierEvents)
      .values({ id: newId("cev"), provider, kind, eventKey: `${kind}:${ref.orderRefId ?? ref.brandId ?? "-"}:${bucket}`, orderRefId: ref.orderRefId ?? null, shipmentId: ref.shipmentId ?? null, status: e instanceof CourierError ? e.kind : null, detail })
      .onConflictDoNothing()
  } catch (err) {
    log.warn(`[yard] couriers: couldn't record a ${kind}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/* ---------- Quotes ---------- */

export type CourierQuoteResult = { options: QuoteOption[]; atCheckout: boolean }

type StoredQuote = typeof courierQuotes.$inferSelect

/**
 * The courier options for a brand group: [] when couriers don't apply; `atCheckout` says the brand
 * ships with a courier but the address isn't known yet (the cart).
 */
export async function courierOptionsFor(input: { s: BrandShipping; lines: ParcelLine[]; address: ShopperAddress | null | undefined; currency: CurrencyCode; now: number; fallbackTransit: [number, number] }): Promise<CourierQuoteResult> {
  const provider = getCourier()
  if (!provider) return { options: [], atCheckout: false }
  const cfg = courierConfig()
  const settings = await courierSettingsFor(input.s.brand.id)
  if (courierBlocker(input.s, settings, provider) || !settings) return { options: [], atCheckout: false }
  if (input.currency !== cfg.currency) return { options: [], atCheckout: false }
  const a = input.address
  if (!a) return { options: [], atCheckout: true }
  try {
    const q = await quoteFor(provider, settings, input.s, input.lines, a, input.now)
    const rates = (q.options as CourierRate[]).filter((r) => r.currency === cfg.currency)
    const expiresAt = q.expiresAt.toISOString()
    return {
      atCheckout: true,
      options: rates.map((r) => ({
        methodId: `courier:${q.id}:${courierOptionKey(r.courierId, r.serviceCode)}`,
        key: courierOptionKey(r.courierId, r.serviceCode),
        service: "standard" as const,
        label: r.courierName,
        available: true,
        price: { amount: r.amountMinor, currency: cfg.currency },
        free: false,
        transit: r.transitDays ?? input.fallbackTransit,
        providerId: `${COURIER_PROVIDER_PREFIX}${provider.id}`,
        guaranteed: false as const,
        courier: { provider: provider.id, quoteId: q.id, courierId: r.courierId, serviceCode: r.serviceCode, name: r.courierName, image: r.courierImage, eta: r.deliveryEta, expiresAt, amountMinor: r.amountMinor, currency: cfg.currency },
      })),
    }
  } catch (e) {
    log.warn(`[yard] couriers: no live rates for ${input.s.brand.id}, using the brand's own rates: ${e instanceof Error ? e.message : String(e)}`)
    await noteCourierFailure(provider.id, "quote_failed", e, { brandId: input.s.brand.id })
    return { options: [], atCheckout: true }
  }
}

/** The receiver as the provider takes it. */
export const receiverOf = (a: ShopperAddress): CourierAddress => ({ name: a.name, email: a.email, phone: a.phone, address: oneLineAddress(a), city: a.city, state: a.region, country: a.country })

/** A fresh stored quote for the same request, else a new one from the provider (stored). */
export async function quoteFor(provider: CourierProvider, settings: SettingsRow, s: Pick<BrandShipping, "brand" | "profile">, lines: ParcelLine[], a: ShopperAddress, now: number, opts: { reuse?: boolean } = {}): Promise<StoredQuote> {
  const cfg = courierConfig()
  let receiver = await receiverCode(provider, receiverOf(a))
  const parcel = await parcelFor(settings, lines, cfg.currency)
  const pickupDate = pickupDateFor(now, s.profile.timeZone, s.profile.handlingMin)
  const keyFor = (r: string) => quoteCacheKey([provider.id, s.brand.id, settings.providerAddressCode, r, pickupDate, parcel])
  const cacheKey = keyFor(receiver)
  const d = await db()
  if (opts.reuse !== false) {
    const [fresh] = await d
      .select()
      .from(courierQuotes)
      .where(and(eq(courierQuotes.cacheKey, cacheKey), gt(courierQuotes.expiresAt, new Date(now + 60_000))))
      .orderBy(desc(courierQuotes.createdAt))
      .limit(1)
    if (fresh) return fresh
  }
  let q: Awaited<ReturnType<CourierProvider["quote"]>>
  try {
    q = await provider.quote({ senderCode: settings.providerAddressCode!, receiverCode: receiver, pickupDate, parcel })
  } catch (e) {
    // A refused rates call with a cached receiver code: validate the address again once (the code
    // may no longer be on the account) before giving up.
    if (!(e instanceof CourierError && e.kind === "refused")) throw e
    const again = await receiverCode(provider, receiverOf(a), true)
    if (again === receiver) throw e
    receiver = again
    q = await provider.quote({ senderCode: settings.providerAddressCode!, receiverCode: receiver, pickupDate, parcel })
  }
  const [row] = await d
    .insert(courierQuotes)
    .values({
      id: newId("cq"),
      brandId: s.brand.id,
      provider: provider.id,
      cacheKey: keyFor(receiver),
      requestToken: q.requestToken,
      currency: q.currency,
      options: q.rates,
      pickupDate,
      expiresAt: new Date(now + cfg.quoteTtlMs),
      tokenExpiresAt: new Date(now + provider.tokenTtlMs),
    })
    .returning()
  return row
}

/** A stored quote by id (booking reads the request token from it). */
export async function storedQuote(id: string): Promise<StoredQuote | null> {
  const d = await db()
  const [row] = await d.select().from(courierQuotes).where(eq(courierQuotes.id, id)).limit(1)
  return row ?? null
}

/** Hourly: drops quotes past the provider's token life (an order's choice keeps its own copy). */
export async function purgeOldCourierQuotes(now = Date.now()) {
  const d = await db()
  await d.delete(courierQuotes).where(lt(courierQuotes.tokenExpiresAt, new Date(now - 86_400_000)))
}
