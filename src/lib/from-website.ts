import { countries, currencies, type CountryCode, type CurrencyCode } from "@/config/markets"
import { cities, fold } from "@/lib/around/gazetteer"

/**
 * "Create brand from website" (Admin › Brands › Founding, docs/IMPORTER.md › Create brand from
 * website): the pure rules behind the review screen's best guesses, the duplicate warning and the
 * create plan. No server-only, so the tests and the server share them.
 */

/* ---------- handle ---------- */

/** Hosts where the shop is the first label (`<shop>.labeld.app`, `<shop>.myshopify.com`). */
const PLATFORM_HOSTS = /(^|\.)(labeld\.app|myshopify\.com|wixsite\.com|square\.site|squarespace\.com|bigcartel\.com|mystore\.ng|selar\.co|bumpa\.shop|ecwid\.com|webflow\.io|vercel\.app|netlify\.app)$/i
/** Leading labels that name a part of a site, not the brand (`shop.kachi.com`). */
const SITE_PARTS = new Set(["www", "shop", "store", "my", "app", "en", "m", "buy", "online"])
/** Second-level labels under a country code (`kachi.com.ng`, `kachi.co.uk`). */
const SECOND_LEVEL = new Set(["com", "co", "org", "net", "ltd", "plc", "gov", "edu", "ac", "or", "ne"])

/** Lowercase letters, digits and single hyphens, at most 30: the shape a Yard handle takes. */
export function slugifyHandle(s: string) {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
    .replace(/-+$/, "")
}

/** The brand's own label in a host: the shop on a platform host, else the registrable name. */
export function hostLabel(host: string): string | null {
  const labels = host.toLowerCase().replace(/\.$/, "").split(".").filter(Boolean)
  if (labels.length < 2) return null
  // On a platform host the shop is a label before the platform's own two (shop.labeld.app has none).
  if (PLATFORM_HOSTS.test(host)) return labels.slice(0, -2).filter((l) => !SITE_PARTS.has(l)).pop() ?? null
  const rest = labels.filter((l, i) => !(i === 0 && SITE_PARTS.has(l)))
  // Drop the TLD, and a second level under a country code ("com" in kachi.com.ng).
  rest.pop()
  if (rest.length > 1 && SECOND_LEVEL.has(rest[rest.length - 1])) rest.pop()
  return rest[rest.length - 1] ?? null
}

/**
 * The handle Yard suggests first: from the site's subdomain or name (813israw.labeld.app →
 * 813israw), else from the brand's name. Never shorter than Yard's 3 characters.
 */
export function suggestHandle(siteUrl: string, name: string | null | undefined): string {
  let fromHost = ""
  try {
    fromHost = slugifyHandle(hostLabel(new URL(siteUrl).hostname) ?? "")
  } catch {
    fromHost = ""
  }
  if (fromHost.length >= 3) return fromHost
  const fromName = slugifyHandle(name ?? "")
  if (fromName.length >= 3) return fromName
  return (fromHost || fromName || "brand").padEnd(3, "0").slice(0, 30)
}

/** What Yard tries when the first choice is taken, in order. */
export function handleCandidates(raw: string, max = 8): string[] {
  const base = raw.slice(0, 30).replace(/-+$/, "")
  const out = [base]
  const room = (suffix: string) => `${base.slice(0, 30 - suffix.length).replace(/-+$/, "")}${suffix}`
  for (const s of ["-studio", "-official", "-yard"]) out.push(room(s))
  for (let n = 2; out.length < max; n++) out.push(room(`-${n}`))
  return [...new Set(out)].slice(0, max)
}

/* ---------- market: country, currency, city ---------- */

const TLD_COUNTRY: Record<string, CountryCode> = { ng: "NG", gh: "GH", ke: "KE", za: "ZA", uk: "GB", fr: "FR", de: "DE", mx: "MX", jp: "JP", kr: "KR", us: "US" }

const isYardCurrency = (c: string | null | undefined): c is CurrencyCode => !!c && c in currencies
const hasWord = (text: string, word: string) => ` ${text} `.includes(` ${fold(word)} `)

/** The first Yard city named in `text` (folded, whole words), longest names first so "Port Harcourt" beats "Port". */
export function cityIn(text: string | null | undefined): { name: string; country: CountryCode } | null {
  const t = fold(text ?? "")
  if (!t) return null
  const list = [...cities].filter((c) => c.country in countries).sort((a, b) => b.name.length - a.name.length)
  for (const c of list) if (c.name.length >= 4 && hasWord(t, c.name)) return { name: c.name, country: c.country as CountryCode }
  return null
}

export function countryIn(text: string | null | undefined): CountryCode | null {
  const t = fold(text ?? "")
  if (!t) return null
  for (const [code, c] of Object.entries(countries)) if (hasWord(t, c.name)) return code as CountryCode
  return null
}

export type MarketGuess = { country: CountryCode | null; currency: CurrencyCode | null; city: string | null; why: string[] }

/**
 * Best guesses for the review screen, each with why: a Labeld shop is Nigerian (NG, NGN); the city
 * only when the site names one (Lagos when it says "Lagos State, Nigeria"); the currency the
 * products are priced in, else the country's; the country from the city, the place line, the
 * domain's country code, then the currency.
 */
