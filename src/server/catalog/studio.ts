import "server-only"
import { and, asc, desc, eq, ilike, inArray, ne, or, sql, type SQL } from "drizzle-orm"
import { writeAudit } from "../audit"
import { assertBrandMayPublish, type BrandActor } from "../auth/dal"
import { db, withTx, type Executor } from "../db"
import { drops, mediaAssets } from "../db/schema"
import {
  brandOnboardings,
  catalogCategories,
  catalogCollectionProducts,
  catalogCollections,
  catalogImages,
  catalogOptions,
  catalogProducts,
  catalogVariants,
} from "../db/schema/catalog"
import { badRequest, conflict, notFound, rule } from "../http/errors"
import { newId } from "../ids"
import type { CollectionBody, CollectionUpdateBody, ProductCreateBody, ProductPublishBody, ProductUpdateBody } from "./contracts"
import { loadChildren, toStudioProduct } from "./dto"
import { CATALOG_IMAGE_PURPOSES } from "../media/visibility"
import { catalogChanged } from "./hooks"
import { moveStock } from "./stock"

/**
 * Brand Studio catalogue writes. Every read and write is scoped to the session's ACTIVE brand
 * (another brand's product is 404); writes run in one transaction, bump the product version
 * (optimistic concurrency: a stale expectedVersion is 409) and write an audit row.
 */

const auditActor = (a: BrandActor) => ({ kind: "brand" as const, id: a.userId, name: a.name, role: a.role })

export function slugify(s: string) {
  return (
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 70) || "item"
  )
}

async function uniqueProductSlug(d: Executor, wanted: string, explicit: boolean, exceptId?: string) {
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? wanted : `${wanted}-${i + 1}`
    const [hit] = await d
      .select({ id: catalogProducts.id })
      .from(catalogProducts)
      .where(and(eq(catalogProducts.slug, candidate), exceptId ? ne(catalogProducts.id, exceptId) : undefined))
      .limit(1)
    if (!hit) return candidate
    if (explicit) throw badRequest({ slug: "That web address is taken. Try another." })
  }
  return `${wanted}-${Date.now().toString(36)}`
}

/**
 * True until the brand's own application is approved: submitted, rejected, or rejected and being
 * edited again (status back to draft, brand still set): nothing goes public yet. Brands that never
 * went through onboarding (seeded, admin-created) have no row and are not under review.
 */
export async function brandUnderReview(d: Executor, brandId: string) {
  const [row] = await d
    .select({ status: brandOnboardings.status })
    .from(brandOnboardings)
    .where(and(eq(brandOnboardings.brandId, brandId), inArray(brandOnboardings.status, ["draft", "submitted", "rejected"])))
    .limit(1)
  return !!row
}

/** Brand uploads of the active brand that can be product or collection images. */
export async function assertBrandImages(d: Executor, brandId: string, mediaIds: string[], field: string) {
  const ids = [...new Set(mediaIds)]
  if (!ids.length) return new Map<string, { width: number | null; height: number | null }>()
  const rows = await d
    .select({ id: mediaAssets.id, width: mediaAssets.width, height: mediaAssets.height, mime: mediaAssets.mime, moderation: mediaAssets.moderationStatus })
    .from(mediaAssets)
    .where(and(inArray(mediaAssets.id, ids), eq(mediaAssets.brandId, brandId), eq(mediaAssets.ownerKind, "brand"), inArray(mediaAssets.purpose, [...CATALOG_IMAGE_PURPOSES])))
  const ok = new Map(rows.filter((r) => r.mime.startsWith("image/") && r.moderation !== "removed").map((r) => [r.id, { width: r.width, height: r.height }]))
  const fields: Record<string, string> = {}
  mediaIds.forEach((id, i) => {
    if (!ok.has(id)) fields[`${field}.${i}`] ??= "That photo isn't one of your uploads."
  })
  if (Object.keys(fields).length) throw badRequest(fields)
  return ok
}

/** A product may only be placed in one of its own brand's drops. */
async function assertOwnDrop(d: Executor, brandId: string, dropId: string | null | undefined) {
  if (dropId == null) return
  const [row] = await d.select({ id: drops.id }).from(drops).where(and(eq(drops.id, dropId), eq(drops.brandId, brandId))).limit(1)
  if (!row) throw badRequest({ dropId: "Choose one of your own drops." })
}

