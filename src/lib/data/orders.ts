import type { CountryCode } from "@/config/markets"
import { convert } from "@/lib/money"
import { brands, brandById, brandCode } from "./brands"
import { dropWindow } from "@/lib/drops"
import { collections, drops } from "./catalog"
import { products, variantLabel } from "./products"
import { DEMO_TODAY, daysAgo, hash, pick, randInt, rand } from "./seed"
import type { CheckoutGroup, Customer, MerchantOrder, MerchantOrderStatus, OrderLine, Product } from "./types"

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

const emailPart = (s: string) => s.normalize("NFD").toLowerCase().replace(/[^a-z]/g, "")

/**
 * A stable pool of shoppers so merchant customer views show repeat buyers. Every name (and so
 * every email) is different: the first name cycles through FIRST, and each pass through it
 * pairs the names with a different surname.
 */
export const shoppers: ShopperProfile[] = Array.from({ length: 64 }, (_, i) => {
  const first = FIRST[i % FIRST.length]
  const last = LAST[(i * 7 + Math.floor(i / FIRST.length)) % LAST.length]
  const [city, country] = pick(`c${i}`, CITIES)
  return { id: `u_${i}`, name: `${first} ${last}`, email: `${emailPart(first)}.${emailPart(last)}@example.com`, city, country }
})

/* ---------- Addresses and carriers, by where the parcel goes ---------- */

/** A real street in a shopper city, written the way that country writes an address line, with the postcode that street has. */
type Street = { line: (n: number) => string; postcode?: string }
/** A city's streets, and the area codes its phone numbers use where the country has several. */
type CityBook = { streets: Street[]; areaCodes?: string[] }

const digits = (key: string, n: number) => String(hash(key) % 10 ** n).padStart(n, "0")

/** A GhanaPost digital address in the Greater Accra region. */
const ghanaPost = (key: string) => `GA-${digits(`${key}-a`, 3)}-${digits(`${key}-b`, 4)}`

