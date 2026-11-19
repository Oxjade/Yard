import { currencies, type CurrencyCode } from "@/config/markets"
import { ONE_SIZE, type ImportBrandContextDto, type ImportChoiceBody, type ImportProductDto } from "@/lib/api/contracts/imports"
import { convert, toMajor, toMinor } from "@/lib/money"

/**
 * The Import from website preview's own rules (docs/IMPORTER.md), shared by the admin page and its
 * tests: one editable draft per scanned product, the stock labels it shows, what it sends to
 * /api/admin/brand-imports/{id}/import, and the problems that keep a ticked product from importing.
 */

export type ImportDraft = {
  on: boolean
  title: string
  /** Major units as typed ("17000", "25.50"). */
  price: string
  currency: string
  categorySlug: string
  subcategory: string | null
  /** Comma-separated sizes, editable when the product has no option other than Size. */
  sizes: string
  /** Opening stock per variant label, as typed. */
  stock: Record<string, string>
  /** The price was converted from the site's currency at Yard's reference rate. */
  convertedFrom: string | null
}

const isYard = (c: string | null | undefined): c is CurrencyCode => !!c && c in currencies

/** Whether the admin edits sizes as a list (only a Size option, or none). */
export const sizesEditable = (p: Pick<ImportProductDto, "options">) => p.options.every((o) => o.name === "Size")

const majorString = (minor: number, currency: string) => {
  const n = isYard(currency) ? toMajor(minor, currency) : minor / 100
  return Number.isInteger(n) ? String(n) : n.toFixed(isYard(currency) ? currencies[currency].minor : 2)
}

export function splitSizes(s: string) {
  const out: string[] = []
  for (const part of s.split(/[,\n]/)) {
    const v = part.trim().slice(0, 40)
    if (v && !out.some((x) => x.toLowerCase() === v.toLowerCase())) out.push(v)
  }
  return out
}

/** The variant labels the stock inputs are keyed by, in order. */
export function stockLabels(p: Pick<ImportProductDto, "options" | "variants">, d: Pick<ImportDraft, "sizes">) {
  if (sizesEditable(p)) {
    const sizes = splitSizes(d.sizes).filter((s) => s.toLowerCase() !== ONE_SIZE.toLowerCase())
    return sizes.length ? sizes : [ONE_SIZE]
  }
  const order = p.options.map((o) => o.name)
  return p.variants.map((v) => order.map((n) => v.options[n]).filter(Boolean).join(" / ") || ONE_SIZE)
}

/** The draft a scanned product starts as: ticked unless it looks like a duplicate or has no price. */
export function draftOf(p: ImportProductDto, brand: Pick<ImportBrandContextDto, "currency" | "category">, categories: { slug: string }[]): ImportDraft {
  const currency = isYard(p.currency) ? p.currency : brand.currency
  const order = p.options.map((o) => o.name)
  const stock: Record<string, string> = {}
  for (const v of p.variants) {
    const label = order.map((n) => v.options[n]).filter(Boolean).join(" / ") || ONE_SIZE
    stock[label] = v.stock == null ? "" : String(v.stock)
  }
  const categorySlug = p.categorySlug ?? brand.category ?? categories[0]?.slug ?? ""
  return {
    on: !p.duplicate && p.priceMinor != null,
    title: p.title.slice(0, 120),
    price: p.priceMinor != null ? majorString(p.priceMinor, currency) : "",
    currency,
    categorySlug,
    subcategory: p.categorySlug === categorySlug ? p.subcategory : null,
    sizes: (p.options.find((o) => o.name === "Size")?.values ?? []).map((v) => v.value).join(", "),
    stock,
    convertedFrom: null,
  }
}

/** Switching the currency converts the typed price at Yard's reference rate (and says so). */
export function withCurrency(d: ImportDraft, next: string): ImportDraft {
  if (next === d.currency) return d
  const n = Number(d.price)
  if (!isYard(d.currency) || !isYard(next) || !d.price.trim() || !Number.isFinite(n) || n <= 0) return { ...d, currency: next, convertedFrom: null }
  const minor = convert(toMinor(n, d.currency), d.currency, next)
  return { ...d, currency: next, price: majorString(minor, next), convertedFrom: d.convertedFrom ?? d.currency }
}

export type DraftProblems = Partial<Record<"title" | "price" | "currency" | "categorySlug" | "stock", string>>

export function draftProblems(d: ImportDraft, brand: Pick<ImportBrandContextDto, "currency" | "name">): DraftProblems {
  const out: DraftProblems = {}
  if (d.title.trim().length < 2) out.title = "Name the product."
  const n = Number(d.price)
  if (!d.price.trim() || !Number.isFinite(n) || n <= 0) out.price = "Enter a price above zero."
  if (d.currency !== brand.currency) out.currency = `${brand.name} sells in ${brand.currency}. Switch to ${brand.currency} to convert the price.`
  if (!d.categorySlug) out.categorySlug = "Choose a category."
  if (Object.values(d.stock).some((s) => s.trim() && (!/^\d+$/.test(s.trim()) || Number(s) > 1_000_000))) out.stock = "Use whole numbers for stock."
  return out
}

/** What the import request carries for one ticked product. */
export function choiceOf(p: ImportProductDto, d: ImportDraft): ImportChoiceBody {
  const labels = stockLabels(p, d)
  const stock: Record<string, number> = {}
  for (const l of labels) {
    const s = (d.stock[l] ?? "").trim()
    if (/^\d+$/.test(s)) stock[l] = Number(s)
  }
  return {
    key: p.key,
    title: d.title.trim(),
    priceMinor: isYard(d.currency) ? toMinor(Number(d.price), d.currency) : Math.round(Number(d.price) * 100),
    currency: d.currency,
    categorySlug: d.categorySlug,
    subcategory: d.subcategory,
    ...(sizesEditable(p) ? { sizes: splitSizes(d.sizes).filter((s) => s.toLowerCase() !== ONE_SIZE.toLowerCase()) } : {}),
    stock,
    // Ticking a product flagged as a duplicate is the admin choosing to import it anyway.
    allowDuplicate: !!p.duplicate,
  }
}
