import "server-only"
import { countries, countryCodes, currencies, type CountryCode, type CurrencyCode } from "@/config/markets"
import type { EstimateResponse, QuoteGroupDto, QuoteOptionDto } from "@/lib/api/contracts/shipping"
import { cities, fold } from "@/lib/around/gazetteer"
import { productById } from "@/lib/data/products"
import { refuseSampleProduct, sampleOff } from "../catalog/sample-guard"
import type { Product } from "@/lib/data/types"
import { countryTimeZone, zonedTimeToUtc } from "@/lib/data/zones"
import { convert } from "@/lib/money"
import { dateIn, isBusinessDay, localHHMM, makeCalendar, WEEKDAYS } from "@/lib/shipping/calendar"
import { estimateDelivery, groupHandling } from "@/lib/shipping/estimate"
import type { Calendar } from "@/lib/shipping/types"
import { brandListed } from "../auth/dal"
import { publicProduct } from "../catalog/public"
import { badRequest, notConfigured, notFound } from "../http/errors"
import { hmacB64url, safeEqual } from "../security/crypto"
import { keys } from "../security/keys"
import { holidaysFor, loadBrandShipping, toRef, type BrandShipping } from "./profile"
import { getProvider, type QuoteOption } from "./providers"

export const QUOTE_TTL_MS = 30 * 60_000

export const isCountry = (c: string): c is CountryCode => (countryCodes as string[]).includes(c)
export const isCurrency = (c: string): c is CurrencyCode => c in currencies
export const destTimeZone = (c: string) => (isCountry(c) ? countryTimeZone[c] : "UTC")

/**
 * The gazetteer slug of a typed city ("Lagos", "lagos", "Yaba" → "lagos"), else a plain slug of
 * the text. Used only to match a pickup point's city; it never leaves the server.
 */
export function citySlugFor(city: string | null | undefined, country: string): string | null {
  const q = city ? fold(city) : ""
  if (!q) return null
  for (const c of cities) {
    if (c.country !== country) continue
    if ([c.name, ...c.aliases].some((n) => fold(n) === q)) return c.slug
    if (c.neighbourhoods.some((h) => [h.name, ...h.aliases].some((n) => fold(n) === q))) return c.slug
  }
  return q.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || null
}

/** The handling calendar (origin workdays, holidays and brand closures) and the transit calendar (Mon–Fri, destination holidays). */
export async function calendarsFor(s: BrandShipping, dest: string): Promise<{ H: Calendar; T: Calendar }> {
  const [origin, destination] = await Promise.all([holidaysFor(s.profile.originCountry), holidaysFor(dest)])
  return {
    H: makeCalendar(s.profile.workdays, origin.map(toRef), s.closures.map((c) => ({ from: c.dateFrom, to: c.dateTo }))),
    T: makeCalendar(WEEKDAYS, destination.map(toRef)),
  }
}

export type PricedLine = { product: Product; variantId: string; qty: number }

/** A sample product, read from the bundled data only in demo and development; production never prices one. */
export const staticProduct = (id: string) => (sampleOff() ? undefined : productById.get(id))

/** The lines' static products (one brand), checked: field paths match the request body. */
export function resolveLines(lines: { productId: string; variantId?: string; qty: number }[], field: string, live?: Map<string, Product>): { brandId: string; lines: PricedLine[] } {
  const fields: Record<string, string> = {}
  const out: PricedLine[] = []
  const brandIds = new Set<string>()
  lines.forEach((l, j) => {
    const p = staticProduct(l.productId) ?? live?.get(l.productId)
    if (!p || p.status === "draft" || p.status === "archived") {
      fields[`${field}.${j}.productId`] = "That piece isn't on Yard."
      return
    }
    const variantId = l.variantId ?? p.variants[0]?.id
    if (!variantId || !p.variants.some((v) => v.id === variantId)) {
      fields[`${field}.${j}.variantId`] = "That size or colour isn't available."
      return
    }
    brandIds.add(p.brandId)
    out.push({ product: p, variantId, qty: l.qty })
  })
  if (brandIds.size > 1) fields[field] = "Each group holds one brand's pieces."
  if (Object.keys(fields).length) throw badRequest(fields)
  return { brandId: [...brandIds][0], lines: out }
}

/** Static prices: the subtotal in a currency, line by line as the cart computes it. */
export function subtotalIn(lines: PricedLine[], cur: CurrencyCode) {
  return lines.reduce((s, l) => s + convert(l.product.price, l.product.currency, cur) * l.qty, 0)
}

export type BrandQuote = {
  s: BrandShipping
  handling: [number, number]
  options: QuoteOptionDto[]
  unavailable: boolean
  reason?: string
  subtotal: { amount: number; currency: CurrencyCode }
  calendars: { H: Calendar; T: Calendar }
  cutoffAt: string | null
}