async function assertCategory(d: Executor, slug: string, subcategory: string | null | undefined) {
  const [c] = await d.select().from(catalogCategories).where(eq(catalogCategories.slug, slug)).limit(1)
  if (!c) throw badRequest({ categorySlug: "Choose one of Yard's categories." })
  if (subcategory && c.subcategories.length && !c.subcategories.includes(subcategory)) throw badRequest({ subcategory: `Choose a ${c.name} subcategory.` })
}

async function assertCollections(d: Executor, brandId: string, ids: string[]) {
  if (!ids.length) return
  const rows = await d
    .select({ id: catalogCollections.id })
    .from(catalogCollections)
    .where(and(inArray(catalogCollections.id, ids), eq(catalogCollections.brandId, brandId)))
  const ok = new Set(rows.map((r) => r.id))
  const fields: Record<string, string> = {}
  ids.forEach((id, i) => {
    if (!ok.has(id)) fields[`collectionIds.${i}`] = "That collection isn't one of yours."
  })
  if (Object.keys(fields).length) throw badRequest(fields)
}

type OptionIn = { name: string; values: { value: string; hex?: string }[] }
type VariantIn = { id?: string; sku: string; options: Record<string, string>; priceMinor?: number | null; initialStock?: number }

/** Variant option maps must use exactly the product's option names and listed values, with no duplicate combination or SKU. */
function validateVariants(options: OptionIn[], variants: VariantIn[]) {
  const fields: Record<string, string> = {}
  const names = options.map((o) => o.name)
  if (new Set(names).size !== names.length) fields.options = "Each option needs its own name."
  const combos = new Set<string>()
  const skus = new Set<string>()
  variants.forEach((v, i) => {
    const keys = Object.keys(v.options)
    if (keys.length !== names.length || keys.some((k) => !names.includes(k))) fields[`variants.${i}.options`] = names.length ? `Pick a value for ${names.join(" and ")}.` : "This product has no options, so variants can't have any."
    else
      for (const o of options)
        if (!o.values.some((x) => x.value === v.options[o.name])) {
          fields[`variants.${i}.options.${o.name}`] = `Choose one of the ${o.name} values.`
        }
    const combo = names.map((n) => v.options[n]).join("\u0000")
    if (combos.has(combo)) fields[`variants.${i}.options`] ??= "Two variants have the same options."
    combos.add(combo)
    const sku = v.sku.trim().toLowerCase()
    if (skus.has(sku)) fields[`variants.${i}.sku`] = "Each variant needs its own SKU."
    skus.add(sku)
  })
  if (Object.keys(fields).length) throw badRequest(fields)
}

async function assertSkusFree(d: Executor, brandId: string, variants: VariantIn[], productId?: string) {
  const skus = variants.map((v) => v.sku.trim())
  const rows = await d
    .select({ id: catalogVariants.id, sku: catalogVariants.sku, productId: catalogVariants.productId })
    .from(catalogVariants)
    .where(and(eq(catalogVariants.brandId, brandId), inArray(catalogVariants.sku, skus)))
  const fields: Record<string, string> = {}
  variants.forEach((v, i) => {
    const hit = rows.find((r) => r.sku === v.sku.trim())
    if (hit && !(productId && hit.productId === productId && hit.id === v.id)) fields[`variants.${i}.sku`] = "Another variant in your catalogue uses this SKU."
  })
  if (Object.keys(fields).length) throw badRequest(fields)
}

async function loadOwned(d: Executor, brandId: string, productId: string) {
  const [p] = await d
    .select()
    .from(catalogProducts)
    .where(and(eq(catalogProducts.id, productId), eq(catalogProducts.brandId, brandId)))
    .limit(1)
  if (!p) throw notFound("That product isn't in your catalogue.")
  return p
}

async function studioDto(d: Executor, brandId: string, productId: string) {
  const p = await loadOwned(d, brandId, productId)
  const kids = await loadChildren(d, [p.id])
  return { product: toStudioProduct(p, kids) }
}

