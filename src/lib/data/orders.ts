import { convert } from "@/lib/money"
import { brands, brandById } from "./brands"
import { products, variantLabel } from "./products"
import { DEMO_TODAY, daysAgo, hash, pick, randInt, rand } from "./seed"
import type { CheckoutGroup, Customer, MerchantOrder, MerchantOrderStatus, OrderLine } from "./types"

/** The signed-in shopper in the frontend prototype. */
export const demoCustomer: Customer = {
  id: "u_ada",
  name: "Ada Nwosu",
  email: "ada@example.com",
  country: "NG",
  city: "Lagos",
  joinedAt: "2026-04-02",
  interests: ["streetwear", "sneakers", "jewelry"],
  aesthetics: ["streetwear", "experimental"],
}

const FIRST = ["Chidi", "Amara", "Kofi", "Yuna", "Lucía", "Tariq", "Imani", "Soo-ah", "Elena", "Femi", "Zanele", "Jonah", "Priya", "Mateo", "Nia", "Ola", "Hana", "Sipho", "Léa", "Kenji"]
const LAST = ["Okeke", "Mensah", "Kim", "García", "Haddad", "Ndlovu", "Rossi", "Balogun", "Tanaka", "Mwangi", "Dubois", "Adeyemi", "Patel", "Novak", "Osei", "Reyes"]
const CITIES: [string, MerchantOrder["shippingAddress"]["country"]][] = [
  ["Lagos", "NG"], ["Abuja", "NG"], ["Accra", "GH"], ["Nairobi", "KE"], ["Cape Town", "ZA"], ["London", "GB"], ["Manchester", "GB"], ["Paris", "FR"], ["Berlin", "DE"], ["New York", "US"], ["Los Angeles", "US"], ["Mexico City", "MX"], ["Seoul", "KR"], ["Tokyo", "JP"],
]

export type ShopperProfile = { id: string; name: string; email: string; city: string; country: MerchantOrder["shippingAddress"]["country"] }

/** A stable pool of shoppers so merchant customer views show repeat buyers. */
export const shoppers: ShopperProfile[] = Array.from({ length: 64 }, (_, i) => {
  const first = pick(`f${i}`, FIRST)
  const last = pick(`l${i}`, LAST)
  const [city, country] = pick(`c${i}`, CITIES)
  return { id: `u_${i}`, name: `${first} ${last}`, email: `${first.toLowerCase().normalize("NFD").replace(/[^a-z]/g, "")}.${last.toLowerCase().normalize("NFD").replace(/[^a-z]/g, "")}@example.com`, city, country }
})

const STATUS_WEIGHTS: [MerchantOrderStatus, number][] = [
  ["paid", 0.16], ["processing", 0.16], ["shipped", 0.2], ["delivered", 0.36], ["cancelled", 0.04], ["refund_requested", 0.05], ["refunded", 0.03],
]

function weightedStatus(key: string): MerchantOrderStatus {
  const r = rand(key)
  let acc = 0
  for (const [s, w] of STATUS_WEIGHTS) {
    acc += w
    if (r < acc) return s
  }
  return "delivered"
}

const HOUR = 3_600_000
const demoNow = new Date(`${DEMO_TODAY}T12:00:00Z`).getTime()

/**
 * An order's history with realistic gaps (payment in minutes, processing and shipping over the
 * next days, delivery after transit), never later than the demo's "now".
 */
