import { freeShippingThresholdUsd, shippingRatesUsd, shippingZone, type CountryCode, type CurrencyCode } from "@/config/markets"
import { brandById } from "@/lib/data/brands"
import { availableStock, variantById } from "@/lib/data/products"
import { convert } from "@/lib/money"
import type { CartLine } from "@/lib/stores/cart"
import type { Brand, Product, Variant } from "@/lib/data/types"

/**
 * Cart pricing preview. One checkout, one order per brand: the bag is always grouped by
 * brand, and each brand ships, charges shipping and fulfils on its own. The server
 * re-prices everything at checkout; these numbers are an estimate shown to the shopper.
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

export type BrandGroup = {
  brand: Brand
  lines: PricedLine[]
  subtotal: number
  shipping: number
  freeShipping: boolean
  /** Remaining spend (shopper currency) before this brand's order ships free. */
  toFreeShipping: number
  days: [number, number]
}

export function priceCart(lines: CartLine[], shipTo: CountryCode, currency: CurrencyCode) {
  const groups = new Map<string, BrandGroup>()
  for (const line of lines) {
    const hit = variantById.get(line.variantId)
    if (!hit) continue
    const { product, variant } = hit
    const brand = brandById.get(product.brandId)!
    const unit = convert(product.price, product.currency, currency)
    const priced: PricedLine = { line, product, variant, unit, total: unit * line.quantity, maxQty: Math.max(1, Math.min(10, availableStock(variant))) }
    const g = groups.get(brand.id) ?? { brand, lines: [], subtotal: 0, shipping: 0, freeShipping: false, toFreeShipping: 0, days: [0, 0] as [number, number] }
    g.lines.push(priced)
    g.subtotal += priced.total
    groups.set(brand.id, g)
  }
  for (const g of groups.values()) {
    const zone = shippingZone(g.brand.shipsFrom, shipTo)
    const rate = shippingRatesUsd[zone]
    const threshold = convert(freeShippingThresholdUsd, "USD", currency)
    g.freeShipping = g.subtotal >= threshold
    g.toFreeShipping = Math.max(0, threshold - g.subtotal)
    g.shipping = g.freeShipping ? 0 : convert(rate.standard, "USD", currency)
    g.days = [g.brand.processingDays[0] + rate.days[0], g.brand.processingDays[1] + rate.days[1]]
  }
  const list = [...groups.values()]
  const subtotal = list.reduce((s, g) => s + g.subtotal, 0)
  const shipping = list.reduce((s, g) => s + g.shipping, 0)
  const count = lines.reduce((n, l) => n + l.quantity, 0)
  return { groups: list, subtotal, shipping, total: subtotal + shipping, count }
}
