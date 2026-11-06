import { currencies } from "@/config/markets"
import type { Brand, CategorySlug, ColourValue, ImageAsset, Product, ProductOption, ProductStatus, Variant } from "@/lib/data/types"
import { variantLabel } from "@/lib/data/products"
import { toFormImages, type FormImage } from "./image-manager"
import type { ProductMeta } from "./store"
import { autoSku, buildCombos, isWhole, MAX_VARIANTS, optionsKey, parseMoney, productIdFor, slugify, toLocalInput, toMajorInput } from "./utils"

export type FormColour = { key: string; name: string; hex: string }
export type FormVariant = {
  key: string
  id?: string
  options: Record<string, string>
  sku: string
  /** True while the SKU still follows the generated pattern; editing it by hand turns this off. */
  skuAuto: boolean
  stock: string
  reserved: number
  /** On-hand units when the form opened, so a change can be logged as an adjustment. */
  originalStock?: number
}

export type ProductForm = {
  name: string
  description: string
  category: CategorySlug | ""
  subcategory: string
  tags: string[]
  images: FormImage[]
  price: string
  compareAt: string
  hasSizes: boolean
  sizes: string[]
  hasColours: boolean
  colours: FormColour[]
  variants: FormVariant[]
  collectionIds: string[]
  processingMin: string
  processingMax: string
  status: ProductStatus
  /** datetime-local value, in the viewer's time zone */
  publishAt: string
}

export type Errors = Record<string, string | undefined>

let colourSeq = 0
export const colourKey = () => `col-${++colourSeq}`

export function fromProduct(p: Product, meta: ProductMeta | undefined, brand: Brand): ProductForm {
  const sizeOpt = p.options.find((o): o is Extract<ProductOption, { name: "Size" }> => o.name === "Size")
  const colourOpt = p.options.find((o): o is Extract<ProductOption, { name: "Colour" }> => o.name === "Colour")
  const days = meta?.processingDays ?? brand.processingDays
  return {
    name: p.name,
    description: p.description,
    category: p.category,
    subcategory: p.subcategory,
    tags: [...p.tags],
    images: toFormImages(p.images),
    price: toMajorInput(p.price, brand.currency),
    compareAt: toMajorInput(p.compareAt, brand.currency),
    hasSizes: !!sizeOpt,
    sizes: sizeOpt ? [...sizeOpt.values] : [],
    hasColours: !!colourOpt,
    colours: colourOpt ? colourOpt.values.map((c) => ({ key: colourKey(), name: c.name, hex: c.hex })) : [],
    variants: p.variants.map((v) => ({ key: optionsKey(v.options), id: v.id, options: v.options, sku: v.sku, skuAuto: false, stock: String(v.stock), reserved: v.reserved, originalStock: v.stock })),
    collectionIds: [...p.collectionIds],
    processingMin: String(days[0]),
    processingMax: String(days[1]),
    status: p.status,
    publishAt: meta?.publishAt ? toLocalInput(meta.publishAt) : "",
  }
}

export function emptyForm(brand: Brand): ProductForm {
  return {
    name: "",
    description: "",
    category: brand.categories[0] ?? "",
    subcategory: "",
    tags: [],
    images: [],
    price: "",
    compareAt: "",
    hasSizes: false,
    sizes: [],
    hasColours: false,
    colours: [],
    variants: [{ key: "", options: {}, sku: autoSku(brand, "", {}), skuAuto: true, stock: "0", reserved: 0 }],
    collectionIds: [],
    processingMin: String(brand.processingDays[0]),
    processingMax: String(brand.processingDays[1]),
    status: "draft",
    publishAt: "",
  }
}

/** What counts as a change: everything a save would write, nothing about UI bookkeeping. */
export function snapshot(f: ProductForm) {
  return JSON.stringify({
    ...f,
    images: f.images.map((im) => im.src),
    colours: f.colours.map((c) => [c.name, c.hex]),
    variants: f.variants.map((v) => [v.key, v.sku, v.stock]),
  })
}

export const activeColours = (f: ProductForm): ColourValue[] => (f.hasColours ? f.colours.filter((c) => c.name.trim()).map((c) => ({ name: c.name.trim(), hex: c.hex })) : [])
export const activeSizes = (f: ProductForm) => (f.hasSizes ? f.sizes : [])

