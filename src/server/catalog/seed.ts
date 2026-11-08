import "server-only"
import { brands as sampleBrands } from "@/lib/data/brands"
import { categories as sampleCategories, collections as sampleCollections } from "@/lib/data/catalog"
import { db } from "../db"
import {
  catalogCategories,
  catalogCollectionProducts,
  catalogCollections,
  catalogImages,
  catalogOptions,
  catalogProducts,
  catalogVariants,
  stockMovements,
  storefrontVersions,
} from "../db/schema/catalog"
import type { SeedModule } from "../db/seed/types"
import { sql } from "drizzle-orm"

/**
 * seed:catalog — moves today's sample catalogue (src/lib/data) into the CATALOG tables:
 * categories, every sample product with its options, variants (on_hand = sample stock minus
 * sample reserved, written with a 'seed' movement), photos (sample /media paths), collections,
 * and each sample brand's storefront as published version 1. Product, variant and collection
 * ids are the sample ids, so existing references (order refs, inbox product cards, charts) still
 * resolve. Re-running only fills what's missing: existing rows (and live stock) are never
 * overwritten; categories are upserted.
 *
 * Register after seed:brands (it needs every sample brand row): requires brands:b_lagos_static.
 */
const excluded = (column: string) => sql.raw(`excluded.${column}`)

const seed: SeedModule = {
  key: "seed:catalog",
  version: 1,
  requires: ["brands:b_lagos_static"],
  async run(ctx) {
    const d = await db()

    await d
      .insert(catalogCategories)
      .values(sampleCategories.map((c, position) => ({ slug: c.slug, name: c.name, description: c.description, imagePath: c.image.src, subcategories: [...c.subcategories], position })))
      .onConflictDoUpdate({ target: catalogCategories.slug, set: { name: excluded("name"), description: excluded("description"), imagePath: excluded("image_path"), subcategories: excluded("subcategories"), position: excluded("position") } })

    const products = ctx.products.filter((p) => ctx.brandById.has(p.brandId))
    for (let i = 0; i < products.length; i += 50) {
      const chunk = products.slice(i, i + 50)
      await d
        .insert(catalogProducts)
        .values(
          chunk.map((p) => {
            const created = new Date(p.createdAt)
            return {
              id: p.id,
              brandId: p.brandId,
              slug: p.slug,
              title: p.name,
              description: p.description,
              details: [...p.details],
              categorySlug: p.category,
              subcategory: p.subcategory,
              tags: [...p.tags],
              badges: [...p.badges],
              priceMinor: p.price,
              compareAtMinor: p.compareAt ?? null,
              currency: p.currency,
              status: p.status === "scheduled" && !p.publishAt ? "draft" : p.status,
              publishAt: p.publishAt ? new Date(p.publishAt) : null,
              publishedAt: p.status === "published" ? created : null,
              processingMin: p.processingDays?.[0] ?? null,
              processingMax: p.processingDays?.[1] ?? null,
              dropId: p.dropId ?? null,
              createdAt: created,
              updatedAt: p.updatedAt ? new Date(p.updatedAt) : created,
            }
          }),
        )
        .onConflictDoNothing()
    }

    const options = products.flatMap((p) =>
      p.options.map((o, position) => ({
        id: `${p.id}_o${position}`,
        productId: p.id,
        name: o.name,
        values: o.name === "Colour" ? o.values.map((v) => ({ value: v.name, hex: v.hex })) : o.values.map((v) => ({ value: v })),
        position,
      })),
    )
    for (let i = 0; i < options.length; i += 200) await d.insert(catalogOptions).values(options.slice(i, i + 200)).onConflictDoNothing()

    const variants = products.flatMap((p) => p.variants.map((v, position) => ({ p, v, position })))
    for (let i = 0; i < variants.length; i += 200) {
      const chunk = variants.slice(i, i + 200)
      const inserted = await d
        .insert(catalogVariants)
        .values(chunk.map(({ p, v, position }) => ({ id: v.id, productId: p.id, brandId: p.brandId, sku: v.sku, options: { ...v.options }, position, onHand: Math.max(0, v.stock - v.reserved), held: 0 })))
        .onConflictDoNothing()
        .returning({ id: catalogVariants.id, brandId: catalogVariants.brandId, onHand: catalogVariants.onHand })
      const moves = inserted.filter((v) => v.onHand > 0)
      if (moves.length)
        await d
          .insert(stockMovements)
          .values(moves.map((v) => ({ id: `sm_seed_${v.id}`, variantId: v.id, brandId: v.brandId, delta: v.onHand, onHandAfter: v.onHand, reason: "seed", note: "Sample catalogue", actorKind: "system" })))
          .onConflictDoNothing()
    }

    const images = products.flatMap((p) => p.images.map((img, position) => ({ id: `${p.id}_i${position}`, productId: p.id, brandId: p.brandId, path: img.src, alt: img.alt, width: img.width, height: img.height, position })))
    for (let i = 0; i < images.length; i += 200) await d.insert(catalogImages).values(images.slice(i, i + 200)).onConflictDoNothing()

    const productIds = new Set(products.map((p) => p.id))
    const collections = sampleCollections.filter((c) => ctx.brandById.has(c.brandId))
    if (collections.length) {
      await d
        .insert(catalogCollections)
        .values(collections.map((c, position) => ({ id: c.id, brandId: c.brandId, handle: c.handle, name: c.name, description: c.description, imagePath: c.image.src, status: "published", position })))
        .onConflictDoNothing()
      const links = collections.flatMap((c) => c.productIds.filter((id) => productIds.has(id)).map((productId, position) => ({ collectionId: c.id, productId, position })))
      if (links.length) await d.insert(catalogCollectionProducts).values(links).onConflictDoNothing()
    }

    const brands = sampleBrands.filter((b) => ctx.brandById.has(b.id))
    if (brands.length)
      await d
        .insert(storefrontVersions)
        .values(
          brands.map((b) => ({
            id: `sfv_${b.id}_1`,
            brandId: b.id,
            version: 1,
            config: { ...b.storefront, coverPath: b.cover.src, mark: b.mark } as Record<string, unknown>,
            note: "Sample storefront",
            publishedAt: new Date(b.joinedAt),
          })),
        )
        .onConflictDoNothing()
  },
}

export default seed
