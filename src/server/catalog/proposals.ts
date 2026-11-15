import "server-only"
import { and, asc, desc, eq, ilike, inArray, ne, or, sql, type SQL } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import type {
  AdminProposalContextDto,
  ProposalChangeDto,
  ProposalDetailDto,
  ProposalImageDto,
  ProposalKind,
  ProposalListDto,
  ProposalStatus,
  ProposalSummaryDto,
} from "@/lib/api/contracts/proposals"
import { PROPOSAL_STATUSES } from "@/lib/api/contracts/proposals"
import { applyChanges, changedSince, diffProposal, normalize, PROPOSAL_FIELDS, proposalFieldLabels, stockAfter, updateBodyOf, viewOf, type ProductView, type ProposalChanges, type ProposalField } from "@/lib/proposals"
import type { AdminActor, BrandActor } from "../auth/dal"
import { writeAudit } from "../audit"
import { db, withTx, type Executor } from "../db"
import { brands, mediaAssets, notifications, users } from "../db/schema"
import { catalogCollections, catalogImages, catalogProducts, productProposals } from "../db/schema/catalog"
import { shippingProfiles } from "../db/schema/shipping"
import { badRequest, conflict, notFound, rule } from "../http/errors"
import { newId } from "../ids"
import { mediaSrc } from "../media"
import { announceRemovedNotifications, notify } from "../notify"
import { emailBrandMembersWith } from "../orders/brand-email"
import { publish } from "../realtime/bus"
import { channels } from "../realtime/channels"
import { productCreateBody, productUpdateBody, type AdminProposalCreateBody, type AdminProposalReviseBody, type ProposalProductBody } from "./contracts"
import { loadChildren, toStudioProduct, variantLabelOf } from "./dto"
import { notSampleBrandSql, refuseSampleBrand, refuseSampleProduct } from "./sample-guard"
import { adjustStock } from "./stock"
import { assertBrandImages, assertCategory, assertCollections, assertSkusFree, brandUnderReview, createProduct, setProductStatus, updateProduct, validateVariants } from "./studio"

/**
 * Suggestions from Yard (src/lib/api/contracts/proposals.ts). An admin with catalog.propose
 * suggests a new product for a brand, or changes to one of its products; the brand's members who
 * can manage products (content.publish) accept, edit then accept, or decline. Nothing touches the
 * catalogue before acceptance, and acceptance goes through the same Studio writes a brand member
 * makes (createProduct, updateProduct, setProductStatus, adjustStock), as that member, so every
 * catalogue rule, version check and audit row applies unchanged. Every proposal write is one
 * transaction with its audit row; notifications, emails and realtime ride it.
 */

type Row = typeof productProposals.$inferSelect
const adminAudit = (a: AdminActor) => ({ kind: "admin" as const, id: a.userId, name: a.name, role: a.role })
const brandAudit = (a: BrandActor) => ({ kind: "brand" as const, id: a.userId, name: a.name, role: a.role })

export const studioProposalHref = (id: string) => `/studio/products/suggestions/${encodeURIComponent(id)}`
export const adminProposalHref = (id: string) => `/admin/products/suggestions?proposal=${encodeURIComponent(id)}`
const brandNoticeKey = (id: string) => `proposal:${id}`

/* ------------------------------------------------------------------ loading */

async function loadBrand(d: Executor, brandId: string) {
  const [b] = await d.select({ id: brands.id, name: brands.name, handle: brands.handle, currency: brands.currency, country: brands.country, city: brands.city, reviewStatus: brands.reviewStatus }).from(brands).where(eq(brands.id, brandId)).limit(1)
  return b ?? null
}

async function defaultProcessing(d: Executor, brandId: string): Promise<[number, number] | null> {
  const [p] = await d.select({ min: shippingProfiles.handlingMin, max: shippingProfiles.handlingMax }).from(shippingProfiles).where(eq(shippingProfiles.brandId, brandId)).limit(1)
  return p ? [p.min, p.max] : null
}

/** A product as the proposal rules compare it (active variants only, stock by variant id). */
async function productState(d: Executor, productId: string) {
  const [p] = await d.select().from(catalogProducts).where(eq(catalogProducts.id, productId)).limit(1)
  if (!p) return null
  const kids = await loadChildren(d, [p.id])
  const active = (kids.variants.get(p.id) ?? []).filter((v) => v.status === "active")
  const view: ProductView = normalize({
    title: p.title,
    description: p.description,
    details: p.details,
    categorySlug: p.categorySlug,
    subcategory: p.subcategory,
    tags: p.tags,
    badges: p.badges,
    priceMinor: p.priceMinor,
    compareAtMinor: p.compareAtMinor,
    processingDays: p.processingMin != null && p.processingMax != null ? [p.processingMin, p.processingMax] : null,
    options: (kids.options.get(p.id) ?? []).map((o) => ({ name: o.name, values: o.values })),
    variants: active.map((v) => ({ id: v.id, sku: v.sku, options: v.options, priceMinor: v.priceMinor })),
    images: (kids.images.get(p.id) ?? []).map((i) => ({ id: i.id, alt: i.alt })),
    collectionIds: kids.collections.get(p.id) ?? [],
    stock: Object.fromEntries(active.map((v) => [v.id, v.onHand])),
  })
  return { row: p, kids, view }
}