function timeline(status: MerchantOrderStatus, placed: string, domestic: boolean, key: string) {
  const t0 = new Date(placed).getTime()
  const at = (hours: number) => new Date(Math.min(t0 + hours * HOUR, demoNow - HOUR)).toISOString()
  const processing = 14 + randInt(`${key}-tp`, 0, 20)
  const shipped = processing + 18 + randInt(`${key}-ts`, 0, 30)
  const delivered = shipped + (domestic ? 48 : 120) + randInt(`${key}-td`, 0, 72)
  const requested = delivered + 24 + randInt(`${key}-tr`, 0, 96)
  const t = [{ at: placed, label: "Order placed" }, { at: at(0.05), label: "Payment confirmed by provider" }]
  if (["processing", "shipped", "delivered", "refund_requested", "refunded"].includes(status)) t.push({ at: at(processing), label: "Brand started processing" })
  if (["shipped", "delivered", "refund_requested", "refunded"].includes(status)) t.push({ at: at(shipped), label: "Shipped with tracking" })
  if (["delivered", "refund_requested", "refunded"].includes(status)) t.push({ at: at(delivered), label: "Delivered" })
  if (status === "refund_requested" || status === "refunded") t.push({ at: at(requested), label: "Customer requested a refund" })
  if (status === "refunded") t.push({ at: at(requested + 30), label: "Refund issued" })
  if (status === "cancelled") t.push({ at: at(4 + randInt(`${key}-tc`, 0, 10)), label: "Cancelled before fulfilment" })
  return t
}

function makeOrder(brandId: string, n: number, customer: ShopperProfile, daysBack: number, forcedStatus?: MerchantOrderStatus): MerchantOrder {
  const brand = brandById.get(brandId)!
  const catalogue = products.filter((p) => p.brandId === brandId)
  const key = `${brandId}-${n}`
  const lineCount = randInt(`${key}-lc`, 1, Math.min(3, catalogue.length))
  const lines: OrderLine[] = []
  for (let i = 0; i < lineCount; i++) {
    const p = catalogue[(hash(`${key}-p${i}`) + i) % catalogue.length]
    if (lines.some((l) => l.productId === p.id)) continue
    const v = p.variants[hash(`${key}-v${i}`) % p.variants.length]
    lines.push({ productId: p.id, variantId: v.id, name: p.name, variantLabel: variantLabel(v.options), image: p.images[0], quantity: randInt(`${key}-q${i}`, 1, 2), unitPrice: p.price })
  }
  const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0)
  const shipping = convert(customer.country === brand.shipsFrom ? 600 : 2400, "USD", brand.currency)
  const tax = 0
  const total = subtotal + shipping + tax
  const status = forcedStatus ?? weightedStatus(`${key}-st`)
  const placedAt = daysAgo(daysBack)
  const tracked = ["shipped", "delivered", "refund_requested", "refunded"].includes(status)
  return {
    id: `mo_${brand.handle.replace(/-/g, "_")}_${n}`,
    reference: `${brand.mark.text.replace(/[^A-Za-z]/g, "").toUpperCase() || "BR"}-${String(10420 + n * 7 + (hash(brandId) % 90)).padStart(5, "0")}`,
    groupId: `cg_${hash(`${key}-g`) % 100000}`,
    brandId,
    customerId: customer.id,
    status,
    paymentStatus: status === "refunded" ? "refunded" : status === "cancelled" ? "refunded" : "captured",
    currency: brand.currency,
    lines,
    subtotal,
    shipping,
    tax,
    total,
    commission: Math.round(subtotal * 0.05),
    placedAt,
    shippingAddress: { name: customer.name, line1: `${randInt(`${key}-a`, 2, 220)} ${pick(`${key}-s`, ["Admiralty Way", "High Street", "Rue Oberkampf", "Ring Road", "Gangnam-daero", "Calle Regina", "Long Street", "Bedford Ave"])}`, city: customer.city, country: customer.country, postcode: String(randInt(`${key}-pc`, 10000, 99999)), phone: `+${randInt(`${key}-ph`, 100000000, 999999999)}` },
    shippingMethod: customer.country === brand.shipsFrom ? "Standard, domestic" : "Standard, international",
    tracking: tracked ? { carrier: pick(`${key}-car`, ["GIG Logistics", "DHL Express", "Royal Mail", "UPS", "Aramex", "CJ Logistics"]), number: `TRK${hash(`${key}-trk`) % 1_000_000_000}` } : undefined,
    timeline: timeline(status, placedAt, customer.country === brand.shipsFrom, key),
  }
}

