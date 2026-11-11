import "server-only"
import { currencies, type CountryCode, type CurrencyCode } from "@/config/markets"
import { productById } from "@/lib/data/products"
import type { Product } from "@/lib/data/types"
import { convert } from "@/lib/money"
import { getSellableVariants } from "../catalog"
import { HttpError, badRequest } from "../http/errors"
import { isCountry, isCurrency, quoteBrand, type PricedLine } from "../shipping/quote"

/**
 * Re-pricing from CATALOG (never from the client) and shipping quotes through the existing
 * shipping engine. Shared by the cart view and checkout start, so both always agree.
 */

export type Sellable = Awaited<ReturnType<typeof getSellableVariants>>[number]

export type PricedCartLine = {
  variantId: string
  productId: string | null
  brandId: string | null
  title: string | null
  variantLabel: string | null
  imagePath: string | null
  qty: number
  available: number
  /** The catalog price (brand currency). */
  unitPrice: { amountMinor: number; currency: string } | null
  /** The unit price converted to the display currency (static FX). */
  unitMinor: number
  lineMinor: number
  status: "ok" | "short" | "unavailable"
  /** Why a line is unavailable: gone from the catalogue, sold out, or the brand isn't selling yet (founding brands). */
  unavailableReason?: "gone" | "sold_out" | "not_for_sale"
  /** The brand's name when it isn't selling yet (for "{Brand} isn't selling yet"). */
  brandName?: string | null
}

export type BrandGroup = { brandId: string; lines: PricedCartLine[]; subtotalMinor: number }

export function asCurrency(c: string): CurrencyCode {
  if (!isCurrency(c)) throw badRequest({ currency: "Choose one of Yard's currencies." })
  return c
}

export function asCountry(c: string): CountryCode {
  if (!isCountry(c)) throw badRequest({ "shipTo.country": "Choose one of Yard's markets." })
  return c
}

/** Converts between Yard currencies; an unknown catalog currency is a server-side data error. */
export function toCurrency(amountMinor: number, from: string, to: CurrencyCode): number {
  if (!(from in currencies)) throw new Error(`catalog currency ${from} is not a Yard currency`)
  return convert(amountMinor, from as CurrencyCode, to)
}

/** Prices cart lines from CATALOG in `currency`. Lines the catalog no longer sells are `unavailable` and priced 0. */
export async function priceLines(lines: { variantId: string; qty: number }[], currency: CurrencyCode): Promise<PricedCartLine[]> {
  if (!lines.length) return []
  const sellable = await getSellableVariants(lines.map((l) => l.variantId))
  const byId = new Map(sellable.map((s) => [s.variantId, s]))
  return lines.map((l) => {
    const s = byId.get(l.variantId)
    if (!s) {
      return { variantId: l.variantId, productId: null, brandId: null, title: null, variantLabel: null, imagePath: null, qty: l.qty, available: 0, unitPrice: null, unitMinor: 0, lineMinor: 0, status: "unavailable" as const, unavailableReason: "gone" as const }
    }
    // A brand that isn't selling yet (founding, unclaimed or without a payout account): shown, never
    // priced, never grouped for shipping or checkout.
    if (!s.forSale) {
      return {
        variantId: s.variantId,
        productId: s.productId,
        brandId: s.brandId,
        title: s.title,
        variantLabel: s.variantLabel,
        imagePath: s.imagePath ?? null,
        qty: l.qty,
        available: 0,
        unitPrice: { amountMinor: s.priceMinor, currency: s.currency },
        unitMinor: 0,
        lineMinor: 0,
        status: "unavailable" as const,
        unavailableReason: "not_for_sale" as const,
        brandName: s.brandName,
      }
    }
    const unitMinor = toCurrency(s.priceMinor, s.currency, currency)
    return {
      variantId: s.variantId,
      productId: s.productId,
      brandId: s.brandId,
      title: s.title,
      variantLabel: s.variantLabel,
      imagePath: s.imagePath ?? null,
      qty: l.qty,
      available: s.available,
      unitPrice: { amountMinor: s.priceMinor, currency: s.currency },
      unitMinor,
      lineMinor: unitMinor * l.qty,
      status: s.available <= 0 ? ("unavailable" as const) : s.available < l.qty ? ("short" as const) : ("ok" as const),
      ...(s.available <= 0 ? { unavailableReason: "sold_out" as const } : {}),
    }
  })
}

/** Groups sellable lines by brand (unavailable lines are left out). */
export function groupByBrand(lines: PricedCartLine[]): BrandGroup[] {
  const groups = new Map<string, BrandGroup>()
  for (const l of lines) {
    if (l.status === "unavailable" || !l.brandId) continue
    const g = groups.get(l.brandId) ?? { brandId: l.brandId, lines: [], subtotalMinor: 0 }
    g.lines.push(l)
    g.subtotalMinor += l.lineMinor
    groups.set(l.brandId, g)
  }
  return [...groups.values()]
}

/**
 * The shipping engine's line shape. It reads only id, price, currency and processingDays; a
 * product created in the v3 catalog (not in the static sample data) uses the brand's handling.
 */
function engineLine(l: PricedCartLine): PricedLine {
  const known = l.productId ? productById.get(l.productId) : undefined
  const product = {
    id: l.productId ?? l.variantId,
    brandId: l.brandId ?? "",
    price: l.unitPrice?.amountMinor ?? 0,
    currency: (l.unitPrice?.currency ?? "USD") as CurrencyCode,
    processingDays: known?.processingDays,
  } as unknown as Product
  return { product, variantId: l.variantId, qty: l.qty }
}

export type ShippingOption = {
  service: "standard" | "express" | "pickup"
  label: string
  available: boolean
  reason?: string
  priceMinor: number
  currency: string
  free: boolean
  estimate?: unknown
}

export type GroupQuote = { brandId: string; brandName: string; unavailable: boolean; reason?: string; options: ShippingOption[] }

/** Quotes one brand group to a destination, prices in `currency`. A brand without shipping set up comes back unavailable. */
export async function quoteGroup(group: BrandGroup, to: CountryCode, city: string | null | undefined, currency: CurrencyCode, now = Date.now()): Promise<GroupQuote> {
  try {
    const q = await quoteBrand({ brandId: group.brandId, lines: group.lines.map(engineLine), to, city, currency, now })
    return {
      brandId: group.brandId,
      brandName: q.s.brand.name,
      unavailable: q.unavailable,
      reason: q.reason,
      options: q.options.map((o) => ({ service: o.service, label: o.label, available: o.available, reason: o.reason, priceMinor: o.price.amount, currency: o.price.currency, free: !!o.free, estimate: o.estimate })),
    }
  } catch (e) {
    if (e instanceof HttpError && (e.status === 503 || e.status === 404)) {
      return { brandId: group.brandId, brandName: "", unavailable: true, reason: e.status === 404 ? "This brand isn't selling right now." : "This brand hasn't set up delivery yet.", options: [] }
    }
    throw e
  }
}