async function loadProposal(d: Executor, id: string) {
  const [row] = await d.select().from(productProposals).where(eq(productProposals.id, id)).limit(1)
  return row ?? null
}

/* ------------------------------------------------------------------ validation */

/** The checks a product form body has to pass before it can be proposed (the rest run again at acceptance). */
async function checkBody(d: Executor, brandId: string, body: ProposalProductBody, opts: { productId?: string; imageIds?: Set<string>; variantIds?: Set<string> }) {
  validateVariants(body.options, body.variants)
  if (body.compareAtMinor != null && body.compareAtMinor <= body.priceMinor) throw badRequest({ compareAtMinor: "The compare-at price must be above the price." })
  const fields: Record<string, string> = {}
  body.variants.forEach((v, i) => {
    if (v.id && !opts.variantIds?.has(v.id)) fields[`variants.${i}.id`] = opts.productId ? "That variant isn't on this product." : "New products can't name existing variants."
  })
  body.images.forEach((img, i) => {
    if (img.id && !opts.imageIds?.has(img.id)) fields[`images.${i}.id`] = opts.productId ? "That photo isn't on this product." : "New products can't name existing photos."
    if (!img.id && !img.mediaId) fields[`images.${i}`] = "Upload a photo or keep an existing one."
  })
  for (const id of Object.keys(body.stockDelta ?? {})) if (!opts.variantIds?.has(id)) fields.stockDelta = "Stock can only be set for this product's variants."
  if (Object.keys(fields).length) throw badRequest(fields)
  await assertCategory(d, body.categorySlug, body.subcategory)
  await assertSkusFree(d, brandId, body.variants, opts.productId)
  await assertCollections(d, brandId, body.collectionIds)
  await assertBrandImages(d, brandId, body.images.filter((i) => !i.id && i.mediaId).map((i) => i.mediaId!), "product.images")
}

/** A ProductCreateBody from a stored new-product view. */
function createBodyOf(view: ProductView) {
  return productCreateBody.parse({
    title: view.title,
    description: view.description,
    details: view.details,
    categorySlug: view.categorySlug,
    subcategory: view.subcategory,
    tags: view.tags,
    badges: view.badges,
    priceMinor: view.priceMinor,
    compareAtMinor: view.compareAtMinor,
    processingDays: view.processingDays,
    options: view.options,
    variants: view.variants.map((v) => ({ sku: v.sku, options: v.options, priceMinor: v.priceMinor, ...(v.initialStock ? { initialStock: v.initialStock } : {}) })),
    images: view.images.map((i) => ({ mediaId: i.mediaId, alt: i.alt })),
    collectionIds: view.collectionIds,
  })
}

/* ------------------------------------------------------------------ DTOs */

const adminUser = alias(users, "proposal_admin")
const decider = alias(users, "proposal_decider")

type Listed = { p: Row; brandName: string; brandHandle: string; productTitle: string | null; adminName: string | null; deciderName: string | null }

function selectListed(d: Executor) {
  return d
    .select({ p: productProposals, brandName: brands.name, brandHandle: brands.handle, productTitle: catalogProducts.title, adminName: adminUser.name, deciderName: decider.name, total: sql<number>`count(*) over ()`.mapWith(Number) })
    .from(productProposals)
    .innerJoin(brands, eq(brands.id, productProposals.brandId))
    .leftJoin(catalogProducts, eq(catalogProducts.id, productProposals.productId))
    .leftJoin(adminUser, eq(adminUser.id, productProposals.createdByAdminId))
    .leftJoin(decider, eq(decider.id, productProposals.decidedByUserId))
}

const payloadOf = (p: Row) => p.payload as ProposalChanges
const fieldsOf = (p: Row): ProposalField[] => (p.kind === "new" ? [] : PROPOSAL_FIELDS.filter((f) => f in payloadOf(p)))

function firstImageKey(p: Row, current?: ProductView | null) {
  const images = (payloadOf(p).images ?? current?.images ?? []) as ProductView["images"]
  const i = images[0]
  return i ? (i.id ?? i.mediaId ?? null) : null
}