async function writeImages(d: Executor, brandId: string, productId: string, images: { id?: string; mediaId?: string; alt: string }[]) {
  const existing = await d.select().from(catalogImages).where(eq(catalogImages.productId, productId))
  const byId = new Map(existing.map((i) => [i.id, i]))
  const fields: Record<string, string> = {}
  images.forEach((img, i) => {
    if (img.id && !byId.has(img.id)) fields[`images.${i}.id`] = "That photo isn't on this product."
    if (!img.id && !img.mediaId) fields[`images.${i}`] = "Upload a photo or keep an existing one."
  })
  if (Object.keys(fields).length) throw badRequest(fields)
  const newMedia = images.map((img) => (!img.id ? img.mediaId : undefined)).filter((x): x is string => !!x)
  const dims = await assertBrandImages(d, brandId, newMedia, "images")
  await d.delete(catalogImages).where(eq(catalogImages.productId, productId))
  const rows = images.map((img, position) => {
    const kept = img.id ? byId.get(img.id) : undefined
    if (kept) return { ...kept, alt: img.alt || kept.alt, position }
    const dim = dims.get(img.mediaId!)
    return { id: newId("pi"), productId, brandId, mediaId: img.mediaId!, path: null, alt: img.alt, width: dim?.width ?? null, height: dim?.height ?? null, position }
  })
  if (rows.length) await d.insert(catalogImages).values(rows)
}

async function writeCollectionLinks(d: Executor, brandId: string, productId: string, collectionIds: string[]) {
  await assertCollections(d, brandId, collectionIds)
  await d.delete(catalogCollectionProducts).where(eq(catalogCollectionProducts.productId, productId))
  if (!collectionIds.length) return
  for (const collectionId of [...new Set(collectionIds)]) {
    const [{ n }] = await d
      .select({ n: sql<number>`coalesce(max(${catalogCollectionProducts.position}), -1) + 1`.mapWith(Number) })
      .from(catalogCollectionProducts)
      .where(eq(catalogCollectionProducts.collectionId, collectionId))
    await d.insert(catalogCollectionProducts).values({ collectionId, productId, position: n })
  }
}

async function writeOptions(d: Executor, productId: string, options: OptionIn[]) {
  await d.delete(catalogOptions).where(eq(catalogOptions.productId, productId))
  if (options.length) await d.insert(catalogOptions).values(options.map((o, position) => ({ id: newId("po"), productId, name: o.name.trim(), values: o.values, position })))
}

/* ---------- Products ---------- */

export async function listStudioProducts(actor: BrandActor, q: { status: string; q?: string; collectionId?: string; lowStock?: "1" | "0"; limit: number; offset: number }) {
  const d = await db()
  const where: (SQL | undefined)[] = [eq(catalogProducts.brandId, actor.brandId)]
  if (q.status !== "all") where.push(eq(catalogProducts.status, q.status))
  if (q.q) {
    const like = `%${q.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`
    where.push(or(ilike(catalogProducts.title, like), sql`exists (select 1 from catalog_variants v where v.product_id = ${catalogProducts.id} and v.sku ilike ${like})`))
  }
  if (q.collectionId) where.push(sql`exists (select 1 from catalog_collection_products cp where cp.product_id = ${catalogProducts.id} and cp.collection_id = ${q.collectionId})`)
  if (q.lowStock === "1") where.push(sql`exists (select 1 from catalog_variants v where v.product_id = ${catalogProducts.id} and v.status = 'active' and v.on_hand - v.held <= 3)`)
  const rows = await d
    .select({ p: catalogProducts, total: sql<number>`count(*) over ()`.mapWith(Number) })
    .from(catalogProducts)
    .where(and(...where))
    .orderBy(desc(catalogProducts.updatedAt), asc(catalogProducts.id))
    .limit(q.limit)
    .offset(q.offset)
  const kids = await loadChildren(
    d,
    rows.map((r) => r.p.id),
  )
  const total = rows[0]?.total ?? 0
  return { products: rows.map((r) => toStudioProduct(r.p, kids)), total, nextOffset: q.offset + rows.length < total ? q.offset + rows.length : null }
}

export async function getStudioProduct(actor: BrandActor, productId: string) {
  return studioDto(await db(), actor.brandId, productId)
}