/**
 * Rebuilds the variant matrix after the options change. Rows that still exist keep their
 * SKU and stock; rows that come back (an option turned off and on again) are restored from
 * `pool`, the variants the product had when the form opened.
 */
export function withVariants(f: ProductForm, brand: Brand, slug: string, pool: Map<string, FormVariant>): ProductForm {
  const combos = buildCombos(activeSizes(f), activeColours(f))
  if (combos.length > MAX_VARIANTS) return f
  const current = new Map(f.variants.map((v) => [v.key, v]))
  const variants = combos.map((combo) => {
    const key = optionsKey(combo)
    const prev = current.get(key) ?? pool.get(key)
    if (prev) return { ...prev, options: combo, sku: prev.skuAuto ? autoSku(brand, slug, combo) : prev.sku }
    return { key, options: combo, sku: autoSku(brand, slug, combo), skuAuto: true, stock: "0", reserved: 0 }
  })
  return { ...f, variants }
}

export function variantCount(f: ProductForm) {
  return Math.max(1, activeSizes(f).length || 1) * Math.max(1, activeColours(f).length || 1)
}

export type ValidateContext = {
  brand: Brand
  /** SKUs used by the brand's other products, upper-cased. */
  otherSkus: Set<string>
  /** The product's variants when the form opened (empty for a new product). */
  original: Variant[]
  now: number
}