const ADDRESS_BOOK: Record<string, CityBook> = {
  // Nigeria: no postcode in everyday use.
  Lagos: { streets: [{ line: (n) => `${n} Admiralty Way, Lekki Phase 1` }, { line: (n) => `${n} Herbert Macaulay Way, Yaba` }, { line: (n) => `${n} Awolowo Road, Ikoyi` }, { line: (n) => `${n} Allen Avenue, Ikeja` }, { line: (n) => `${n} Adeola Odeku Street, Victoria Island` }] },
  Abuja: { streets: [{ line: (n) => `${n} Aminu Kano Crescent, Wuse 2` }, { line: (n) => `${n} Gana Street, Maitama` }, { line: (n) => `${n} Ademola Adetokunbo Crescent, Wuse 2` }, { line: (n) => `${n} Kashim Ibrahim Way, Wuse` }] },
  // Ghana: the postcode is a GhanaPost digital address, set per door (see addressOf).
  Accra: { streets: [{ line: (n) => `${n} Oxford Street, Osu` }, { line: (n) => `${n} Liberation Road, Airport Residential` }, { line: (n) => `${n} Kwame Nkrumah Avenue, Adabraka` }] },
  // Kenya: the postal code of the area's post office.
  Nairobi: { streets: [{ line: (n) => `${n} Ngong Road, Kilimani`, postcode: "00505" }, { line: (n) => `${n} Waiyaki Way, Westlands`, postcode: "00800" }, { line: (n) => `${n} Kenyatta Avenue`, postcode: "00100" }] },
  "Cape Town": { streets: [{ line: (n) => `${n} Long Street`, postcode: "8001" }, { line: (n) => `${n} Kloof Street, Gardens`, postcode: "8001" }, { line: (n) => `${n} Albert Road, Woodstock`, postcode: "7925" }] },
  London: { streets: [{ line: (n) => `${n} Bethnal Green Road`, postcode: "E2 0AG" }, { line: (n) => `${n} Mare Street`, postcode: "E8 1EJ" }, { line: (n) => `${n} Kingsland Road`, postcode: "E2 8EA" }] },
  Manchester: { streets: [{ line: (n) => `${n} Oldham Street`, postcode: "M1 1JR" }, { line: (n) => `${n} Deansgate`, postcode: "M3 3EH" }, { line: (n) => `${n} Church Street`, postcode: "M4 1PW" }] },
  Paris: { streets: [{ line: (n) => `${n} rue Oberkampf`, postcode: "75011" }, { line: (n) => `${n} rue de Bretagne`, postcode: "75003" }, { line: (n) => `${n} boulevard Voltaire`, postcode: "75011" }] },
  // Germany: the number follows the street.
  Berlin: { streets: [{ line: (n) => `Oranienstraße ${n}`, postcode: "10999" }, { line: (n) => `Torstraße ${n}`, postcode: "10119" }, { line: (n) => `Weserstraße ${n}`, postcode: "12045" }] },
  "New York": { streets: [{ line: (n) => `${n} Bedford Avenue, Brooklyn`, postcode: "11211" }, { line: (n) => `${n} Orchard Street`, postcode: "10002" }, { line: (n) => `${n} Wythe Avenue, Brooklyn`, postcode: "11249" }], areaCodes: ["212", "718", "917"] },
  "Los Angeles": { streets: [{ line: (n) => `${n} Sunset Boulevard`, postcode: "90026" }, { line: (n) => `${n} Abbot Kinney Boulevard`, postcode: "90291" }, { line: (n) => `${n} North Figueroa Street`, postcode: "90042" }], areaCodes: ["213", "323", "310"] },
  "Mexico City": { streets: [{ line: (n) => `Calle Regina ${n}, Centro`, postcode: "06000" }, { line: (n) => `Calle Colima ${n}, Roma Norte`, postcode: "06700" }, { line: (n) => `Avenida Álvaro Obregón ${n}, Roma Norte`, postcode: "06700" }] },
  Seoul: { streets: [{ line: (n) => `${n} Wausan-ro, Mapo-gu`, postcode: "04043" }, { line: (n) => `${n} Gangnam-daero, Gangnam-gu`, postcode: "06232" }, { line: (n) => `${n} Itaewon-ro, Yongsan-gu`, postcode: "04348" }] },
  // Japan: block numbers, then the district.
  Tokyo: { streets: [{ line: (n) => `${(n % 6) + 1}-${(n % 23) + 1}-${(n % 9) + 2} Jingumae, Shibuya-ku`, postcode: "150-0001" }, { line: (n) => `${(n % 5) + 1}-${(n % 17) + 1}-${(n % 7) + 3} Kitazawa, Setagaya-ku`, postcode: "155-0031" }] },
}

/** A phone number in the country's own pattern ("+234 803 412 7781"). Fictional: never a real line. */
const PHONE: Record<CountryCode, (k: string, book?: CityBook) => string> = {
  NG: (k) => `+234 ${pick(k, ["803", "806", "813", "905"])} ${digits(`${k}-1`, 3)} ${digits(`${k}-2`, 4)}`,
  GH: (k) => `+233 ${pick(k, ["24", "20", "55"])} ${digits(`${k}-1`, 3)} ${digits(`${k}-2`, 4)}`,
  KE: (k) => `+254 7${digits(`${k}-0`, 2)} ${digits(`${k}-1`, 3)} ${digits(`${k}-2`, 3)}`,
  ZA: (k) => `+27 ${pick(k, ["82", "83", "72"])} ${digits(`${k}-1`, 3)} ${digits(`${k}-2`, 4)}`,
  // Ofcom's drama range.
  GB: (k) => `+44 7700 900${digits(`${k}-1`, 3)}`,
  FR: (k) => `+33 6 ${digits(`${k}-1`, 2)} ${digits(`${k}-2`, 2)} ${digits(`${k}-3`, 2)} ${digits(`${k}-4`, 2)}`,
  DE: (k) => `+49 15${digits(`${k}-0`, 1)} ${digits(`${k}-1`, 4)} ${digits(`${k}-2`, 4)}`,
  // 555-01xx: reserved for fiction. The area code is the shopper's city's.
  US: (k, book) => `+1 ${pick(k, book?.areaCodes ?? ["212"])} 555 01${digits(`${k}-1`, 2)}`,
  MX: (k) => `+52 55 ${digits(`${k}-1`, 4)} ${digits(`${k}-2`, 4)}`,
  JP: (k) => `+81 90 ${digits(`${k}-1`, 4)} ${digits(`${k}-2`, 4)}`,
  KR: (k) => `+82 10 ${digits(`${k}-1`, 4)} ${digits(`${k}-2`, 4)}`,
}