export async function createProduct(actor: BrandActor, body: ProductCreateBody, ipHash: string | null) {
  validateVariants(body.options, body.variants)
  if (body.variants.some((v) => v.id)) throw badRequest({ variants: "New products can't name existing variants." })
  if (body.images.some((i) => i.id)) throw badRequest({ images: "New products can't name existing photos." })
  if (body.compareAtMinor != null && body.compareAtMinor <= body.priceMinor) throw badRequest({ compareAtMinor: "The compare-at price must be above the price." })
  return withTx(async (tx) => {
    await assertCategory(tx, body.categorySlug, body.subcategory)
    await assertSkusFree(tx, actor.brandId, body.variants)
    await assertOwnDrop(tx, actor.brandId, body.dropId)
    const id = newId("p")
    const slug = await uniqueProductSlug(tx, body.slug ?? slugify(body.title), !!body.slug)
    const now = new Date()
    await tx.insert(catalogProducts).values({
      id,
      brandId: actor.brandId,
      slug,
      title: body.title.trim(),
      description: body.description,
      details: body.details,
      categorySlug: body.categorySlug,
      subcategory: body.subcategory ?? null,
      tags: [...new Set(body.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))],
      badges: [...new Set(body.badges)],
      priceMinor: body.priceMinor,
      compareAtMinor: body.compareAtMinor ?? null,
      currency: actor.brand.currency,
      status: "draft",
      processingMin: body.processingDays ? Math.min(...body.processingDays) : null,
      processingMax: body.processingDays ? Math.max(...body.processingDays) : null,
      dropId: body.dropId ?? null,
      createdAt: now,
      updatedAt: now,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    })
    await writeOptions(tx, id, body.options)
    for (const [position, v] of body.variants.entries()) {
      const vid = newId("pv")
      await tx.insert(catalogVariants).values({ id: vid, productId: id, brandId: actor.brandId, sku: v.sku.trim(), options: v.options, priceMinor: v.priceMinor ?? null, position })
      if (v.initialStock) await moveStock(tx, { variantId: vid, brandId: actor.brandId, delta: v.initialStock, reason: "adjustment", note: "Opening stock", actor: { kind: "brand", id: actor.userId } })
    }
    await writeImages(tx, actor.brandId, id, body.images)
    await writeCollectionLinks(tx, actor.brandId, id, body.collectionIds)
    await writeAudit({ actor: auditActor(actor), action: "catalog.product_created", target: body.title, subjectType: "catalog_product", subjectId: id, brandId: actor.brandId, ipHash, meta: { variants: body.variants.length, priceMinor: body.priceMinor } })
    catalogChanged({ products: [id] })
    return studioDto(tx, actor.brandId, id)
  })
}