export function guessMarket(input: { siteUrl: string; platform: string | null; location: string | null | undefined; productCurrencies: (string | null)[] }): MarketGuess {
  const why: string[] = []
  let host = ""
  try {
    host = new URL(input.siteUrl).hostname.toLowerCase()
  } catch {
    host = ""
  }
  const labeld = input.platform === "labeld" || /(^|\.)labeld\.app$/.test(host)
  const city = cityIn(input.location)
  const counts = new Map<CurrencyCode, number>()
  for (const c of input.productCurrencies) if (isYardCurrency(c)) counts.set(c, (counts.get(c) ?? 0) + 1)
  const priced = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

  let country: CountryCode | null = null
  if (labeld) {
    country = "NG"
    why.push("Labeld shops are Nigerian")
  } else if (city) {
    country = city.country
    why.push(`The site says ${city.name}`)
  } else if (countryIn(input.location)) {
    country = countryIn(input.location)
    why.push(`The site says ${countries[country!].name}`)
  } else if (TLD_COUNTRY[host.split(".").pop() ?? ""]) {
    country = TLD_COUNTRY[host.split(".").pop()!]
    why.push(`The address ends in .${host.split(".").pop()}`)
  } else if (priced && priced !== "EUR") {
    country = (Object.entries(countries).find(([, c]) => c.currency === priced)?.[0] as CountryCode | undefined) ?? null
    if (country) why.push(`Prices are in ${priced}`)
  }

  let currency: CurrencyCode | null = null
  if (labeld) currency = "NGN"
  else if (priced) currency = priced
  else if (country) currency = countries[country].currency as CurrencyCode
  if (currency && !labeld && priced) why.push(`Products are priced in ${priced}`)

  // A city only when it's in the guessed country (a London stockist line on a Lagos shop isn't the base).
  const cityName = city && (!country || city.country === country) ? city.name : null
  return { country, currency, city: cityName, why }
}

/* ---------- duplicates ---------- */

/** A brand name as compared: folded, letters and digits only ("Kachi Studio" = "kachi-studio" = "KACHI STUDIO"). */
export const nameKey = (s: string | null | undefined) => fold(s ?? "").replace(/[^a-z0-9]+/g, "")

/** A site as compared: host without www, lowercase (a Labeld marketplace page is mapped to the shop before this). */
export function siteKey(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "")
  } catch {
    return null
  }
}

function editDistance(a: string, b: string, cap = 3) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[b.length]
}

/**
 * Two handles that a person would take for the same brand: the same once hyphens go
 * (kachi-studio, kachistudio), one inside the other when the shorter has 5+ characters
 * (kachi, kachistudio), or one typo apart from 6 characters up.
 */
export function similarHandles(a: string, b: string): boolean {
  const x = a.toLowerCase().replace(/-/g, "")
  const y = b.toLowerCase().replace(/-/g, "")
  if (!x || !y) return false
  if (x === y) return true
  const [short, long] = x.length <= y.length ? [x, y] : [y, x]
  if (short.length >= 5 && long.includes(short)) return true
  return short.length >= 6 && editDistance(x, y, 1) <= 1
}

export type DuplicateReason = "site" | "handle" | "name"
export type DuplicateCandidate = { id: string; name: string; handle: string; founding: boolean; sites: string[] }

/** Why an existing brand looks like the one about to be created (empty: it doesn't). */
export function duplicateReasons(want: { site: string | null; handle: string; name: string | null }, b: DuplicateCandidate): DuplicateReason[] {
  const out: DuplicateReason[] = []
  const site = siteKey(want.site)
  if (site && b.sites.some((s) => siteKey(s) === site)) out.push("site")
  if (want.handle && similarHandles(want.handle, b.handle)) out.push("handle")
  const n = nameKey(want.name)
  if (n.length >= 3 && n === nameKey(b.name)) out.push("name")
  return out
}

export const DUPLICATE_LABELS: Record<DuplicateReason, string> = { site: "the same website", handle: "a similar handle", name: "the same name" }

/* ---------- the create plan (idempotent) ---------- */

export type CreateState = {
  /** The brand this request key already created, if any. */
  brand: { id: string; goLiveOnClaim: boolean; foundingBadge: boolean } | null
  import: { brandId: string | null; status: string }
  watch: { enabled: boolean } | null
}
export type CreateWish = { goLiveOnClaim: boolean; foundingBadge: boolean; watch: boolean; products: number; logo: boolean; banner: boolean }
export type CreatePlan = {
  createBrand: boolean
  attach: boolean
  patch: { goLiveOnClaim?: boolean; foundingBadge?: boolean }
  startImport: boolean
  watch: boolean
  /** Set when the scan already belongs to another brand: nothing may run. */
  conflict: string | null
}

/**
 * What "Create store" still has to do, given what's already done: a second click, a retry after a
 * timeout or a reload replays the same key and only finishes what's missing. Each step is safe
 * to repeat on its own, so a crash between two steps leaves nothing doubled.
 */
export function planCreate(state: CreateState, wish: CreateWish): CreatePlan {
  const brandId = state.brand?.id ?? null
  if (state.import.brandId && state.import.brandId !== brandId) return { createBrand: false, attach: false, patch: {}, startImport: false, watch: false, conflict: "This scan was already used to create another brand." }
  const patch: CreatePlan["patch"] = {}
  // A new founding brand starts with both on (founding.ts); only a difference is written.
  const goLive = state.brand?.goLiveOnClaim ?? true
  const badge = state.brand?.foundingBadge ?? true
  if (goLive !== wish.goLiveOnClaim) patch.goLiveOnClaim = wish.goLiveOnClaim
  if (badge !== wish.foundingBadge) patch.foundingBadge = wish.foundingBadge
  const hasWork = wish.products > 0 || wish.logo || wish.banner
  return {
    createBrand: !state.brand,
    attach: !state.import.brandId,
    patch,
    startImport: hasWork && state.import.status === "scanned",
    watch: wish.watch && !state.watch?.enabled,
    conflict: null,
  }
}
