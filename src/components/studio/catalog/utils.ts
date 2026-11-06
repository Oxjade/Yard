import { currencies, type CurrencyCode } from "@/config/markets"
import { availableStock } from "@/lib/data/products"
import { rand } from "@/lib/data/seed"
import type { Brand, Collection, ColourValue, Drop, ImageAsset, Product } from "@/lib/data/types"

/** A product's total is "low" at or below this many available units. */
export const LOW_PRODUCT_STOCK = 5
/** A single variant is "low" at or below this many available units. */
export const LOW_VARIANT_STOCK = 3
export const MAX_IMAGES = 12
export const MAX_TAGS = 10
export const MAX_VARIANTS = 100

export function slugify(s: string) {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "")
}

/** Product ids follow the catalogue's convention: "p_" + slug, with underscores. */
export const productIdFor = (slug: string) => `p_${slug.replace(/-/g, "_")}`

/** Stable key for a combination of option values, independent of key order. */
export function optionsKey(options: Record<string, string>) {
  return Object.keys(options)
    .sort()
    .map((k) => `${k}=${options[k]}`)
    .join("|")
}

/** Every combination of sizes and colours, colours outermost, as the catalogue builds them. */
export function buildCombos(sizes: string[], colours: ColourValue[]) {
  const combos: Record<string, string>[] = []
  const colourNames: (string | null)[] = colours.length ? colours.map((c) => c.name) : [null]
  const sizeList: (string | null)[] = sizes.length ? sizes : [null]
  for (const colour of colourNames) {
    for (const size of sizeList) {
      const combo: Record<string, string> = {}
      if (size !== null) combo.Size = size
      if (colour !== null) combo.Colour = colour
      combos.push(combo)
    }
  }
  return combos
}

export function autoSku(brand: Brand, slug: string, combo: Record<string, string>) {
  const prefix = brand.mark.text.replace(/[^A-Za-z]/g, "").toUpperCase() || "SKU"
  const base = (slug || "new").replace(/-/g, "").slice(0, 6).toUpperCase()
  const code = Object.values(combo)
    .map((v) => v.replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase())
    .filter(Boolean)
    .join("-")
  return `${prefix}-${base}${code ? `-${code}` : ""}`
}

/** Minor units → the plain major-unit text a price field shows. */
export function toMajorInput(amount: number | undefined, currency: CurrencyCode) {
  if (amount === undefined) return ""
  const minor = currencies[currency].minor
  const major = amount / 10 ** minor
  return Number.isInteger(major) ? String(major) : major.toFixed(minor)
}

/** Price text in major units → integer minor units; null when it isn't a valid amount above zero. */
export function parseMoney(text: string, currency: CurrencyCode) {
  const t = text.replace(/[,\s]/g, "")
  const minor = currencies[currency].minor
  const re = minor === 0 ? /^\d+$/ : /^\d+(\.\d{1,2})?$/
  if (!re.test(t)) return null
  const n = Math.round(Number(t) * 10 ** minor)
  return n > 0 ? n : null
}

export const isWhole = (s: string) => /^\d+$/.test(s.trim())

export type StockLevel = "in" | "low" | "out"

export function variantLevel(available: number): StockLevel {
  if (available <= 0) return "out"
  if (available <= LOW_VARIANT_STOCK) return "low"
  return "in"
}

export function productLevel(available: number): StockLevel {
  if (available <= 0) return "out"
  if (available <= LOW_PRODUCT_STOCK) return "low"
  return "in"
}

/**
 * The product's 30-day sales, split across its variants with stable sample weights so the
 * per-variant numbers always add up to the product total. Sample data until orders are real.
 */
export function soldByVariant(p: Product) {
  const total = p.stats.sales30d
  const weights = p.variants.map((v) => 0.2 + rand(`${v.id}-sold`))
  const sum = weights.reduce((a, b) => a + b, 0) || 1
  const raw = weights.map((w) => (w / sum) * total)
  const floors = raw.map(Math.floor)
  let left = total - floors.reduce((a, b) => a + b, 0)
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac)
  for (const { i } of order) {
    if (left <= 0) break
    floors[i] += 1
    left -= 1
  }
  return new Map(p.variants.map((v, i) => [v.id, floors[i]]))
}

export function totalAvailable(p: Product) {
  return p.variants.reduce((n, v) => n + availableStock(v), 0)
}

/** Every photo the brand already has: product shots, collection covers, drop art and the brand cover. */
export function brandPhotos(brand: Brand, products: Product[], collections: Collection[], drops: Drop[]): ImageAsset[] {
  const seen = new Set<string>()
  const out: ImageAsset[] = []
  const add = (im: ImageAsset | undefined) => {
    if (!im || seen.has(im.src) || im.src.startsWith("blob:")) return
    seen.add(im.src)
    out.push(im)
  }
  products.forEach((p) => p.images.forEach(add))
  collections.forEach((c) => add(c.image))
  drops.forEach((d) => add(d.image))
  add(brand.cover)
  return out
}

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" })
const dateTimeFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })

export const formatDate = (iso: string) => dateFmt.format(new Date(iso))
export const formatDateTime = (iso: string) => dateTimeFmt.format(new Date(iso))

/** "Today", "Yesterday", "4 days ago", then a date. Call only after mount (it reads the clock). */
export function relativeDay(iso: string, now: number) {
  const d = Math.floor((now - new Date(iso).getTime()) / 86_400_000)
  if (d <= 0) return "Today"
  if (d === 1) return "Yesterday"
  if (d < 30) return `${d} days ago`
  return formatDate(iso)
}

/** ISO → the value a datetime-local input expects, in the viewer's time zone. */
export function toLocalInput(iso: string) {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`