export async function updateProduct(actor: BrandActor, productId: string, body: ProductUpdateBody, ipHash: string | null) {
  return withTx(async (tx) => {
    const p = await loadOwned(tx, actor.brandId, productId)
    if (p.version !== body.expectedVersion) throw conflict("Someone else changed this product since you opened it. Reload to see their changes.")
    if (p.status === "archived") throw rule("Restore this product before editing it.")
    const patch: Partial<typeof catalogProducts.$inferInsert> = {}
    if (body.title !== undefined) patch.title = body.title.trim()
    if (body.slug !== undefined && body.slug !== p.slug) patch.slug = await uniqueProductSlug(tx, body.slug, true, p.id)
    if (body.description !== undefined) patch.description = body.description
    if (body.details !== undefined) patch.details = body.details
    if (body.categorySlug !== undefined || body.subcategory !== undefined) {
      await assertCategory(tx, body.categorySlug ?? p.categorySlug, body.subcategory === undefined ? p.subcategory : body.subcategory)
      if (body.categorySlug !== undefined) patch.categorySlug = body.categorySlug
      if (body.subcategory !== undefined) patch.subcategory = body.subcategory
    }
    if (body.tags !== undefined) patch.tags = [...new Set(body.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))]
    if (body.badges !== undefined) patch.badges = [...new Set(body.badges)]
    if (body.priceMinor !== undefined) patch.priceMinor = body.priceMinor
    if (body.compareAtMinor !== undefined) patch.compareAtMinor = body.compareAtMinor
    const price = patch.priceMinor ?? p.priceMinor
    const compareAt = patch.compareAtMinor === undefined ? p.compareAtMinor : patch.compareAtMinor
    if (compareAt != null && compareAt <= price) throw badRequest({ compareAtMinor: "The compare-at price must be above the price." })
    if (body.processingDays !== undefined) {
      patch.processingMin = body.processingDays ? Math.min(...body.processingDays) : null
      patch.processingMax = body.processingDays ? Math.max(...body.processingDays) : null
    }
    if (body.dropId !== undefined && body.dropId !== p.dropId) {
      await assertOwnDrop(tx, actor.brandId, body.dropId)
      patch.dropId = body.dropId
    }

    // Options and variants reconcile together: kept variants keep their stock and history;
    // dropped ones are archived (never deleted: holds and movements point at them).
    if (body.options !== undefined || body.variants !== undefined) {
      const kids = await loadChildren(tx, [p.id])
      const options: OptionIn[] = body.options ?? (kids.options.get(p.id) ?? []).map((o) => ({ name: o.name, values: o.values }))
      const current = kids.variants.get(p.id) ?? []
      const variants: VariantIn[] = body.variants ?? current.filter((v) => v.status === "active").map((v) => ({ id: v.id, sku: v.sku, options: v.options, priceMinor: v.priceMinor }))
      if (!body.variants && body.options) {
        try {
          validateVariants(options, variants)
        } catch {
          throw badRequest({ variants: "Update the variants to match the new options." })
        }
      } else validateVariants(options, variants)
      const currentIds = new Set(current.map((v) => v.id))
      const fields: Record<string, string> = {}
      variants.forEach((v, i) => {
        if (v.id && !currentIds.has(v.id)) fields[`variants.${i}.id`] = "That variant isn't on this product."
        if (v.id && v.initialStock !== undefined) fields[`variants.${i}.initialStock`] = "Change stock for existing variants from the stock panel."
      })
      if (Object.keys(fields).length) throw badRequest(fields)
      await assertSkusFree(tx, actor.brandId, variants, p.id)
      if (body.options !== undefined) await writeOptions(tx, p.id, options)
      if (body.variants !== undefined) {
        const keep = new Set(variants.map((v) => v.id).filter(Boolean))
        const now = new Date()
        for (const v of current) if (!keep.has(v.id) && v.status === "active") await tx.update(catalogVariants).set({ status: "archived", updatedAt: now }).where(eq(catalogVariants.id, v.id))
        // Free the SKUs of kept variants first so two can swap SKUs without hitting the unique index.
        for (const v of variants) if (v.id) await tx.update(catalogVariants).set({ sku: `__swap_${v.id}` }).where(eq(catalogVariants.id, v.id))
        for (const [position, v] of variants.entries()) {
          if (v.id) await tx.update(catalogVariants).set({ sku: v.sku.trim(), options: v.options, priceMinor: v.priceMinor ?? null, position, status: "active", updatedAt: now }).where(eq(catalogVariants.id, v.id))
          else {
            const vid = newId("pv")
            await tx.insert(catalogVariants).values({ id: vid, productId: p.id, brandId: actor.brandId, sku: v.sku.trim(), options: v.options, priceMinor: v.priceMinor ?? null, position })
            if (v.initialStock) await moveStock(tx, { variantId: vid, brandId: actor.brandId, delta: v.initialStock, reason: "adjustment", note: "Opening stock", actor: { kind: "brand", id: actor.userId } })
          }
        }
      }
    }
    if (body.images !== undefined) await writeImages(tx, actor.brandId, p.id, body.images)
    if (body.collectionIds !== undefined) await writeCollectionLinks(tx, actor.brandId, p.id, body.collectionIds)

    const [updated] = await tx
      .update(catalogProducts)
      .set({ ...patch, version: p.version + 1, updatedAt: new Date(), updatedBy: actor.userId })
      .where(and(eq(catalogProducts.id, p.id), eq(catalogProducts.version, p.version)))
      .returning({ id: catalogProducts.id })
    if (!updated) throw conflict("Someone else changed this product since you opened it. Reload to see their changes.")
    await writeAudit({
      actor: auditActor(actor),
      action: "catalog.product_updated",
      target: patch.title ?? p.title,
      subjectType: "catalog_product",
      subjectId: p.id,
      brandId: actor.brandId,
      ipHash,
      meta: { fields: Object.keys(body).filter((k) => k !== "expectedVersion"), ...(patch.priceMinor !== undefined && patch.priceMinor !== p.priceMinor ? { priceFrom: p.priceMinor, priceTo: patch.priceMinor } : {}) },
    })
    catalogChanged({ products: [p.id] })
    return studioDto(tx, actor.brandId, p.id)
  })
}

const STATUS_ACTIONS = { publish: "catalog.product_published", schedule: "catalog.product_scheduled", unpublish: "catalog.product_unpublished", archive: "catalog.product_archived", restore: "catalog.product_restored" } as const

const MAX_SCHEDULE_MS = 366 * 24 * 3600_000