/**
 * Prices and estimates one brand's lines to a destination: the provider's options (brand
 * currency), converted to the shopper's currency, each with an estimate from the engine.
 */
export async function quoteBrand(input: { brandId: string; lines: PricedLine[]; to: CountryCode; city?: string | null; currency: CurrencyCode; now: number; releaseAtMs?: number }): Promise<BrandQuote> {
  const s = await loadBrandShipping(input.brandId)
  if (!s) throw notConfigured("Delivery estimates aren't set up for this brand yet.")
  if (!brandListed(s.brand)) throw notFound()
  const brandCur = s.profile.currency as CurrencyCode
  const subtotalBrand = subtotalIn(input.lines, brandCur)
  const provider = getProvider(s.profile.providerId)
  const raw: QuoteOption[] = await provider.quote({
    brandId: s.brand.id,
    profile: s.profile,
    zones: s.zones,
    pickup: s.pickup,
    destination: { country: input.to, citySlug: citySlugFor(input.city, input.to) },
    subtotal: { amount: subtotalBrand, currency: brandCur },
    lines: input.lines.map((l) => ({ productId: l.product.id, qty: l.qty })),
  })
  const calendars = await calendarsFor(s, input.to)
  const handling = groupHandling([s.profile.handlingMin, s.profile.handlingMax], input.lines.map((l) => ({ processingDays: l.product.processingDays })))
  const options: QuoteOptionDto[] = raw.map((o) => {
    const price = { amount: o.free ? 0 : convert(o.price.amount, o.price.currency, input.currency), currency: input.currency }
    const estimate = o.available
      ? estimateDelivery({
          handlingCal: calendars.H,
          transitCal: calendars.T,
          timeZone: s.profile.timeZone,
          destTimeZone: destTimeZone(input.to),
          cutoffLocal: s.profile.cutoffLocal,
          handling,
          transit: o.transit,
          anchor: { kind: "quote", at: input.now },
          now: input.now,
          releaseAtMs: input.releaseAtMs,
        })
      : undefined
    return {
      methodId: o.methodId,
      service: o.service,
      label: o.label,
      available: o.available,
      reason: o.reason,
      price,
      priceBrand: o.price,
      free: o.free,
      freeOver: o.freeOver ? { amount: convert(o.freeOver.amount, o.freeOver.currency, input.currency), currency: input.currency } : undefined,
      transit: o.transit,
      providerId: o.providerId,
      guaranteed: false,
      estimate,
      pickup: o.pickup,
    }
  })
  const available = options.filter((o) => o.available)
  const today = dateIn(s.profile.timeZone, input.now)
  const beforeCutoff = isBusinessDay(today, calendars.H) && localHHMM(input.now, s.profile.timeZone) < s.profile.cutoffLocal
  return {
    s,
    handling,
    options,
    unavailable: available.length === 0,
    reason: available.length ? undefined : (options[0]?.reason ?? `Doesn't ship to ${countries[input.to].name}`),
    subtotal: { amount: subtotalIn(input.lines, input.currency), currency: input.currency },
    calendars,
    cutoffAt: beforeCutoff ? new Date(zonedTimeToUtc(today, s.profile.cutoffLocal, s.profile.timeZone)).toISOString() : null,
  }
}

const brandDto = (s: BrandShipping) => ({
  id: s.brand.id,
  name: s.brand.name,
  originCity: s.profile.originCity,
  originCountry: s.profile.originCountry,
  timeZone: s.profile.timeZone,
  cutoffLocal: s.profile.cutoffLocal,
  workdays: s.profile.workdays,
})

/* ---------- GET /api/shipping/estimate ---------- */

/**
 * A product only the live catalogue knows (made in Studio): the fields the estimate reads, from
 * the public read, so its page gets the same delivery estimate as a sample piece. Null when it
 * isn't public.
 */
async function liveProduct(slugOrId: string): Promise<Product | null> {
  const live = await publicProduct(slugOrId).catch(() => null)
  if (!live) return null
  const l = live.product
  return { id: l.id, brandId: l.brandId, price: l.priceMinor, currency: l.currency, processingDays: l.processingDays ?? undefined, dropId: l.dropId ?? undefined, status: "published", variants: l.variants.map((v) => ({ id: v.id })) } as unknown as Product
}

