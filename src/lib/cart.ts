import { freeShippingThresholdUsd, shippingRatesUsd, shippingZone, type CountryCode, type CurrencyCode } from "@/config/markets"
import type { EstimateDto, QuoteGroupDto, QuoteOptionDto } from "@/lib/api/contracts/shipping"
import { brandById } from "@/lib/data/brands"
import { availableStock, variantById } from "@/lib/data/products"
import { convert } from "@/lib/money"
import type { CartLine } from "@/lib/stores/cart"
import type { Brand, Product, Variant } from "@/lib/data/types"

/**
 * Cart pricing. One checkout, one order per brand: the bag is always grouped by brand, and each
 * brand ships, charges shipping and fulfils on its own. Shipping comes only from the server's
 * quote (POST /api/shipping/quote, through useShippingQuote): without one, a group's shipping is
 * unknown (`quote: null`), and callers show a Bone while the quote loads or "Shipping is
 * calculated at checkout" when it couldn't load, never a number of their own (§6.5).
 */

export type PricedLine = {
  line: CartLine
  product: Product
  variant: Variant
  /** Unit price in the shopper's currency. */
  unit: number
  total: number
  maxQty: number
}

export type ShippingService = QuoteOptionDto["service"]

export type BrandGroup = {
  brand: Brand
  lines: PricedLine[]
  subtotal: number
  /** The server's quote for this brand, or null while it loads or when it couldn't load. */
  quote: QuoteGroupDto | null
  /** The options the brand offers to this destination (available ones only); null without a quote. */
  options: QuoteOptionDto[] | null
  /** The quote says nothing ships to this destination ("Doesn't ship to Japan"). */
  unavailable: boolean
  reason?: string
  /** The option the bag prices by default (standard, else the first available parcel option). */
  option: QuoteOptionDto | null
  /** That option's estimate. */
  estimate: EstimateDto | null
  /**
   * Legacy fields, read by the shared bag lines (bag-contents). From the quote when there is one;
   * without a quote they hold the platform's demo rates, and `shippingKnown` is false.
   */
  shipping: number
  freeShipping: boolean
  /** Remaining spend (shopper currency) before this brand's order ships free. */
  toFreeShipping: number
  days: [number, number]
  shippingKnown: boolean
}

/** The option a bag or a review shows for a brand: the chosen service when it's offered, else standard, else the first parcel option. */
export function optionFor(options: QuoteOptionDto[] | null | undefined, service?: ShippingService | null): QuoteOptionDto | null {
  if (!options) return null
  const available = options.filter((o) => o.available)
  return (service ? available.find((o) => o.service === service) : undefined) ?? available.find((o) => o.service === "standard") ?? available.find((o) => o.service !== "pickup") ?? null
}

export function priceCart(lines: CartLine[], shipTo: CountryCode, currency: CurrencyCode, quotes?: Record<string, QuoteGroupDto> | null, chosen?: (brandId: string) => ShippingService | undefined) {
  const groups = new Map<string, BrandGroup>()
  for (const line of lines) {
    const hit = variantById.get(line.variantId)
    if (!hit) continue
    const { product, variant } = hit
    const brand = brandById.get(product.brandId)!
    const unit = convert(product.price, product.currency, currency)
    const priced: PricedLine = { line, product, variant, unit, total: unit * line.quantity, maxQty: Math.max(1, Math.min(10, availableStock(variant))) }
    const g =
      groups.get(brand.id) ??
      ({ brand, lines: [], subtotal: 0, quote: null, options: null, unavailable: false, option: null, estimate: null, shipping: 0, freeShipping: false, toFreeShipping: 0, days: [0, 0], shippingKnown: false } satisfies BrandGroup)
    g.lines.push(priced)
    g.subtotal += priced.total
    groups.set(brand.id, g)
  }
  for (const g of groups.values()) {
    const q = quotes?.[g.brand.id] ?? null
    // A quote only counts for exactly these lines (a stale one would price another bag).
    const fits = !!q && q.subtotal.currency === currency && q.subtotal.amount === g.subtotal
    if (q && fits) {
      g.quote = q
      g.options = q.options.filter((o) => o.available)
      g.unavailable = q.unavailable
      g.reason = q.reason
      g.option = optionFor(q.options, chosen?.(g.brand.id))
      g.estimate = g.option?.estimate ?? null
      g.shippingKnown = !!g.option
      g.shipping = g.option?.price.amount ?? 0
      g.freeShipping = !!g.option?.free
      const over = g.option?.freeOver?.amount
      g.toFreeShipping = !g.freeShipping && over ? Math.max(0, over - g.subtotal) : 0
      g.days = g.option ? [q.handling[0] + g.option.transit[0], q.handling[1] + g.option.transit[1]] : [0, 0]
    } else {
      // Legacy values for the shared bag lines only; nothing here is shown as Yard's shipping price.
      const rate = shippingRatesUsd[shippingZone(g.brand.shipsFrom, shipTo)]
      const threshold = convert(freeShippingThresholdUsd, "USD", currency)
      g.freeShipping = g.subtotal >= threshold
      g.toFreeShipping = Math.max(0, threshold - g.subtotal)
      g.shipping = g.freeShipping ? 0 : convert(rate.standard, "USD", currency)
      g.days = [g.brand.processingDays[0] + rate.days[0], g.brand.processingDays[1] + rate.days[1]]
    }
  }
  const list = [...groups.values()]
  const subtotal = list.reduce((s, g) => s + g.subtotal, 0)
  const known = list.length > 0 && list.every((g) => g.shippingKnown)
  const shipping = known ? list.reduce((s, g) => s + (g.option?.price.amount ?? 0), 0) : null
  const count = lines.reduce((n, l) => n + l.quantity, 0)
  return {
    groups: list,
    subtotal,
    /** Null until every brand has a quote with an available option. */
    shipping,
    total: shipping === null ? null : subtotal + shipping,
    count,
    /** Brands that don't ship to this destination. */
    blocked: list.filter((g) => g.quote && g.unavailable),
  }
}

export type PricedCart = ReturnType<typeof priceCart>