/**
 * One delivery address per shopper, so a repeat buyer's orders all go to the same door. The
 * street and its postcode are picked together, so a postcode always belongs to its street.
 */
function addressOf(customer: ShopperProfile): Omit<MerchantOrder["shippingAddress"], "name" | "country" | "city"> {
  const k = `addr-${customer.id}`
  const book = ADDRESS_BOOK[customer.city]
  const n = randInt(`${k}-n`, 2, 180)
  const street = book ? pick(`${k}-s`, book.streets) : undefined
  const postcode = street?.postcode ?? (customer.city === "Accra" ? ghanaPost(`${k}-pc`) : undefined)
  return { line1: street ? street.line(n) : `${n} High Street`, postcode, phone: PHONE[customer.country](`${k}-ph`, book) }
}

/** The carrier a brand in one country uses for a parcel within it. */
const DOMESTIC_CARRIER: Record<CountryCode, string> = {
  NG: "GIG Logistics",
  GH: "Ghana Post EMS",
  KE: "G4S Courier",
  ZA: "The Courier Guy",
  GB: "Royal Mail",
  FR: "Colissimo",
  DE: "DHL Paket",
  US: "UPS",
  MX: "Estafeta",
  JP: "Yamato Transport",
  KR: "CJ Logistics",
}

const AFRICA = new Set<CountryCode>(["NG", "GH", "KE", "ZA"])

/** Domestic parcels go with the local carrier; cross-border ones with an express courier. */
function carrierFor(from: CountryCode, to: CountryCode, key: string) {
  if (from === to) return DOMESTIC_CARRIER[from]
  return pick(key, AFRICA.has(from) || AFRICA.has(to) ? ["DHL Express", "Aramex"] : ["DHL Express", "UPS"])
}

/* ---------- What could be ordered when, and how many ---------- */

const dropById = new Map(drops.map((d) => [d.id, d]))

const HOUR = 3_600_000
/** The sample data's own "now": every sample date counts back from it. */
const demoNow = new Date(`${DEMO_TODAY}T12:00:00Z`).getTime()

/**
 * The sample sold-out drop went in four hours (its page says so): orders for its pieces fall
 * inside that window, never after it.
 */
const SELL_OUT_HOURS = 4

/**
 * Whether a piece could be ordered at an instant. A drop piece can't be ordered before its drop
 * releases (the release at its local time, on the sample data's clock), nor after a sold-out drop
 * sold out. Pieces in a restock were on sale before it, so they can. Pieces left after a drop ends
 * go back in the brand's shop.
 */
function orderableAt(p: Product, placedAt: string) {
  const d = p.dropId ? dropById.get(p.dropId) : undefined
  if (!d || p.badges.includes("restock")) return true
  const at = new Date(placedAt).getTime()
  const { release } = dropWindow(d, demoNow)
  if (at < release) return false
  return d.unitsLeft > 0 || at <= release + SELL_OUT_HOURS * HOUR
}

/** Collections of one-off pieces ("One-of-one repaired vintage"). */
const oneOffCollections = new Set(collections.filter((c) => /one[- ]of[- ]one/i.test(c.description)).map((c) => c.id))
const ONE_OFF_COPY = /\bone per size\b|\bone of (one|three)\b|\bunique\b/i