export async function setProductStatus(actor: BrandActor, productId: string, body: ProductPublishBody, ipHash: string | null) {
  return withTx(async (tx) => {
    const p = await loadOwned(tx, actor.brandId, productId)
    if (p.version !== body.expectedVersion) throw conflict("Someone else changed this product since you opened it. Reload to see their changes.")
    const now = new Date()
    const patch: Partial<typeof catalogProducts.$inferInsert> = {}
    if (body.action === "publish" || body.action === "schedule") {
      assertBrandMayPublish(actor)
      if (p.status === "archived") throw rule("Restore this product before publishing it.")
      if (p.moderationStatus === "hidden") throw rule("Yard has hidden this product, so it can't be published. Contact support to appeal.")
      if (await brandUnderReview(tx, actor.brandId)) throw rule("Yard is still reviewing your brand. You can publish once it's approved.")
      const kids = await loadChildren(tx, [p.id])
      if (!(kids.variants.get(p.id) ?? []).some((v) => v.status === "active")) throw rule("Add at least one variant before publishing.")
      if (!(kids.images.get(p.id) ?? []).length) throw rule("Add at least one photo before publishing.")
      if (body.action === "publish") Object.assign(patch, { status: "published", publishAt: null, publishedAt: p.publishedAt ?? now })
      else {
        if (!body.publishAt) throw badRequest({ publishAt: "Choose when it goes live." })
        const at = new Date(body.publishAt)
        if (at.getTime() < now.getTime() + 60_000) throw badRequest({ publishAt: "Choose a time at least a minute from now." })
        if (at.getTime() > now.getTime() + MAX_SCHEDULE_MS) throw badRequest({ publishAt: "Choose a time within the next year." })
        Object.assign(patch, { status: "scheduled", publishAt: at })
      }
    } else if (body.action === "unpublish") {
      if (p.status === "archived") throw rule("This product is archived.")
      Object.assign(patch, { status: "draft", publishAt: null })
    } else if (body.action === "archive") {
      Object.assign(patch, { status: "archived", publishAt: null })
    } else {
      if (p.status !== "archived") throw rule("Only archived products can be restored.")
      Object.assign(patch, { status: "draft" })
    }
    const [updated] = await tx
      .update(catalogProducts)
      .set({ ...patch, version: p.version + 1, updatedAt: now, updatedBy: actor.userId })
      .where(and(eq(catalogProducts.id, p.id), eq(catalogProducts.version, p.version)))
      .returning({ id: catalogProducts.id })
    if (!updated) throw conflict("Someone else changed this product since you opened it. Reload to see their changes.")
    await writeAudit({ actor: auditActor(actor), action: STATUS_ACTIONS[body.action], target: p.title, subjectType: "catalog_product", subjectId: p.id, brandId: actor.brandId, ipHash, meta: { from: p.status, to: patch.status, publishAt: body.action === "schedule" ? body.publishAt : undefined } })
    catalogChanged({ products: [p.id] })
    return studioDto(tx, actor.brandId, p.id)
  })
}

/* ---------- Collections ---------- */

function collectionDto(c: typeof catalogCollections.$inferSelect, productIds: string[]) {
  return {
    id: c.id,
    handle: c.handle,
    name: c.name,
    description: c.description,
    status: c.status,
    position: c.position,
    imageMediaId: c.imageMediaId,
    imageSrc: c.imageMediaId ? `/api/media/${encodeURIComponent(c.imageMediaId)}?as=brand` : c.imagePath,
    productIds,
    version: c.version,
    updatedAt: c.updatedAt.toISOString(),
  }
}

async function collectionProductIds(d: Executor, ids: string[]) {
  if (!ids.length) return new Map<string, string[]>()
  const links = await d.select().from(catalogCollectionProducts).where(inArray(catalogCollectionProducts.collectionId, ids)).orderBy(asc(catalogCollectionProducts.position))
  const m = new Map<string, string[]>()
  for (const l of links) m.set(l.collectionId, [...(m.get(l.collectionId) ?? []), l.productId])
  return m
}

async function validateCollectionProductIds(d: Executor, brandId: string, productIds: string[]) {
  const ids = [...new Set(productIds)]
  if (ids.length) {
    const rows = await d
      .select({ id: catalogProducts.id })
      .from(catalogProducts)
      .where(and(inArray(catalogProducts.id, ids), eq(catalogProducts.brandId, brandId)))
    const valid = new Set(rows.map((row) => row.id))
    const fields: Record<string, string> = {}
    productIds.forEach((productId, index) => {
      if (!valid.has(productId)) fields[`productIds.${index}`] = "That piece isn't in your catalogue."
    })
    if (Object.keys(fields).length) throw badRequest(fields)
  }
  return ids
}

async function loadCollection(d: Executor, brandId: string, id: string) {
  const [c] = await d
    .select()
    .from(catalogCollections)
    .where(and(eq(catalogCollections.id, id), eq(catalogCollections.brandId, brandId)))
    .limit(1)
  if (!c) throw notFound("That collection isn't one of yours.")
  return c
}