async function imageSources(d: Executor, keys: string[], as: "brand" | "admin"): Promise<Record<string, ProposalImageDto>> {
  const out: Record<string, ProposalImageDto> = {}
  const unique = [...new Set(keys.filter(Boolean))]
  if (!unique.length) return out
  const imgs = await d.select().from(catalogImages).where(inArray(catalogImages.id, unique))
  for (const i of imgs) out[i.id] = { key: i.id, src: i.mediaId ? mediaSrc(i.mediaId, as) : (i.path ?? "/media/missing.svg"), alt: i.alt, width: i.width, height: i.height }
  const media = await d.select({ id: mediaAssets.id, width: mediaAssets.width, height: mediaAssets.height }).from(mediaAssets).where(inArray(mediaAssets.id, unique))
  for (const m of media) out[m.id] ??= { key: m.id, src: mediaSrc(m.id, as), alt: "", width: m.width, height: m.height }
  return out
}

function summaryOf(r: Listed, admin: boolean, covers: Record<string, ProposalImageDto>): ProposalSummaryDto {
  const p = r.p
  const key = firstImageKey(p)
  return {
    id: p.id,
    kind: p.kind as ProposalKind,
    status: p.status as ProposalStatus,
    brand: { id: p.brandId, name: r.brandName, handle: r.brandHandle },
    productId: p.productId,
    title: (p.kind === "new" ? (payloadOf(p).title ?? r.productTitle) : r.productTitle) ?? "Product",
    cover: key ? (covers[key]?.src ?? null) : null,
    note: p.note,
    fields: fieldsOf(p),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    decidedAt: p.decidedAt?.toISOString() ?? null,
    declineReason: p.declineReason,
    ...(admin ? { createdBy: { id: p.createdByAdminId, name: r.adminName ?? "Admin" }, decidedBy: p.decidedByUserId ? { name: r.deciderName ?? "Brand member" } : null, supersedesId: p.supersedesId } : {}),
  }
}

async function detailOf(d: Executor, r: Listed, as: "brand" | "admin"): Promise<ProposalDetailDto> {
  const p = r.p
  const state = p.kind === "edit" && p.productId ? await productState(d, p.productId) : null
  const current = state?.view ?? null
  const payload = payloadOf(p)
  const base = (p.base ?? {}) as ProposalChanges
  const proposed = p.kind === "new" ? normalize(payload as ProductView) : current ? applyChanges(current, payload) : normalize({ ...(payload as ProductView) })
  const conflicts = p.kind === "edit" && current && p.status === "pending" ? changedSince(base, current) : []
  const stockDelta = p.kind === "edit" ? { ...(payload.stock ?? {}) } : {}
  // Stock is a change, not a count: while waiting it reads from the count now (sales since are kept).
  const stockBefore = p.status === "pending" && current ? Object.fromEntries(Object.keys(stockDelta).filter((id) => id in current.stock).map((id) => [id, current.stock[id]])) : { ...(base.stock ?? {}) }
  const changes: ProposalChangeDto[] =
    p.kind === "edit"
      ? fieldsOf(p).map((f) =>
          f === "stock"
            ? { field: f, label: proposalFieldLabels[f], before: stockBefore, after: stockAfter(stockBefore, stockDelta), changedSince: false }
            : { field: f, label: proposalFieldLabels[f], before: base[f] ?? null, after: payload[f] ?? null, ...(conflicts.includes(f) && current ? { now: current[f] } : {}), changedSince: conflicts.includes(f) },
        )
      : []
  const imageKeys = [...proposed.images, ...(current?.images ?? []), ...((base.images as ProductView["images"]) ?? [])].map((i) => i.id ?? i.mediaId ?? "")
  const images = await imageSources(d, imageKeys, as)
  const cols = await d.select({ id: catalogCollections.id, name: catalogCollections.name }).from(catalogCollections).where(eq(catalogCollections.brandId, p.brandId))
  const variantNames: Record<string, string> = {}
  for (const v of state?.kids.variants.get(state.row.id) ?? []) variantNames[v.id] = variantLabelOf(v.options) || v.sku
  const b = await loadBrand(d, p.brandId)
  const willPublish = p.kind === "new" ? (b ? await brandMayPublish(d, b, proposed) : false) : null
  let productStatus: string | null = state?.row.status ?? null
  if (!state && p.productId) {
    const [row] = await d.select({ status: catalogProducts.status }).from(catalogProducts).where(eq(catalogProducts.id, p.productId)).limit(1)
    productStatus = row?.status ?? null
  }
  return {
    ...summaryOf(r, as === "admin", images),
    currency: state?.row.currency ?? b?.currency ?? "USD",
    proposed,
    current,
    currentVersion: state?.row.version ?? null,
    changes,
    conflicts,
    images,
    names: { collections: Object.fromEntries(cols.map((c) => [c.id, c.name])), variants: variantNames },
    stockDelta,
    willPublish,
    productStatus,
  }
}