/**
 * A piece there's only one of in each size (repaired vintage, a lining woven for one coat, the
 * last pieces): never ordered two at a time.
 */
function singlePiece(p: Product) {
  return p.badges.includes("exclusive") || p.badges.includes("last-pieces") || p.collectionIds.some((id) => oneOffCollections.has(id)) || ONE_OFF_COPY.test([p.description, ...p.details].join(" "))
}

/**
 * Drop pieces each sample shopper has ordered so far, per drop (`customer|drop`). A drop's limit
 * is per customer across every piece in it and every order, as the marketplace applies it, so
 * the sample orders never add up past it.
 */
const dropUnits = new Map<string, number>()

/**
 * How many of a piece a line orders: one or two at a time, one of a single piece, and no more of
 * a drop than the shopper has left of its limit. Zero when the limit is used up.
 */
function quantityFor(p: Product, customerId: string, key: string) {
  const q = singlePiece(p) ? 1 : randInt(key, 1, 2)
  const d = p.dropId ? dropById.get(p.dropId) : undefined
  if (!d) return q
  const taken = dropUnits.get(`${customerId}|${d.id}`) ?? 0
  return Math.max(0, Math.min(q, d.limitPerCustomer - taken))
}

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
  const placedAt = daysAgo(daysBack)
  const lineCount = randInt(`${key}-lc`, 1, Math.min(3, catalogue.length))
  const line = (p: Product, i: number, quantity: number): OrderLine => {
    const v = p.variants[hash(`${key}-v${i}`) % p.variants.length]
    return { productId: p.id, variantId: v.id, name: p.name, variantLabel: variantLabel(v.options), image: p.images[0], quantity, unitPrice: p.price }
  }
  const lines: OrderLine[] = []
  // Adds a line for a piece, counting what it takes from its drop's limit; false when it can't be ordered.
  const add = (p: Product, i: number) => {
    if (lines.some((l) => l.productId === p.id) || !orderableAt(p, placedAt)) return false
    const quantity = quantityFor(p, customer.id, `${key}-q${i}`)
    if (!quantity) return false
    if (p.dropId) dropUnits.set(`${customer.id}|${p.dropId}`, (dropUnits.get(`${customer.id}|${p.dropId}`) ?? 0) + quantity)
    lines.push(line(p, i, quantity))
    return true
  }
  for (let i = 0; i < lineCount; i++) add(catalogue[(hash(`${key}-p${i}`) + i) % catalogue.length], i)
  // Every pick was a piece not on sale then (or past the shopper's drop limit): the order is for
  // something that was, starting from a stable pick and going round the catalogue.
  for (let j = 0; !lines.length && j < catalogue.length; j++) add(catalogue[(hash(`${key}-p`) + j) % catalogue.length], 0)
  const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0)
  const shipping = convert(customer.country === brand.shipsFrom ? 600 : 2400, "USD", brand.currency)
  const tax = 0
  const total = subtotal + shipping + tax
  const status = forcedStatus ?? weightedStatus(`${key}-st`)
  const tracked = ["shipped", "delivered", "refund_requested", "refunded"].includes(status)
  return {
    id: `mo_${brand.handle.replace(/-/g, "_")}_${n}`,
    reference: `${brandCode(brand)}-${String(10420 + n * 7 + (hash(brandId) % 90)).padStart(5, "0")}`,
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
    shippingAddress: { name: customer.name, city: customer.city, country: customer.country, ...addressOf(customer) },
    shippingMethod: customer.country === brand.shipsFrom ? "Standard, domestic" : "Standard, international",
    tracking: tracked ? { carrier: carrierFor(brand.shipsFrom, customer.country, `${key}-car`), number: `TRK${hash(`${key}-trk`) % 1_000_000_000}` } : undefined,
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
    reference: `YRD-${["8F2K-91", "7QX3-14", "5MD8-60"][i]}`,
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