async function uniqueHandle(d: Executor, brandId: string, wanted: string, explicit: boolean, exceptId?: string) {
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? wanted : `${wanted}-${i + 1}`
    const [hit] = await d
      .select({ id: catalogCollections.id })
      .from(catalogCollections)
      .where(and(eq(catalogCollections.brandId, brandId), eq(catalogCollections.handle, candidate), exceptId ? ne(catalogCollections.id, exceptId) : undefined))
      .limit(1)
    if (!hit) return candidate
    if (explicit) throw badRequest({ handle: "You already have a collection at that address." })
  }
  return `${wanted}-${Date.now().toString(36)}`
}

export async function listStudioCollections(actor: BrandActor) {
  const d = await db()
  const rows = await d.select().from(catalogCollections).where(eq(catalogCollections.brandId, actor.brandId)).orderBy(asc(catalogCollections.position), asc(catalogCollections.name))
  const links = await collectionProductIds(
    d,
    rows.map((r) => r.id),
  )
  return { collections: rows.map((c) => collectionDto(c, links.get(c.id) ?? [])) }
}

export async function createCollection(actor: BrandActor, body: CollectionBody, idempotencyKey: string | null, ipHash: string | null) {
  return withTx(async (tx) => {
    if (!idempotencyKey || !/^[A-Za-z0-9_-]{8,80}$/.test(idempotencyKey)) throw badRequest({ _: "Send an Idempotency-Key of 8-80 letters, digits, - or _." })
    const sameRequest = (existing: typeof catalogCollections.$inferSelect) => existing.name === body.name.trim() && existing.description === body.description && existing.imageMediaId === (body.imageMediaId ?? null) && existing.status === body.status && (body.handle === undefined || existing.handle === body.handle) && (body.position === undefined || existing.position === body.position)
    const findRetry = async () => {
      const [existing] = await tx.select().from(catalogCollections).where(and(eq(catalogCollections.brandId, actor.brandId), eq(catalogCollections.idempotencyKey, idempotencyKey))).limit(1)
      if (!existing) return null
      if (!sameRequest(existing)) throw conflict("That Idempotency-Key was already used for a different collection. Start a new action.")
      const links = await collectionProductIds(tx, [existing.id])
      return { collection: collectionDto(existing, links.get(existing.id) ?? []) }
    }
    const replay = await findRetry()
    if (replay) return replay
    if (body.imageMediaId) await assertBrandImages(tx, actor.brandId, [body.imageMediaId], "imageMediaId")
    for (let attempt = 0; attempt < 5; attempt++) {
      const id = newId("col")
      const handle = await uniqueHandle(tx, actor.brandId, body.handle ?? slugify(body.name), !!body.handle)
      const [{ n }] = await tx
        .select({ n: sql<number>`coalesce(max(${catalogCollections.position}), -1) + 1`.mapWith(Number) })
        .from(catalogCollections)
        .where(eq(catalogCollections.brandId, actor.brandId))
      const [created] = await tx
        .insert(catalogCollections)
        .values({ id, brandId: actor.brandId, handle, name: body.name.trim(), description: body.description, imageMediaId: body.imageMediaId ?? null, status: body.status, position: body.position ?? n, idempotencyKey })
        .onConflictDoNothing()
        .returning()
      if (created) {
        await writeAudit({ actor: auditActor(actor), action: "catalog.collection_created", target: created.name, subjectType: "catalog_collection", subjectId: id, brandId: actor.brandId, ipHash })
        catalogChanged({ brands: [actor.brandId] })
        return { collection: collectionDto(created, []) }
      }
      const retry = await findRetry()
      if (retry) return retry
      if (body.handle !== undefined) throw badRequest({ handle: "You already have a collection at that address." })
    }
    throw conflict("The collection couldn't be created. Try again with a new action.")
  })
}