/** Whether a new product made from a suggestion goes live on acceptance, like one the brand published itself. */
async function brandMayPublish(d: Executor, brand: { id: string; reviewStatus: string }, product: { images: unknown[]; variants: unknown[] }) {
  return brand.reviewStatus !== "restricted" && !(await brandUnderReview(d, brand.id)) && product.images.length > 0 && product.variants.length > 0
}

async function listedById(d: Executor, id: string) {
  const [r] = await selectListed(d).where(eq(productProposals.id, id)).limit(1)
  return r ?? null
}

async function covers(d: Executor, rows: Listed[], as: "brand" | "admin") {
  return imageSources(d, rows.map((r) => firstImageKey(r.p) ?? ""), as)
}

/** Edits without a photo change show the product's own cover. */
async function productCovers(d: Executor, rows: Listed[], as: "brand" | "admin") {
  const ids = rows.filter((r) => r.p.kind === "edit" && r.p.productId && !firstImageKey(r.p)).map((r) => r.p.productId!)
  if (!ids.length) return new Map<string, string>()
  const imgs = await d.select().from(catalogImages).where(and(inArray(catalogImages.productId, ids), eq(catalogImages.position, 0)))
  const m = new Map<string, string>()
  for (const i of imgs) {
    const src = i.mediaId ? mediaSrc(i.mediaId, as) : (i.path ?? null)
    if (src) m.set(i.productId, src)
  }
  return m
}

async function summaries(d: Executor, rows: Listed[], admin: boolean) {
  const as = admin ? "admin" : "brand"
  const c = await covers(d, rows, as)
  const pc = await productCovers(d, rows, as)
  return rows.map((r) => {
    const s = summaryOf(r, admin, c)
    if (!s.cover && r.p.productId) s.cover = pc.get(r.p.productId) ?? null
    return s
  })
}

/* ------------------------------------------------------------------ side effects */

async function announce(p: Pick<Row, "id" | "brandId" | "status">) {
  await publish(channels.brand(p.brandId), "proposal.updated", { proposalId: p.id, status: p.status })
  await publish(channels.admin, "proposal.updated", { proposalId: p.id, status: p.status })
}

/** Tells the brand (Studio notification + email to members who can manage products). */
async function tellBrand(tx: Executor, p: Row, productTitle: string | null) {
  const href = studioProposalHref(p.id)
  await notify({ kind: "brand", id: p.brandId }, { key: brandNoticeKey(p.id), template: p.kind === "new" ? "proposal.new_for_brand" : "proposal.edit_for_brand", vars: { product: productTitle ?? "a product" }, href })
  await emailBrandMembersWith(tx as never, p.brandId, "content.publish", "product_suggestion", { kind: p.kind, url: href, ...(productTitle ? { product: productTitle } : {}), ...(p.note ? { note: p.note } : {}) }, `proposal:${p.id}`)
}

/** Removes the brand's notification for a proposal that's no longer waiting (withdrawn or replaced). */
async function dropBrandNotice(tx: Executor, p: Pick<Row, "id" | "brandId">) {
  const rows = await tx
    .delete(notifications)
    .where(and(eq(notifications.recipientKind, "brand"), eq(notifications.recipientId, p.brandId), eq(notifications.eventKey, brandNoticeKey(p.id))))
    .returning({ key: notifications.eventKey })
  if (rows.length) await announceRemovedNotifications(rows.map((r) => ({ kind: "brand", id: p.brandId, key: r.key })))
}

/* ------------------------------------------------------------------ admin */

/** Builds the stored payload and base for a body (validated against the brand and, for edits, the product). */
async function prepare(d: Executor, kind: ProposalKind, brand: { id: string; name: string }, productId: string | null, body: ProposalProductBody) {
  const brandId = brand.id
  if (kind === "new") {
    await checkBody(d, brandId, body, {})
    const view = viewOf({ ...body, stock: {} })
    return { payload: view as Record<string, unknown>, base: null, baseVersion: null, baseUpdatedAt: null, title: view.title }
  }
  const state = await productState(d, productId!)
  if (!state || state.row.brandId !== brandId) throw notFound("That product isn't on Yard.")
  if (state.row.status === "archived") throw rule("This product is archived. The brand has to restore it first.")
  // Diffed against the product now, so the form must have loaded this version (or an edit the brand made meanwhile would be reverted).
  if (body.expectedVersion === undefined) throw badRequest({ expectedVersion: "Reload the product and try again." })
  if (body.expectedVersion !== state.row.version) throw conflict(`${brand.name} changed this product since you opened it. Reload to see their changes.`)
  const kids = state.kids
  await checkBody(d, brandId, body, {
    productId: state.row.id,
    imageIds: new Set((kids.images.get(state.row.id) ?? []).map((i) => i.id)),
    variantIds: new Set((kids.variants.get(state.row.id) ?? []).filter((v) => v.status === "active").map((v) => v.id)),
  })
  const diff = diffProposal(state.view, viewOf(body), { defaultProcessing: await defaultProcessing(d, brandId), stockDelta: body.stockDelta })
  if (!diff.fields.length) throw badRequest({ product: "Change at least one field to suggest it." }, "Nothing has changed yet.")
  return { payload: diff.changes as Record<string, unknown>, base: diff.base as Record<string, unknown>, baseVersion: state.row.version, baseUpdatedAt: state.row.updatedAt, title: state.row.title }
}

