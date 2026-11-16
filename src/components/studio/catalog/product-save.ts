import { ApiError, api } from "@/lib/api/client"
import type { StudioProductCreateBody, StudioProductDto, StudioProductResponse } from "@/lib/api/contracts/catalog"
import { products as seedProducts } from "@/lib/data"
import type { Brand, CategorySlug, Collection, Product, Variant } from "@/lib/data/types"
import { useStudio } from "@/lib/stores/studio"
import { buildImages, buildOptions, uniqueSlug, type ProductForm } from "./product-form-model"
import { parseMoney, productIdFor } from "./utils"

/**
 * How a product form becomes a product, shared by the full editor and Quick add so the two can
 * never make different products: the same request body (POST/PATCH /api/studio/catalog/products)
 * for a live brand, the same Product for the sample store.
 */

/** The catalogue write body for a live brand. Throws (with user copy) when a photo hasn't finished uploading. */
export function liveProductBody(form: ProductForm, ctx: { brand: Brand; product?: Product; collections: Collection[] }): StudioProductCreateBody {
  const { brand, product, collections } = ctx
  const currency = brand.currency
  const name = form.name.trim()
  const alts = buildImages(form.images, name, brand)
  const images = form.images.map((im, index) => {
    if (im.imageId) return { id: im.imageId, alt: alts[index].alt }
    if (im.mediaId) return { mediaId: im.mediaId, alt: alts[index].alt }
    throw new Error("One or more photos didn't finish uploading. Remove them and add them again.")
  })
  return {
    title: name,
    description: form.description.trim(),
    details: product?.details ?? [],
    categorySlug: form.category,
    subcategory: form.subcategory || null,
    tags: form.tags,
    badges: product?.badges ?? ["new"],
    priceMinor: parseMoney(form.price, currency)!,
    compareAtMinor: form.compareAt.trim() ? parseMoney(form.compareAt, currency) : null,
    processingDays: [Number(form.processingMin), Number(form.processingMax)],
    dropId: product?.dropId ?? null,
    options: buildOptions(form).map((option) =>
      option.name === "Size"
        ? { name: option.name, values: option.values.map((value) => ({ value })) }
        : { name: option.name, values: option.values.map((value) => ({ value: value.name, hex: value.hex })) },
    ),
    variants: form.variants.map((v) =>
      v.id
        ? { id: v.id, sku: v.sku.trim().toUpperCase(), options: v.options, priceMinor: v.priceOverrideMinor ?? null }
        : { sku: v.sku.trim().toUpperCase(), options: v.options, priceMinor: null, initialStock: Number(v.stock) },
    ),
    images,
    collectionIds: form.collectionIds.filter((cid) => collections.some((c) => c.id === cid)),
  }
}

/**
 * The sample store's product for a form (demo and development). `profile` is the brand profile
 * products without their own processing time fall back to. Returns the product and the stock
 * changes to log for variants that already existed.
 */
export function localProductFrom(form: ProductForm, ctx: { brand: Brand; profile: Brand; product?: Product; collections: Collection[]; now: number }) {
  const { brand, profile, product, collections, now } = ctx
  const store = useStudio.getState()
  const currency = brand.currency
  const name = form.name.trim()
  const taken = new Set([...seedProducts, ...store.products].flatMap((p) => [p.slug, p.id]))
  const slug = product?.slug ?? uniqueSlug(name, taken)
  const id = product?.id ?? productIdFor(slug)
  const live = store.products.find((p) => p.id === id)

  let next = Math.max(-1, ...(product?.variants ?? []).map((v) => Number(/_v(\d+)$/.exec(v.id)?.[1] ?? -1))) + 1
  const adjustments: { variantId: string; delta: number }[] = []
  const variants: Variant[] = form.variants.map((v) => {
    const sku = v.sku.trim().toUpperCase()
    const qty = Number(v.stock)
    if (v.id) {
      const current = live?.variants.find((x) => x.id === v.id)
      const base = current?.stock ?? v.originalStock ?? qty
      const delta = qty - (v.originalStock ?? qty)
      if (delta !== 0) adjustments.push({ variantId: v.id, delta })
      return { id: v.id, sku, options: v.options, stock: base, reserved: current?.reserved ?? v.reserved }
    }
    return { id: `${id}_v${next++}`, sku, options: v.options, stock: qty, reserved: 0 }
  })

  const publishAt = form.status === "scheduled" ? new Date(form.publishAt).toISOString() : null
  const days: [number, number] = [Number(form.processingMin), Number(form.processingMax)]
  // Compared with the brand profile, which products without their own time fall back to; a
  // product seeded from a different Settings default keeps that time explicitly.
  const ownDays = days[0] !== profile.processingDays[0] || days[1] !== profile.processingDays[1]
  const saved: Product = {
    ...(product ?? {}),
    id,
    slug,
    brandId: brand.id,
    name,
    description: form.description.trim(),
    details: product?.details ?? [],
    category: form.category as CategorySlug,
    subcategory: form.subcategory,
    tags: form.tags,
    price: parseMoney(form.price, currency)!,
    compareAt: form.compareAt.trim() ? parseMoney(form.compareAt, currency)! : undefined,
    currency,
    images: buildImages(form.images, name, brand),
    options: buildOptions(form),
    variants,
    badges: product?.badges ?? ["new"],
    status: form.status,
    createdAt: product?.createdAt ?? new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    publishAt: publishAt ?? undefined,
    // Only a product that differs from the brand's default keeps its own processing time.
    processingDays: ownDays ? days : undefined,
    collectionIds: form.collectionIds.filter((cid) => collections.some((c) => c.id === cid)),
    dropId: product?.dropId,
    stats: product?.stats ?? { views7d: 0, wishlists: 0, sales30d: 0, trend: 0 },
  }
  return { saved, adjustments, publishAt }
}

/** Publishes a saved live product (the editor's status endpoint). Resolves to the fresh product. */
export async function publishLiveProduct(id: string, version: number): Promise<StudioProductDto> {
  const result = await api<StudioProductResponse>(`/api/studio/catalog/products/${encodeURIComponent(id)}/status`, { body: { action: "publish", expectedVersion: version } })
  return result.product
}

/** The words for a failed publish. */
export const publishError = (cause: unknown) => (cause instanceof ApiError || (cause instanceof Error && !(cause instanceof TypeError)) ? cause.message : "Check your connection and try again.")
