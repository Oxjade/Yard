import type { CountryCode, CurrencyCode } from "@/config/markets"
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
  /** Its brand isn't selling yet (a founding brand before it opens): checkout refuses the line. */
  notForSale: boolean
}

export type ShippingService = QuoteOptionDto["service"]

export type BrandGroup = {
  brand: Brand
  lines: PricedLine[]
  /** The lines that are for sale (a brand not selling yet adds nothing: checkout refuses it). */
  subtotal: number
  /** Every line of this brand is not for sale: no shipping is priced for it. */
  notForSale: boolean
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
   * The default option's numbers, for the bag sections (bag-contents) and checkout's free-shipping
   * nudge. They come from the quote alone: until it has loaded (or when it couldn't load)
   * `shippingKnown` is false and the rest are zero, and nothing shows them.
   */
  shipping: number
  freeShipping: boolean
  /** Remaining spend (shopper currency) before this brand's order ships free; 0 when no free tier applies. */
  toFreeShipping: number
  /** Business days, handling plus transit, for the default option. */
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
    const notForSale = brand.forSale === false || product.brandSummary?.forSale === false
    const priced: PricedLine = { line, product, variant, unit, total: unit * line.quantity, maxQty: notForSale ? line.quantity : Math.max(1, Math.min(10, availableStock(variant))), notForSale }
    const g =
      groups.get(brand.id) ??
      ({ brand, lines: [], subtotal: 0, notForSale: true, quote: null, options: null, unavailable: false, option: null, estimate: null, shipping: 0, freeShipping: false, toFreeShipping: 0, days: [0, 0], shippingKnown: false } satisfies BrandGroup)
    g.lines.push(priced)
    if (!notForSale) {
      g.subtotal += priced.total
      g.notForSale = false
    }
    groups.set(brand.id, g)
  }
  for (const g of groups.values()) {
    if (g.notForSale) continue
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
    }
  }
  const list = [...groups.values()]
  // Totals and shipping count only what can be bought; lines not for sale block checkout instead.
  const selling = list.filter((g) => !g.notForSale)
  const subtotal = selling.reduce((s, g) => s + g.subtotal, 0)
  const known = selling.length > 0 && selling.every((g) => g.shippingKnown)
  const shipping = known ? selling.reduce((s, g) => s + (g.option?.price.amount ?? 0), 0) : null
  const notForSale = list.flatMap((g) => g.lines.filter((l) => l.notForSale))
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
    /** Lines from brands that aren't selling yet (checkout refuses them). */
    notForSale,
    /** Why Checkout is off: a line in the cart isn't for sale (null when the cart can check out). */
    notForSaleBlock: notForSale.length ? `${notForSale[0].product.brandSummary?.name ?? list.find((g) => g.lines.includes(notForSale[0]))?.brand.name ?? "A brand in your cart"} isn't selling on Yard yet. Remove its pieces to check out.` : null,
  }
}

export type PricedCart = ReturnType<typeof priceCart>
