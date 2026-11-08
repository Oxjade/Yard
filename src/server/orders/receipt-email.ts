import "server-only"
import { asc, desc, inArray } from "drizzle-orm"
import { formatShortRange } from "@/lib/shipping/format"
import type { Tx } from "../db"
import { deliveryEstimates } from "../db/schema"
import { catalogImages, catalogVariants } from "../db/schema/catalog"
import type { OrderRefRow } from "./core"
import type { OrderShipTo } from "../db/schema/orders-v3"
import { variantLabelOf } from "../catalog/dto"
import { imageSrc } from "../catalog/sellable"
import { brandName } from "./core"
import { money } from "./refunds"

/** At most this many lines per brand go into the email; the rest are counted as "+ n more". */
const LINES_PER_BRAND = 8

function countryName(code: string) {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code
  } catch {
    return code
  }
}

/** "Ada Obi, 12 Admiralty Way, Lekki, Lagos, Nigeria" (never the phone number). */
export function shipToLine(s: OrderShipTo | null | undefined) {
  if (!s) return ""
  return [s.name, s.line1, s.line2, s.city, s.region, s.postcode, s.country ? countryName(s.country) : ""]
    .map((x) => (x ?? "").trim())
    .filter(Boolean)
    .join(", ")
    .slice(0, 300)
}

/**
 * The order confirmation's `items` var (ENGAGEMENT templates.ts parseReceipt): per-brand groups
 * with line items (title, variant, qty, price, first product photo as a Yard path), each brand's
 * shipping and estimated arrival, the totals and the delivery address, as compact JSON. Best
 * effort: a lookup that fails leaves that detail out, and any error returns "" so the email falls
 * back to the plain summary instead of blocking payment.
 */
export async function receiptItemsJson(tx: Tx, orders: OrderRefRow[], shipTo: OrderShipTo | null | undefined): Promise<string> {
  try {
    if (!orders.length) return ""
    const currency = orders[0].currency
    const items = orders.flatMap((o) => o.items ?? [])
    const variantIds = [...new Set(items.map((i) => i.variantId))]
    const productIds = [...new Set(items.map((i) => i.productId))]
    const [variants, imgs, estimates] = await Promise.all([
      variantIds.length ? tx.select({ id: catalogVariants.id, options: catalogVariants.options }).from(catalogVariants).where(inArray(catalogVariants.id, variantIds)) : [],
      productIds.length
        ? tx
            .select({ productId: catalogImages.productId, mediaId: catalogImages.mediaId, path: catalogImages.path })
            .from(catalogImages)
            .where(inArray(catalogImages.productId, productIds))
            .orderBy(asc(catalogImages.productId), asc(catalogImages.position))
        : [],
      tx
        .select({ orderRefId: deliveryEstimates.orderRefId, from: deliveryEstimates.arrivalFrom, to: deliveryEstimates.arrivalTo })
        .from(deliveryEstimates)
        .where(inArray(deliveryEstimates.orderRefId, orders.map((o) => o.id)))
        .orderBy(desc(deliveryEstimates.computedAt)),
    ])
    const label = new Map(variants.map((v) => [v.id, variantLabelOf(v.options)]))
    const photo = new Map<string, string>()
    for (const i of imgs) if (!photo.has(i.productId)) photo.set(i.productId, imageSrc(i) ?? "")
    const eta = new Map<string, string>()
    for (const e of estimates) if (!eta.has(e.orderRefId) && e.from && e.to) eta.set(e.orderRefId, formatShortRange(e.from, e.to))

    const groups = []
    for (const o of orders) {
      const lines = (o.items ?? []).map((i) => {
        const variant = label.get(i.variantId) || undefined
        // Checkout stores the line as "Title — Size L"; the variant has its own line in the email.
        const title = variant && i.name.endsWith(` — ${variant}`) ? i.name.slice(0, -` — ${variant}`.length) : i.name
        return { title: title.slice(0, 120), variant, qty: i.qty, price: money(i.unitMinor * i.qty, o.currency), image: photo.get(i.productId) || undefined }
      })
      groups.push({
        brand: (await brandName(tx, o.brandId)).slice(0, 80),
        eta: eta.get(o.id),
        shipping: o.shippingMinor > 0 ? money(o.shippingMinor, o.currency) : "Free",
        lines: lines.slice(0, LINES_PER_BRAND),
        ...(lines.length > LINES_PER_BRAND ? { more: lines.length - LINES_PER_BRAND } : {}),
      })
    }
    const subtotal = orders.reduce((s, o) => s + o.subtotalMinor, 0)
    const shipping = orders.reduce((s, o) => s + o.shippingMinor, 0)
    const total = orders.reduce((s, o) => s + o.totalMinor, 0)
    const placed = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(orders[0].placedAt ?? new Date())
    const json = JSON.stringify({ placed, groups, subtotal: money(subtotal, currency), shipping: shipping > 0 ? money(shipping, currency) : "Free", total: money(total, currency), shipTo: shipToLine(shipTo) || undefined })
    return json.length <= 12_000 ? json : ""
  } catch {
    return ""
  }
}
