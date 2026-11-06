import { countries, currencies, shippingRatesUsd, type CountryCode, type CurrencyCode } from "@/config/markets"
import { site } from "@/config/site"
import { brandByHandle } from "@/lib/data/brands"
import { img } from "@/lib/data/media"
import { convert } from "@/lib/money"
import type { CategorySlug, StorefrontTemplate, StorefrontTypePreset } from "@/lib/data/types"
import type { DeliveryId, ImageRef, PayoutMethodId, SizeSystem } from "./store"

/* ---------- Storefront look ----------
 * Accents, headline type and templates come from @/components/storefront/theme, the same
 * module the live storefront renders with. Only the starting suggestions live here.
 */

export const suggestedTemplate: Record<CategorySlug, StorefrontTemplate> = {
  fashion: "editorial",
  streetwear: "street",
  sneakers: "street",
  accessories: "studio",
  beauty: "editorial",
  technology: "minimal",
  "art-design": "studio",
  jewelry: "editorial",
  "home-lifestyle": "minimal",
  creative: "studio",
}

export const suggestedType: Record<StorefrontTemplate, StorefrontTypePreset> = {
  editorial: "condensed",
  minimal: "grotesk",
  street: "condensed",
  studio: "expanded",
}

/* ---------- Photo library (sample photography for a quick start) ---------- */

function refs(list: string[], alt: string): ImageRef[] {
  return list.map((r) => {
    const a = img(r)
    return { src: a.src, alt: a.alt || alt, source: "library" as const }
  })
}

const coverRefs: Record<"fashion" | "objects" | "lifestyle", string[]> = {
  fashion: ["fashion/cover/2", "fashion/cover/6", "fashion/streetwear-editorial/0", "fashion/campaign/0", "fashion/cover/0", "fashion/streetwear-editorial/2", "fashion/campaign/2", "fashion/cover/8"],
  objects: ["objects/accessories-editorial/0", "objects/sneakers/3", "objects/jewelry/3", "objects/accessories-editorial/1", "objects/bags/2", "fashion/cover/2", "objects/sneakers/4", "fashion/cover/6"],
  lifestyle: ["lifestyle/lifestyle-cover/0", "lifestyle/lifestyle-cover/1", "lifestyle/lifestyle-cover/2", "lifestyle/lifestyle-cover/3", "lifestyle/home/4", "lifestyle/art/0", "fashion/cover/2", "lifestyle/tech/7"],
}

const groupOf = (c: CategorySlug | null): keyof typeof coverRefs =>
  c === "sneakers" || c === "accessories" || c === "jewelry" ? "objects" : c === "beauty" || c === "technology" || c === "art-design" || c === "home-lifestyle" || c === "creative" ? "lifestyle" : "fashion"

export const coverOptions = (category: CategorySlug | null) => refs(coverRefs[groupOf(category)], "Storefront cover")

const sampleRefs: Record<CategorySlug, string[]> = {
  fashion: ["fashion/tops/4", "fashion/dresses/0", "fashion/dresses/2", "fashion/tops/7", "fashion/bottoms/2", "fashion/outerwear/2", "fashion/tops/0", "fashion/dresses/1", "fashion/bottoms/0", "fashion/outerwear/3", "fashion/tops/2", "fashion/campaign/3"],
  streetwear: ["fashion/tops/1", "fashion/tops/6", "fashion/outerwear/0", "fashion/outerwear/1", "fashion/bottoms/1", "fashion/streetwear-editorial/1", "fashion/tops/3", "fashion/tops/5", "fashion/outerwear/4", "fashion/bottoms/3", "fashion/streetwear-editorial/3", "fashion/outerwear/5"],
  sneakers: ["objects/sneakers/0", "objects/sneakers/1", "objects/sneakers/2", "objects/sneakers/3", "objects/sneakers/4", "objects/sneakers/5", "objects/sneakers/6", "objects/sneakers/7", "objects/sneakers/8", "objects/sneakers/9", "objects/sneakers/10", "objects/sneakers/11"],
  accessories: ["objects/bags/0", "objects/bags/1", "objects/bags/2", "objects/headwear/0", "objects/headwear/1", "objects/eyewear/0", "objects/eyewear/1", "objects/watches/0", "objects/watches/1", "objects/bags/3", "objects/headwear/2", "objects/eyewear/2"],
  jewelry: ["objects/jewelry/0", "objects/jewelry/1", "objects/jewelry/2", "objects/jewelry/3", "objects/jewelry/4", "objects/jewelry/5", "objects/jewelry/6", "objects/jewelry/7", "objects/watches/2", "objects/accessories-editorial/2", "objects/watches/0", "objects/accessories-editorial/0"],
  beauty: ["lifestyle/beauty/0", "lifestyle/beauty/1", "lifestyle/beauty/2", "lifestyle/beauty/3", "lifestyle/beauty/4", "lifestyle/beauty/5", "lifestyle/beauty/6", "lifestyle/beauty/7"],
  technology: ["lifestyle/tech/0", "lifestyle/tech/1", "lifestyle/tech/2", "lifestyle/tech/3", "lifestyle/tech/4", "lifestyle/tech/5", "lifestyle/tech/6", "lifestyle/tech/7"],
  "art-design": ["lifestyle/art/0", "lifestyle/art/1", "lifestyle/art/2", "lifestyle/art/3", "lifestyle/art/4", "lifestyle/art/5", "lifestyle/art/6", "lifestyle/art/7"],
  "home-lifestyle": ["lifestyle/home/0", "lifestyle/home/1", "lifestyle/home/2", "lifestyle/home/3", "lifestyle/home/4", "lifestyle/home/5", "lifestyle/home/6", "lifestyle/home/7"],
  creative: ["lifestyle/creative/0", "lifestyle/creative/1", "lifestyle/creative/2", "lifestyle/creative/3", "lifestyle/art/1", "lifestyle/art/3", "lifestyle/art/5", "lifestyle/art/7"],
}