export function validate(f: ProductForm, ctx: ValidateContext): Errors {
  const { brand } = ctx
  const currency = brand.currency
  const minor = currencies[currency].minor
  const e: Errors = {}

  const name = f.name.trim()
  if (name.length < 2) e.name = "Enter a product name."
  else if (name.length > 80) e.name = "Keep the name to 80 characters or fewer."

  const desc = f.description.trim()
  if (desc.length < 20) e.description = "Describe it in at least 20 characters: what it is, what it's made of, how it fits."
  else if (desc.length > 2000) e.description = "Keep the description to 2,000 characters or fewer."

  if (!f.category) e.category = "Choose a category."
  if (!f.subcategory) e.subcategory = "Choose a subcategory."

  if (f.images.length === 0) e.photos = "Add at least one photo. The first one is the cover."

  const priceText = f.price.replace(/[,\s]/g, "")
  const price = parseMoney(f.price, currency)
  if (!priceText) e.price = "Enter a price."
  else if (minor === 0 && priceText.includes(".")) e.price = `Use a whole number for ${currency}.`
  else if (price === null) e.price = "Enter a price above zero, with up to 2 decimal places."

  if (f.compareAt.trim()) {
    const compare = parseMoney(f.compareAt, currency)
    if (compare === null) e.compareAt = "Enter an amount above zero, or leave it empty."
    else if (price !== null && compare <= price) e.compareAt = "The compare-at price must be higher than the price."
  }

  if (f.hasSizes && f.sizes.length === 0) e.sizes = "Add at least one size, or turn sizes off."
  if (f.hasColours) {
    if (f.colours.length === 0) e.colours = "Add at least one colour, or turn colours off."
    const seen = new Set<string>()
    for (const c of f.colours) {
      const n = c.name.trim().toLowerCase()
      if (!n) e[`colour-${c.key}-name`] = "Name this colour."
      else if (seen.has(n)) e[`colour-${c.key}-name`] = "Each colour needs its own name."
      seen.add(n)
      if (!/^#[0-9a-f]{6}$/i.test(c.hex.trim())) e[`colour-${c.key}-hex`] = "Use a hex value like #1A1A1A."
    }
  }

  const count = variantCount(f)
  if (count > MAX_VARIANTS) e.variants = `That makes ${count} variants. Keep it to ${MAX_VARIANTS} or fewer, or list colourways as separate products.`

  const kept = new Set(f.variants.map((v) => v.id).filter(Boolean))
  const lost = ctx.original.find((v) => v.reserved > 0 && !kept.has(v.id))
  if (lost && !e.variants) e.variants = `${variantLabel(lost.options) || "The default variant"} has ${lost.reserved} reserved for open orders, so it can't be removed yet.`

  const skus = new Map<string, number>()
  for (const v of f.variants) skus.set(v.sku.trim().toUpperCase(), (skus.get(v.sku.trim().toUpperCase()) ?? 0) + 1)
  for (const v of f.variants) {
    const sku = v.sku.trim()
    if (!sku) e[`sku-${v.key}`] = "Enter a SKU."
    else if (sku.length > 40) e[`sku-${v.key}`] = "Keep SKUs to 40 characters or fewer."
    else if (!/^[A-Za-z0-9._-]+$/.test(sku)) e[`sku-${v.key}`] = "Use letters, numbers, dashes, dots or underscores."
    else if ((skus.get(sku.toUpperCase()) ?? 0) > 1) e[`sku-${v.key}`] = "Each variant needs its own SKU."
    else if (ctx.otherSkus.has(sku.toUpperCase())) e[`sku-${v.key}`] = "Another of your products uses this SKU."

    if (!isWhole(v.stock)) e[`stock-${v.key}`] = "Enter a whole number, 0 or more."
    else if (Number(v.stock) > 99_999) e[`stock-${v.key}`] = "That's more than 99,999. Check the number."
    else if (Number(v.stock) < v.reserved) e[`stock-${v.key}`] = `At least ${v.reserved}: that many are reserved for open orders.`
  }

  if (!isWhole(f.processingMin) || !isWhole(f.processingMax)) e.processing = "Use whole days, for example 1 to 3."
  else if (Number(f.processingMin) < 1) e.processing = "The shortest time is 1 day."
  else if (Number(f.processingMax) > 60) e.processing = "Keep it to 60 days or fewer."
  else if (Number(f.processingMin) > Number(f.processingMax)) e.processing = "The first number can't be more than the second."

  if (f.status === "scheduled") {
    const t = f.publishAt ? new Date(f.publishAt).getTime() : NaN
    if (!f.publishAt) e.publishAt = "Choose when it goes live."
    else if (Number.isNaN(t)) e.publishAt = "Enter a valid date and time."
    else if (t <= ctx.now) e.publishAt = "Choose a time in the future."
  }

  return e
}

/** Field key → where it lives on the page and what to call it in the error summary. */
export function errorTargets(f: ProductForm): { key: string; label: string; target: string }[] {
  const base = [
    { key: "name", label: "Name", target: "pf-name" },
    { key: "description", label: "Description", target: "pf-description" },
    { key: "photos", label: "Photos", target: "photos" },
    { key: "price", label: "Price", target: "pf-price" },
    { key: "compareAt", label: "Compare-at price", target: "pf-compare" },
    { key: "sizes", label: "Sizes", target: "pf-sizes" },
    { key: "colours", label: "Colours", target: "pf-add-colour" },
    ...f.colours.flatMap((c, i) => [
      { key: `colour-${c.key}-name`, label: `Colour ${i + 1} name`, target: `pf-colour-${c.key}-name` },
      { key: `colour-${c.key}-hex`, label: `Colour ${i + 1} hex`, target: `pf-colour-${c.key}-hex` },
    ]),
    { key: "variants", label: "Variants", target: "variants-panel" },
    ...f.variants.flatMap((v) => {
      const label = variantLabel(v.options) || "Default variant"
      return [
        { key: `sku-${v.key}`, label: `SKU, ${label}`, target: `pf-sku-${v.key}` },
        { key: `stock-${v.key}`, label: `Stock, ${label}`, target: `pf-stock-${v.key}` },
      ]
    }),
    { key: "processing", label: "Processing time", target: "pf-processing-min" },
    { key: "publishAt", label: "Go-live time", target: "pf-publish-at" },
    { key: "category", label: "Category", target: "pf-category" },
    { key: "subcategory", label: "Subcategory", target: "pf-subcategory" },
  ]
  return base
}

/** A unique slug across the whole catalogue (shopper URLs use it), suffixing -2, -3… when taken. */
export function uniqueSlug(name: string, taken: Set<string>) {
  const base = slugify(name) || "product"
  let slug = base
  let n = 2
  while (taken.has(slug) || taken.has(productIdFor(slug))) slug = `${base}-${n++}`
  return slug
}

export function buildImages(images: FormImage[], name: string, brand: Brand): ImageAsset[] {
  return images.map((im, i) => ({
    src: im.src,
    alt: im.alt || (i === 0 ? `${name} by ${brand.name}` : `${name}, photo ${i + 1}`),
    width: im.width,
    height: im.height,
  }))
}

export function buildOptions(f: ProductForm): ProductOption[] {
  const options: ProductOption[] = []
  const sizes = activeSizes(f)
  const colours = activeColours(f)
  if (sizes.length) options.push({ name: "Size", values: [...sizes] })
  if (colours.length) options.push({ name: "Colour", values: colours })
  return options
}