export async function productEstimate(q: { product: string; to: string; city?: string; qty?: number; cur?: string; release?: string }): Promise<EstimateResponse> {
  // Production: a sample piece has no delivery estimate (404, never the 503 "not set up").
  refuseSampleProduct(q.product)
  const p = staticProduct(q.product) ?? (await liveProduct(q.product))
  if (!p || p.status === "draft" || p.status === "archived") throw notFound()
  if (!isCountry(q.to)) throw badRequest({ to: "Choose one of Yard's markets." })
  const currency: CurrencyCode = q.cur && isCurrency(q.cur) ? q.cur : (countries[q.to].currency as CurrencyCode)
  const now = Date.now()
  // An unreleased drop counts from its release, as this browser's drop clock reads it, within reason.
  let releaseAtMs: number | undefined
  if (q.release && p.dropId) {
    const r = Date.parse(q.release)
    if (Number.isFinite(r) && r > now && r < now + 90 * 86_400_000) releaseAtMs = r
  }
  const quote = await quoteBrand({ brandId: p.brandId, lines: [{ product: p, variantId: p.variants[0]?.id ?? "", qty: q.qty ?? 1 }], to: q.to, city: q.city, currency, now, releaseAtMs })
  return {
    brand: brandDto(quote.s),
    handling: quote.handling,
    destination: { country: q.to, city: q.city?.trim() || null },
    options: quote.options,
    unavailable: quote.unavailable,
    reason: quote.reason,
    cutoffAt: releaseAtMs ? null : quote.cutoffAt,
    calendarCountries: [...new Set([quote.s.profile.originCountry, q.to])],
    providerKind: getProvider(quote.s.profile.providerId).kind,
    computedAt: new Date(now).toISOString(),
  }
}

/* ---------- Quote tokens (keys.quote, §5.5) ---------- */

type TokenPayload = {
  v: 1
  b: string
  to: string
  c: string | null
  cur: string
  sub: number
  /** "productId:variantId:qty", sorted. */
  l: string[]
  /** The available options' prices (shopper currency), by service. */
  o: Partial<Record<"standard" | "express" | "pickup", number>>
  exp: number
}

export const lineKey = (lines: { productId: string; variantId: string; qty: number }[]) => lines.map((l) => `${l.productId}:${l.variantId}:${l.qty}`).sort()

export function signQuote(p: Omit<TokenPayload, "v">) {
  const body = Buffer.from(JSON.stringify({ v: 1, ...p })).toString("base64url")
  return `q1.${body}.${hmacB64url(keys().quote, `q1.${body}`)}`
}

/** The token's payload when its signature checks out, else null. Expiry is the caller's check. */
export function verifyQuote(token: string): TokenPayload | null {
  const parts = token.split(".")
  if (parts.length !== 3 || parts[0] !== "q1") return null
  const expected = hmacB64url(keys().quote, `q1.${parts[1]}`)
  if (!safeEqual(expected, parts[2])) return null
  try {
    const p = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as TokenPayload
    return p && p.v === 1 && typeof p.b === "string" && Array.isArray(p.l) && typeof p.exp === "number" ? p : null
  } catch {
    return null
  }
}

/* ---------- POST /api/shipping/quote ---------- */

export async function quoteGroups(body: { to: string; city?: string; currency: string; groups: { brandId: string; lines: { productId: string; variantId: string; qty: number }[] }[] }) {
  if (!isCountry(body.to)) throw badRequest({ to: "Choose one of Yard's markets." })
  if (!isCurrency(body.currency)) throw badRequest({ currency: "Choose one of Yard's currencies." })
  const to = body.to
  const currency = body.currency
  const now = Date.now()
  const exp = now + QUOTE_TTL_MS
  const seen = new Set<string>()
  // Pieces only the live catalogue knows (made in Studio) are read from it, so their bag and checkout get quotes too.
  const live = new Map<string, Product>()
  for (const id of [...new Set(body.groups.flatMap((g) => g.lines.map((l) => l.productId)).filter((id) => !staticProduct(id)))].slice(0, 100)) {
    const p = await liveProduct(id)
    if (p) live.set(id, p)
  }
  const resolved = body.groups.map((g, i) => {
    const r = resolveLines(g.lines, `groups.${i}.lines`, live)
    // The brand comes from the lines; a brandId that disagrees is refused, not trusted.
    if (r.brandId !== g.brandId) throw badRequest({ [`groups.${i}.brandId`]: "These pieces belong to another brand." })
    if (seen.has(r.brandId)) throw badRequest({ [`groups.${i}.brandId`]: "This brand is already in another group." })
    seen.add(r.brandId)
    return r
  })
  const groups: QuoteGroupDto[] = []
  for (const r of resolved) {
    const q = await quoteBrand({ brandId: r.brandId, lines: r.lines, to, city: body.city, currency, now })
    const prices: TokenPayload["o"] = {}
    for (const o of q.options) if (o.available) prices[o.service] = o.price.amount
    groups.push({
      brandId: r.brandId,
      brand: brandDto(q.s),
      handling: q.handling,
      subtotal: q.subtotal,
      options: q.options,
      unavailable: q.unavailable,
      reason: q.reason,
      quoteToken: signQuote({ b: r.brandId, to, c: citySlugFor(body.city, to), cur: currency, sub: q.subtotal.amount, l: lineKey(r.lines.map((l) => ({ productId: l.product.id, variantId: l.variantId, qty: l.qty }))), o: prices, exp }),
    })
  }
  return { groups, computedAt: new Date(now).toISOString(), expiresAt: new Date(exp).toISOString() }
}