const alreadyWaiting = () => conflict("There's already a suggestion waiting for this product. Update that one instead.")
const isUniqueViolation = (e: unknown): boolean => {
  const err = e as { code?: string; cause?: unknown } | null
  return !!err && (err.code === "23505" || isUniqueViolation(err.cause))
}

export async function createProposal(admin: AdminActor, body: AdminProposalCreateBody, ipHash: string | null) {
  return withTx(async (tx) => {
    let brandId: string
    let productId: string | null = null
    if (body.kind === "new") {
      refuseSampleBrand(body.brandId)
      brandId = body.brandId
    } else {
      refuseSampleProduct(body.productId)
      const [p] = await tx.select({ id: catalogProducts.id, brandId: catalogProducts.brandId }).from(catalogProducts).where(eq(catalogProducts.id, body.productId)).limit(1)
      if (!p) throw notFound("That product isn't on Yard.")
      refuseSampleBrand(p.brandId)
      brandId = p.brandId
      productId = p.id
      const [open] = await tx.select({ id: productProposals.id }).from(productProposals).where(and(eq(productProposals.productId, p.id), eq(productProposals.kind, "edit"), eq(productProposals.status, "pending"))).limit(1)
      if (open) throw alreadyWaiting()
    }
    const brand = await loadBrand(tx, brandId)
    if (!brand) throw notFound("That brand isn't on Yard.")
    if (brand.reviewStatus === "suspended") throw rule(`${brand.name} is suspended, so it can't take suggestions.`)
    const prep = await prepare(tx, body.kind, brand, productId, body.product)
    const now = new Date()
    let row: Row
    try {
      ;[row] = await tx
        .insert(productProposals)
        .values({ id: newId("pp"), brandId, productId, kind: body.kind, payload: prep.payload, base: prep.base, baseVersion: prep.baseVersion, baseUpdatedAt: prep.baseUpdatedAt, note: body.note?.trim() || null, status: "pending", createdByAdminId: admin.userId, createdAt: now, updatedAt: now })
        .returning()
    } catch (e) {
      // Two suggestions for the same product at once: the second hits the one-pending-edit index.
      if (isUniqueViolation(e)) throw alreadyWaiting()
      throw e
    }
    await writeAudit({ actor: adminAudit(admin), action: "catalog.proposal_created", target: prep.title, subjectType: "product_proposal", subjectId: row.id, brandId, ipHash, meta: { kind: body.kind, productId, fields: fieldsOf(row) } })
    await tellBrand(tx, row, prep.title)
    await announce(row)
    return { proposal: await detailOf(tx, (await listedById(tx, row.id))!, "admin") }
  })
}

/** Replaces a pending proposal with a new version: the old one is marked superseded, the brand is told again. */
export async function reviseProposal(admin: AdminActor, id: string, body: AdminProposalReviseBody, ipHash: string | null) {
  return withTx(async (tx) => {
    const old = await loadProposal(tx, id)
    if (!old) throw notFound("That suggestion doesn't exist.")
    if (old.status !== "pending") throw conflict("This suggestion was already answered or withdrawn, so it can't be updated.")
    const brand = await loadBrand(tx, old.brandId)
    if (!brand) throw notFound("That brand isn't on Yard.")
    const prep = await prepare(tx, old.kind as ProposalKind, brand, old.productId, body.product)
    const now = new Date()
    const [gone] = await tx.update(productProposals).set({ status: "superseded", updatedAt: now }).where(and(eq(productProposals.id, id), eq(productProposals.status, "pending"))).returning({ id: productProposals.id })
    if (!gone) throw conflict("This suggestion was already answered or withdrawn, so it can't be updated.")
    const [row] = await tx
      .insert(productProposals)
      .values({ id: newId("pp"), brandId: old.brandId, productId: old.productId, kind: old.kind, payload: prep.payload, base: prep.base, baseVersion: prep.baseVersion, baseUpdatedAt: prep.baseUpdatedAt, note: body.note === undefined ? old.note : body.note.trim() || null, status: "pending", createdByAdminId: admin.userId, supersedesId: old.id, createdAt: now, updatedAt: now })
      .returning()
    await writeAudit({ actor: adminAudit(admin), action: "catalog.proposal_updated", target: prep.title, subjectType: "product_proposal", subjectId: row.id, brandId: old.brandId, ipHash, meta: { kind: old.kind, supersedes: old.id, productId: old.productId, fields: fieldsOf(row) } })
    await dropBrandNotice(tx, old)
    await tellBrand(tx, row, prep.title)
    await announce({ ...old, status: "superseded" })
    await announce(row)
    return { proposal: await detailOf(tx, (await listedById(tx, row.id))!, "admin") }
  })
}