/** ~40 orders per brand over the last 90 days; newest first. */
export const merchantOrders: MerchantOrder[] = brands
  .flatMap((b) => {
    const count = b.id === "b_lagos_static" ? 64 : randInt(`${b.id}-count`, 18, 44)
    return Array.from({ length: count }, (_, n) => {
      const daysBack = Math.floor((n / count) * 90 + rand(`${b.id}-${n}-d`) * 2)
      const customer = shoppers[hash(`${b.id}-${n}-cust`) % (n % 3 === 0 ? 12 : shoppers.length)]
      const status: MerchantOrderStatus | undefined = daysBack < 2 ? (n % 2 ? "paid" : "processing") : daysBack < 6 && rand(`${b.id}-${n}-ship`) < 0.6 ? "shipped" : undefined
      return makeOrder(b.id, n, customer, daysBack, status)
    })
  })
  .sort((a, b) => b.placedAt.localeCompare(a.placedAt))

/* ---------- The demo shopper's own order history ---------- */

const adaProfile: ShopperProfile = { id: demoCustomer.id, name: demoCustomer.name, email: demoCustomer.email, city: demoCustomer.city, country: demoCustomer.country }

export const customerOrders: MerchantOrder[] = [
  { ...makeOrder("b_lagos_static", 901, adaProfile, 3, "shipped"), groupId: "cg_ada_1" },
  { ...makeOrder("b_ferro_club", 902, adaProfile, 3, "processing"), groupId: "cg_ada_1" },
  { ...makeOrder("b_null_form", 903, adaProfile, 3, "paid"), groupId: "cg_ada_1" },
  { ...makeOrder("b_halfmoon_archive", 904, adaProfile, 27, "delivered"), groupId: "cg_ada_2" },
  { ...makeOrder("b_dune_apothecary", 905, adaProfile, 27, "delivered"), groupId: "cg_ada_2" },
  { ...makeOrder("b_gridlock_supply", 906, adaProfile, 61, "refunded"), groupId: "cg_ada_3" },
]

export const customerCheckoutGroups: CheckoutGroup[] = ["cg_ada_1", "cg_ada_2", "cg_ada_3"].map((id, i) => {
  const orders = customerOrders.filter((o) => o.groupId === id)
  return {
    id,
    reference: `NCT-${["8F2K-91", "7QX3-14", "5MD8-60"][i]}`,
    customerId: demoCustomer.id,
    placedAt: orders[0].placedAt,
    currency: "NGN",
    orderIds: orders.map((o) => o.id),
    total: orders.reduce((s, o) => s + convert(o.total, o.currency, "NGN"), 0),
  }
})

/* ---------- Sample return requests ---------- */

/** The shopper's words on the sample orders that come in with a return requested. */
const SAMPLE_RETURN_REASONS = [
  { reason: "too-small", reasonLabel: "Too small", note: "The fit runs smaller than the size chart. I'd like to send it back." },
  { reason: "not-as-described", reasonLabel: "Not as described", note: "The colour is much darker than in the photos." },
  { reason: "damaged", reasonLabel: "Arrived damaged or faulty", note: "The parcel arrived torn and the print is scuffed on the back." },
  { reason: "unwanted", reasonLabel: "Changed my mind", note: "Ordered two of the same by mistake." },
] as const

/**
 * The return request on a sample order that came with one (status refund_requested or refunded,
 * but no request record): the whole order, with one reason that Studio, the Finance refund queue
 * and a decision on it all read, so the three never disagree.
 */
export function sampleReturnRequest(o: Pick<MerchantOrder, "id" | "lines" | "timeline" | "placedAt">): NonNullable<MerchantOrder["returnRequest"]> {
  const s = pick(`refund-${o.id}`, SAMPLE_RETURN_REASONS)
  const at = [...o.timeline].reverse().find((t) => /refund|return/i.test(t.label))?.at ?? o.placedAt
  return { at, reason: s.reason, reasonLabel: s.reasonLabel, note: s.note, variantIds: o.lines.map((l) => l.variantId) }
}