export async function updateCollection(actor: BrandActor, id: string, body: CollectionUpdateBody, ipHash: string | null) {
  return withTx(async (tx) => {
    const c = await loadCollection(tx, actor.brandId, id)
    if (c.version !== body.expectedVersion) throw conflict("Someone else changed this collection. Reload to see their changes.")
    if (body.imageMediaId) await assertBrandImages(tx, actor.brandId, [body.imageMediaId], "imageMediaId")
    const productIds = body.productIds === undefined ? undefined : await validateCollectionProductIds(tx, actor.brandId, body.productIds)
    const previousProductIds = productIds === undefined ? [] : (await collectionProductIds(tx, [id])).get(id) ?? []
    const patch: Partial<typeof catalogCollections.$inferInsert> = { updatedAt: new Date() }
    if (body.name !== undefined) patch.name = body.name.trim()
    if (body.handle !== undefined && body.handle !== c.handle) patch.handle = await uniqueHandle(tx, actor.brandId, body.handle, true, id)
    if (body.description !== undefined) patch.description = body.description
    if (body.imageMediaId !== undefined) patch.imageMediaId = body.imageMediaId
    if (body.status !== undefined) patch.status = body.status
    if (body.position !== undefined) patch.position = body.position
    const [row] = await tx.update(catalogCollections).set({ ...patch, version: c.version + 1 }).where(and(eq(catalogCollections.id, id), eq(catalogCollections.version, body.expectedVersion))).returning()
    if (!row) throw conflict("Someone else changed this collection. Reload to see their changes.")
    if (productIds !== undefined) {
      await tx.delete(catalogCollectionProducts).where(eq(catalogCollectionProducts.collectionId, id))
      if (productIds.length) await tx.insert(catalogCollectionProducts).values(productIds.map((productId, position) => ({ collectionId: id, productId, position })))
      await writeAudit({ actor: auditActor(actor), action: "catalog.collection_products_set", target: row.name, subjectType: "catalog_collection", subjectId: id, brandId: actor.brandId, ipHash, meta: { count: productIds.length } })
    }
    await writeAudit({ actor: auditActor(actor), action: "catalog.collection_updated", target: row.name, subjectType: "catalog_collection", subjectId: id, brandId: actor.brandId, ipHash, meta: { fields: Object.keys(body) } })
    const currentProductIds = productIds ?? (await collectionProductIds(tx, [id])).get(id) ?? []
    catalogChanged({ products: [...new Set([...previousProductIds, ...currentProductIds])], brands: [actor.brandId] })
    return { collection: collectionDto(row, currentProductIds) }
  })
}

export async function deleteCollection(actor: BrandActor, id: string, expectedVersion: number, ipHash: string | null) {
  return withTx(async (tx) => {
    const c = await loadCollection(tx, actor.brandId, id)
    if (c.version !== expectedVersion) throw conflict("Someone else changed this collection. Reload to see their changes.")
    const links = await collectionProductIds(tx, [id])
    const [deleted] = await tx.delete(catalogCollections).where(and(eq(catalogCollections.id, id), eq(catalogCollections.version, expectedVersion))).returning({ id: catalogCollections.id })
    if (!deleted) throw conflict("Someone else changed this collection. Reload to see their changes.")
    await writeAudit({ actor: auditActor(actor), action: "catalog.collection_deleted", target: c.name, subjectType: "catalog_collection", subjectId: id, brandId: actor.brandId, ipHash })
    catalogChanged({ products: links.get(id) ?? [], brands: [actor.brandId] })
    return { ok: true }
  })
}

/** Replaces a collection's products, in order. Every id must be one of the brand's products. */
export async function setCollectionProducts(actor: BrandActor, id: string, productIds: string[], expectedVersion: number, ipHash: string | null) {
  return withTx(async (tx) => {
    const c = await loadCollection(tx, actor.brandId, id)
    if (c.version !== expectedVersion) throw conflict("Someone else changed this collection. Reload to see their changes.")
    const ids = await validateCollectionProductIds(tx, actor.brandId, productIds)
    const before = (await collectionProductIds(tx, [id])).get(id) ?? []
    const updatedAt = new Date()
    const [updated] = await tx.update(catalogCollections).set({ updatedAt, version: c.version + 1 }).where(and(eq(catalogCollections.id, id), eq(catalogCollections.version, expectedVersion))).returning({ id: catalogCollections.id })
    if (!updated) throw conflict("Someone else changed this collection. Reload to see their changes.")
    await tx.delete(catalogCollectionProducts).where(eq(catalogCollectionProducts.collectionId, id))
    if (ids.length) await tx.insert(catalogCollectionProducts).values(ids.map((productId, position) => ({ collectionId: id, productId, position })))
    await writeAudit({ actor: auditActor(actor), action: "catalog.collection_products_set", target: c.name, subjectType: "catalog_collection", subjectId: id, brandId: actor.brandId, ipHash, meta: { count: ids.length } })
    catalogChanged({ products: [...new Set([...before, ...ids])] })
    return { collection: collectionDto({ ...c, version: c.version + 1, updatedAt }, ids) }
  })
}