export async function withdrawProposal(admin: AdminActor, id: string, ipHash: string | null) {
  return withTx(async (tx) => {
    const now = new Date()
    const [row] = await tx.update(productProposals).set({ status: "withdrawn", updatedAt: now, decidedAt: now }).where(and(eq(productProposals.id, id), eq(productProposals.status, "pending"))).returning()
    if (!row) {
      if (!(await loadProposal(tx, id))) throw notFound("That suggestion doesn't exist.")
      throw conflict("Only a waiting suggestion can be withdrawn.")
    }
    const r = (await listedById(tx, row.id))!
    await writeAudit({ actor: adminAudit(admin), action: "catalog.proposal_withdrawn", target: summaryOf(r, true, {}).title, subjectType: "product_proposal", subjectId: row.id, brandId: row.brandId, ipHash, meta: { kind: row.kind, productId: row.productId } })
    await dropBrandNotice(tx, row)
    await announce(row)
    return { proposal: await detailOf(tx, r, "admin") }
  })
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)

async function statusCounts(d: Executor, where: SQL | undefined) {
  const rows = await d.select({ status: productProposals.status, n: sql<number>`count(*)::int` }).from(productProposals).where(where).groupBy(productProposals.status)
  const counts = Object.fromEntries(PROPOSAL_STATUSES.map((s) => [s, 0])) as Record<ProposalStatus, number>
  for (const r of rows) counts[r.status as ProposalStatus] = Number(r.n)
  return counts
}

export async function listAdminProposals(q: { status: ProposalStatus | "all"; brandId?: string; q?: string; limit: number; offset: number }): Promise<ProposalListDto> {
  const d = await db()
  const brandWhere = q.brandId ? eq(productProposals.brandId, q.brandId) : undefined
  const like = q.q?.trim() ? `%${escapeLike(q.q.trim())}%` : null
  const where = and(
    brandWhere,
    q.status === "all" ? ne(productProposals.status, "superseded") : eq(productProposals.status, q.status),
    like ? or(ilike(brands.name, like), ilike(brands.handle, like), ilike(catalogProducts.title, like), sql`${productProposals.payload} ->> 'title' ilike ${like}`) : undefined,
  )
  const rows = await selectListed(d).where(where).orderBy(desc(productProposals.updatedAt), asc(productProposals.id)).limit(q.limit).offset(q.offset)
  const total = rows[0]?.total ?? 0
  return { items: await summaries(d, rows, true), total, counts: await statusCounts(d, brandWhere), nextOffset: q.offset + rows.length < total ? q.offset + rows.length : null }
}

export async function getAdminProposal(id: string) {
  const d = await db()
  const r = await listedById(d, id)
  if (!r) throw notFound("That suggestion doesn't exist.")
  return { proposal: await detailOf(d, r, "admin") }
}

/** Studio DTO images are brand-scoped (?as=brand); the admin form reads them as an admin. */
const asAdmin = <T extends { images: { src: string }[] }>(p: T): T => ({ ...p, images: p.images.map((i) => ({ ...i, src: i.src.replace(/\?as=brand$/, "?as=admin") })) })