export const sampleProductPhotos = (category: CategorySlug | null) => refs(sampleRefs[category ?? "streetwear"], "Product photo")

/* ---------- Sizes ---------- */

export const sizeSystems: { id: SizeSystem; label: string; sizes: string[] }[] = [
  { id: "apparel", label: "Clothing", sizes: ["XS", "S", "M", "L", "XL"] },
  { id: "shoes", label: "Shoes (EU)", sizes: ["39", "40", "41", "42", "43", "44", "45"] },
  { id: "one", label: "One size", sizes: ["One size"] },
  { id: "custom", label: "Custom", sizes: [] },
]

export const suggestedSizeSystem = (c: CategorySlug | null): SizeSystem =>
  c === "fashion" || c === "streetwear" ? "apparel" : c === "sneakers" ? "shoes" : "one"

/* ---------- Handles ---------- */

const reserved = new Set([
  "admin", "studio", "brands", "brand", "shop", "drops", "drop", "categories", "category", "following", "wishlist", "search", "account",
  "sign-in", "signin", "sign-up", "signup", "login", "logout", "help", "support", "settings", "api", "checkout", "cart", "bag", "orders",
  "about", "terms", "privacy", site.name.toLowerCase(), "official", "stories", "collections", "products", "you", "new", "sale",
])

export type HandleStatus = "empty" | "too-short" | "too-long" | "characters" | "hyphen" | "reserved" | "taken" | "available"

export function slugify(s: string) {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
    .replace(/-+$/g, "")
}

/** The same rules the backend enforces: 3–30 characters, a–z, 0–9 and inner hyphens, not reserved, not taken. */
export function handleStatus(handle: string): HandleStatus {
  if (!handle) return "empty"
  if (handle.length < 3) return "too-short"
  if (handle.length > 30) return "too-long"
  if (!/^[a-z0-9-]+$/.test(handle)) return "characters"
  if (handle.startsWith("-") || handle.endsWith("-") || handle.includes("--")) return "hyphen"
  if (reserved.has(handle)) return "reserved"
  if (brandByHandle.has(handle)) return "taken"
  return "available"
}

export const handleMessage: Record<Exclude<HandleStatus, "available">, string> = {
  empty: "Choose a handle for your storefront address.",
  "too-short": "Use at least 3 characters.",
  "too-long": "Use 30 characters or fewer.",
  characters: "Use lowercase letters, numbers and hyphens only.",
  hyphen: "Hyphens can only sit between letters or numbers.",
  reserved: "That handle is reserved. Try another.",
  taken: "Another brand already uses that handle.",
}

export function handleSuggestions(handle: string, city?: string) {
  const base = slugify(handle).slice(0, 22) || "brand"
  const c = city ? slugify(city).slice(0, 10) : ""
  const ideas = [`${base}-studio`, c ? `${base}-${c}` : `${base}-store`, `${base}-official`, `the-${base}`, `${base}-supply`]
  return ideas.filter((h) => handleStatus(h) === "available").slice(0, 3)
}

export function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ""
  if (words.length === 1) return words[0].slice(0, 1).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

/* ---------- Payouts ---------- */

export type PayoutFormat = "nuban" | "uk" | "iban" | "aba" | "clabe" | "local" | "mobile"
export type PayoutMethod = { id: PayoutMethodId; label: string; description: string; format: PayoutFormat }

const bankFormat: Record<CountryCode, PayoutFormat> = {
  NG: "nuban", GH: "local", KE: "local", ZA: "local", GB: "uk", FR: "iban", DE: "iban", US: "aba", MX: "clabe", JP: "local", KR: "local",
}

export function payoutMethodsFor(country: CountryCode): PayoutMethod[] {
  const cur = countries[country].currency
  const list: PayoutMethod[] = [
    { id: "bank", label: `Bank account in ${countries[country].name}`, description: `Weekly payouts in ${cur}, straight to your bank.`, format: bankFormat[country] },
  ]
  if (country === "GH" || country === "KE") {
    list.push({ id: "mobile", label: "Mobile money", description: `Weekly payouts in ${cur} to your mobile money wallet.`, format: "mobile" })
  }
  return list
}

/* ---------- Delivery ---------- */

export function deliveryOptions(country: CountryCode | null, city: string, currency: CurrencyCode) {
  const rate = (zone: keyof typeof shippingRatesUsd) => ({ amount: convert(shippingRatesUsd[zone].standard, "USD", currency), days: shippingRatesUsd[zone].days })
  const place = country ? countries[country] : null
  const options: { id: DeliveryId; label: string; description: string; rate?: { amount: number; days: [number, number] } }[] = [
    { id: "domestic", label: place ? `Within ${place.name}` : "Within your country", description: "Tracked standard delivery.", rate: rate("domestic") },
    { id: "regional", label: place ? `Across ${place.region}` : "Your region", description: "Neighbouring countries, tracked.", rate: rate("regional") },
    { id: "international", label: "Worldwide", description: "Every other market we serve.", rate: rate("international") },
    { id: "pickup", label: city.trim() ? `Pickup in ${city.trim()}` : "Local pickup", description: "Free. Shoppers collect from you, and you share the address after the order." },
  ]
  return options
}

export const dialCodes: Record<CountryCode, string> = { NG: "+234", GH: "+233", KE: "+254", ZA: "+27", GB: "+44", FR: "+33", DE: "+49", US: "+1", MX: "+52", JP: "+81", KR: "+82" }

export const currencyOptions = Object.values(currencies).map((c) => ({ code: c.code as CurrencyCode, symbol: c.symbol }))