export async function adminProposalContext(q: { brandId?: string; productId?: string }): Promise<AdminProposalContextDto> {
  const d = await db()
  let brandId = q.brandId
  let product: AdminProposalContextDto["product"] = null
  let pendingId: string | null = null
  if (q.productId) {
    refuseSampleProduct(q.productId)
    const [p] = await d.select().from(catalogProducts).where(eq(catalogProducts.id, q.productId)).limit(1)
    if (!p) throw notFound("That product isn't on Yard.")
    brandId = p.brandId
    product = asAdmin(toStudioProduct(p, await loadChildren(d, [p.id])))
    const [open] = await d.select({ id: productProposals.id }).from(productProposals).where(and(eq(productProposals.productId, p.id), eq(productProposals.kind, "edit"), eq(productProposals.status, "pending"))).limit(1)
    pendingId = open?.id ?? null
  }
  if (!brandId) throw badRequest({ brandId: "Choose a brand." })
  refuseSampleBrand(brandId)
  const brand = await loadBrand(d, brandId)
  if (!brand) throw notFound("That brand isn't on Yard.")
  const rows = await d.select().from(catalogProducts).where(and(eq(catalogProducts.brandId, brandId), ne(catalogProducts.status, "archived"))).orderBy(desc(catalogProducts.updatedAt)).limit(300)
  const kids = await loadChildren(
    d,
    rows.map((r) => r.id),
  )
  const cols = await d.select().from(catalogCollections).where(eq(catalogCollections.brandId, brandId)).orderBy(asc(catalogCollections.position), asc(catalogCollections.name))
  return {
    brand: { id: brand.id, name: brand.name, handle: brand.handle, currency: brand.currency, country: brand.country, city: brand.city, processingDays: (await defaultProcessing(d, brandId)) ?? [1, 3] },
    products: rows.map((r) => asAdmin(toStudioProduct(r, kids))),
    collections: cols.map((c) => ({ id: c.id, handle: c.handle, name: c.name, description: c.description, status: c.status, position: c.position, imageMediaId: c.imageMediaId, imageSrc: c.imageMediaId ? mediaSrc(c.imageMediaId, "admin") : c.imagePath, productIds: [], version: c.version, updatedAt: c.updatedAt.toISOString() })),
    product,
    pendingId,
  }
}

/* ------------------------------------------------------------------ studio */

async function loadOwnProposal(d: Executor, actor: BrandActor, id: string, opts: { latest?: boolean } = {}) {
  let r = await listedById(d, id)
  // Another brand's suggestion doesn't exist for this brand.
  if (!r || r.p.brandId !== actor.brandId) throw notFound("That suggestion isn't for your brand.")
  if (r.p.status === "superseded") {
    // Reading an old version (an earlier email's link) shows the version that replaced it; answering one is a 409.
    if (!opts.latest) throw conflict("Yard updated this suggestion. Reload to see the latest version.")
    for (let i = 0; i < 50 && r.p.status === "superseded"; i++) {
      const [next] = await d.select({ id: productProposals.id }).from(productProposals).where(eq(productProposals.supersedesId, r.p.id)).limit(1)
      const n = next ? await listedById(d, next.id) : null
      if (!n || n.p.brandId !== actor.brandId) break
      r = n
    }
  }
  return r
}

export async function listStudioProposals(actor: BrandActor, q: { status: "pending" | "all" }): Promise<ProposalListDto> {
  const d = await db()
  const brandWhere = and(eq(productProposals.brandId, actor.brandId), ne(productProposals.status, "superseded"))
  const rows = await selectListed(d)
    .where(and(brandWhere, q.status === "pending" ? eq(productProposals.status, "pending") : undefined))
    .orderBy(desc(productProposals.createdAt), asc(productProposals.id))
    .limit(100)
  const total = rows[0]?.total ?? 0
  return { items: await summaries(d, rows, false), total, counts: await statusCounts(d, brandWhere), nextOffset: null }
}

export async function getStudioProposal(actor: BrandActor, id: string) {
  const d = await db()
  return { proposal: await detailOf(d, await loadOwnProposal(d, actor, id, { latest: true }), "brand") }
}

/** Claims a pending proposal for a decision; a second decision (another tab, another member) is 409. */
async function claim(tx: Executor, actor: BrandActor, id: string, status: "accepted" | "declined", extra: Partial<typeof productProposals.$inferInsert> = {}) {
  await loadOwnProposal(tx, actor, id)
  const now = new Date()
  const [row] = await tx
    .update(productProposals)
    .set({ status, decidedByUserId: actor.userId, decidedAt: now, updatedAt: now, ...extra })
    .where(and(eq(productProposals.id, id), eq(productProposals.brandId, actor.brandId), eq(productProposals.status, "pending")))
    .returning()
  if (!row) throw conflict("This suggestion was already answered or withdrawn. Reload to see where it stands.")
  return row
}

async function tellAdmin(row: Row, actor: BrandActor, title: string, outcome: "accepted" | "declined") {
  await notify({ kind: "admin", id: row.createdByAdminId }, { key: `proposal.decided:${row.id}`, template: "proposal.decided_for_admin", vars: { brand: actor.brand.name, product: title, outcome }, href: adminProposalHref(row.id) })
}

export async function acceptProposal(actor: BrandActor, id: string, override: ProposalProductBody | undefined, ipHash: string | null) {
  return withTx(async (tx) => {
    const row = await claim(tx, actor, id, "accepted")
    let productId: string
    let published = false
    let title: string
    if (row.kind === "new") {
      const { stockDelta: _stock, expectedVersion: _version, ...own } = override ?? {}
      void _stock
      void _version
      const body = override ? productCreateBody.parse(own) : createBodyOf(normalize(payloadOf(row) as ProductView))
      const created = await createProduct(actor, body, ipHash)
      productId = created.product.id
      title = created.product.title
      // Live like a product the brand published itself, whenever the brand may publish it now.
      const mayPublish = await brandMayPublish(tx, { id: actor.brandId, reviewStatus: actor.brand.reviewStatus }, { images: created.product.images, variants: created.product.variants.filter((v) => v.status === "active") })
      if (mayPublish) {
        await setProductStatus(actor, productId, { action: "publish", expectedVersion: created.product.version }, ipHash)
        published = true
      }
      await tx.update(productProposals).set({ productId }).where(eq(productProposals.id, row.id))
    } else {
      productId = row.productId!
      const state = await productState(tx, productId)
      if (!state || state.row.brandId !== actor.brandId) throw notFound("That product isn't in your catalogue.")
      if (state.row.status === "archived") throw rule("Restore this product before accepting changes to it.")
      title = state.row.title
      let changes = payloadOf(row)
      if (override) changes = diffProposal(state.view, viewOf(override), { defaultProcessing: await defaultProcessing(tx, actor.brandId), stockDelta: override.stockDelta }).changes
      const { body, stockDelta } = updateBodyOf(changes)
      if (Object.keys(body).length) {
        // The brand's own form carries the version it loaded: someone else's edit since then is the usual 409.
        const updated = await updateProduct(actor, productId, productUpdateBody.parse({ ...body, expectedVersion: override?.expectedVersion ?? state.row.version }), ipHash)
        title = updated.product.title
      }
      // A change from the count the form opened with, like the Studio editor's save: sales since then are kept.
      for (const [variantId, qty] of Object.entries(stockDelta)) {
        if (!(variantId in state.view.stock) || !qty) continue
        await adjustStock(actor, variantId, { mode: "adjust", qty, reason: "adjustment", note: "Suggestion from Yard" }, ipHash)
      }
      published = state.row.status === "published"
    }
    await writeAudit({ actor: brandAudit(actor), action: "catalog.proposal_accepted", target: title, subjectType: "product_proposal", subjectId: row.id, brandId: actor.brandId, ipHash, meta: { kind: row.kind, productId, edited: !!override, published, fields: fieldsOf(row) } })
    await tellAdmin(row, actor, title, "accepted")
    await announce({ ...row, status: "accepted" })
    return { proposal: await detailOf(tx, (await listedById(tx, row.id))!, "brand"), productId, published }
  })
}

export async function declineProposal(actor: BrandActor, id: string, reason: string | undefined, ipHash: string | null) {
  return withTx(async (tx) => {
    const r = await loadOwnProposal(tx, actor, id)
    const row = await claim(tx, actor, id, "declined", { declineReason: reason?.trim() || null })
    const title = summaryOf(r, false, {}).title
    await writeAudit({ actor: brandAudit(actor), action: "catalog.proposal_declined", target: title, subjectType: "product_proposal", subjectId: row.id, brandId: actor.brandId, ipHash, reason: reason?.trim() || null, meta: { kind: row.kind, productId: row.productId } })
    await tellAdmin(row, actor, title, "declined")
    await announce({ ...row, status: "declined" })
    return { proposal: await detailOf(tx, (await listedById(tx, row.id))!, "brand") }
  })
}

/** Pending suggestions for the brand's Products page badge. */
export async function pendingProposalCount(brandId: string) {
  const d = await db()
  const [r] = await d.select({ n: sql<number>`count(*)::int` }).from(productProposals).where(and(eq(productProposals.brandId, brandId), eq(productProposals.status, "pending")))
  return Number(r?.n ?? 0)
}

/** Brands an admin can suggest a product to: by name or handle, not suspended (production leaves out the sample brands). */
export async function proposalBrands(q?: string) {
  const d = await db()
  const like = q?.trim() ? `%${escapeLike(q.trim())}%` : null
  const rows = await d
    .select({ id: brands.id, name: brands.name, handle: brands.handle, city: brands.city, reviewStatus: brands.reviewStatus })
    .from(brands)
    .where(and(ne(brands.reviewStatus, "suspended"), notSampleBrandSql(brands.id), like ? or(ilike(brands.name, like), ilike(brands.handle, like)) : undefined))
    .orderBy(asc(brands.name))
    .limit(30)
  return { brands: rows }
}
