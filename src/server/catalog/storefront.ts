import "server-only"
import { and, desc, eq, inArray } from "drizzle-orm"
import { writeAudit } from "../audit"
import { assertBrandMayPublish, type BrandActor } from "../auth/dal"
import { db, withTx, type Executor } from "../db"
import { catalogCollections, catalogProducts, storefrontDrafts, storefrontVersions } from "../db/schema/catalog"
import { badRequest, conflict, notFound, rule } from "../http/errors"
import { newId } from "../ids"
import type { StorefrontConfigInput } from "./contracts"
import { catalogChanged } from "./hooks"
import { assertBrandImages, brandUnderReview } from "./studio"

/**
 * Storefront drafts and versions. One draft per brand with a revision counter (a save names the
 * revision it edited: a stale one is 409, so two editors never overwrite each other silently).
 * Publishing snapshots the draft as an immutable version; it names the live version it expects,
 * so publishing over someone else's newer publish is 409 too.
 */

export const DEFAULT_STOREFRONT: StorefrontConfigInput = {
  template: "editorial",
  accent: "violet",
  typePreset: "condensed",
  intro: "",
  announcement: null,
  sections: [
    { id: "hero", type: "hero", enabled: true },
    { id: "featured", type: "featured-products", enabled: true, productIds: [] },
    { id: "collections", type: "collections", enabled: true, collectionIds: [] },
    { id: "all", type: "all-products", enabled: true },
  ],
}

const auditActor = (a: BrandActor) => ({ kind: "brand" as const, id: a.userId, name: a.name, role: a.role })

async function latestVersion(d: Executor, brandId: string) {
  const [v] = await d.select().from(storefrontVersions).where(eq(storefrontVersions.brandId, brandId)).orderBy(desc(storefrontVersions.version)).limit(1)
  return v ?? null
}

/** Every product, collection and cover id the config names must be this brand's. */
async function assertConfigRefs(d: Executor, brandId: string, config: StorefrontConfigInput, prefix = "config") {
  const fields: Record<string, string> = {}
  const productIds = new Set<string>()
  const collectionIds = new Set<string>()
  const ids = new Set<string>()
  config.sections.forEach((s, i) => {
    if (ids.has(s.id)) fields[`${prefix}.sections.${i}.id`] = "Each section needs its own id."
    ids.add(s.id)
    for (const p of s.productIds ?? []) productIds.add(p)
    for (const c of s.collectionIds ?? []) collectionIds.add(c)
  })
  if (productIds.size) {
    const rows = await d
      .select({ id: catalogProducts.id })
      .from(catalogProducts)
      .where(and(inArray(catalogProducts.id, [...productIds]), eq(catalogProducts.brandId, brandId)))
    const ok = new Set(rows.map((r) => r.id))
    config.sections.forEach((s, i) =>
      (s.productIds ?? []).forEach((p, k) => {
        if (!ok.has(p)) fields[`${prefix}.sections.${i}.productIds.${k}`] = "That piece isn't in your catalogue."
      }),
    )
  }
  if (collectionIds.size) {
    const rows = await d
      .select({ id: catalogCollections.id })
      .from(catalogCollections)
      .where(and(inArray(catalogCollections.id, [...collectionIds]), eq(catalogCollections.brandId, brandId)))
    const ok = new Set(rows.map((r) => r.id))
    config.sections.forEach((s, i) =>
      (s.collectionIds ?? []).forEach((c, k) => {
        if (!ok.has(c)) fields[`${prefix}.sections.${i}.collectionIds.${k}`] = "That collection isn't one of yours."
      }),
    )
  }
  if (Object.keys(fields).length) throw badRequest(fields)
  if (config.coverMediaId) await assertBrandImages(d, brandId, [config.coverMediaId], `${prefix}.coverMediaId`)
}

async function ensureDraft(d: Executor, actor: BrandActor) {
  const [draft] = await d.select().from(storefrontDrafts).where(eq(storefrontDrafts.brandId, actor.brandId)).limit(1)
  if (draft) return draft
  const live = await latestVersion(d, actor.brandId)
  const [created] = await d
    .insert(storefrontDrafts)
    .values({ brandId: actor.brandId, config: (live?.config ?? DEFAULT_STOREFRONT) as Record<string, unknown>, revision: 1, baseVersion: live?.version ?? 0, updatedBy: actor.userId })
    .onConflictDoNothing()
    .returning()
  if (created) return created
  const [again] = await d.select().from(storefrontDrafts).where(eq(storefrontDrafts.brandId, actor.brandId)).limit(1)
  return again
}

function draftDto(d: typeof storefrontDrafts.$inferSelect, liveVersion: number) {
  return { config: d.config, revision: d.revision, baseVersion: d.baseVersion, updatedAt: d.updatedAt.toISOString(), updatedBy: d.updatedBy, behindLive: d.baseVersion < liveVersion }
}

export async function getStudioStorefront(actor: BrandActor) {
  return withTx(async (tx) => {
    const draft = await ensureDraft(tx, actor)
    const versions = await tx
      .select({ version: storefrontVersions.version, publishedAt: storefrontVersions.publishedAt, publishedBy: storefrontVersions.publishedBy, note: storefrontVersions.note })
      .from(storefrontVersions)
      .where(eq(storefrontVersions.brandId, actor.brandId))
      .orderBy(desc(storefrontVersions.version))
      .limit(30)
    const live = await latestVersion(tx, actor.brandId)
    return {
      draft: draftDto(draft, live?.version ?? 0),
      live: live ? { version: live.version, config: live.config, publishedAt: live.publishedAt.toISOString() } : null,
      versions: versions.map((v) => ({ ...v, publishedAt: v.publishedAt.toISOString() })),
      underReview: await brandUnderReview(tx, actor.brandId),
    }
  })
}

export async function saveStorefrontDraft(actor: BrandActor, body: { config: StorefrontConfigInput; baseRevision: number }) {
  return withTx(async (tx) => {
    await assertConfigRefs(tx, actor.brandId, body.config)
    const draft = await ensureDraft(tx, actor)
    if (draft.revision !== body.baseRevision) throw conflict("Someone else saved this storefront since you opened it. Reload to see their changes.")
    const [row] = await tx
      .update(storefrontDrafts)
      .set({ config: body.config as Record<string, unknown>, revision: draft.revision + 1, updatedAt: new Date(), updatedBy: actor.userId })
      .where(and(eq(storefrontDrafts.brandId, actor.brandId), eq(storefrontDrafts.revision, draft.revision)))
      .returning()
    if (!row) throw conflict("Someone else saved this storefront since you opened it. Reload to see their changes.")
    const live = await latestVersion(tx, actor.brandId)
    return { draft: draftDto(row, live?.version ?? 0) }
  })
}

export async function publishStorefront(actor: BrandActor, body: { draftRevision: number; expectedVersion: number; note?: string }, ipHash: string | null) {
  assertBrandMayPublish(actor)
  return withTx(async (tx) => {
    if (await brandUnderReview(tx, actor.brandId)) throw rule("Yard is still reviewing your brand. You can publish once it's approved.")
    const draft = await ensureDraft(tx, actor)
    if (draft.revision !== body.draftRevision) throw conflict("The draft changed since you reviewed it. Check the latest draft, then publish.")
    const live = await latestVersion(tx, actor.brandId)
    const liveVersion = live?.version ?? 0
    if (liveVersion !== body.expectedVersion) throw conflict("Someone published a newer storefront since you opened it. Review the live version, then publish again.")
    // Re-check references at publish time: a product may have moved or a collection been deleted.
    await assertConfigRefs(tx, actor.brandId, draft.config as unknown as StorefrontConfigInput)
    const version = liveVersion + 1
    await tx.insert(storefrontVersions).values({ id: newId("sfv"), brandId: actor.brandId, version, config: draft.config, note: body.note ?? null, publishedBy: actor.userId })
    await tx.update(storefrontDrafts).set({ baseVersion: version }).where(eq(storefrontDrafts.brandId, actor.brandId))
    await writeAudit({ actor: auditActor(actor), action: "storefront.published", target: `${actor.brand.name} storefront v${version}`, subjectType: "storefront", subjectId: actor.brandId, brandId: actor.brandId, ipHash, meta: { version, draftRevision: draft.revision } })
    // The brand: the published cover (config.coverMediaId) becomes public, a replaced one private.
    catalogChanged({ brands: [actor.brandId] })
    return { version, publishedAt: new Date().toISOString() }
  })
}

/** Copies a published version back into the draft (not live until published). */
export async function restoreStorefrontVersion(actor: BrandActor, version: number, baseRevision: number, ipHash: string | null) {
  return withTx(async (tx) => {
    const [v] = await tx
      .select()
      .from(storefrontVersions)
      .where(and(eq(storefrontVersions.brandId, actor.brandId), eq(storefrontVersions.version, version)))
      .limit(1)
    if (!v) throw notFound("That storefront version doesn't exist.")
    const draft = await ensureDraft(tx, actor)
    if (draft.revision !== baseRevision) throw conflict("Someone else saved this storefront since you opened it. Reload to see their changes.")
    const [row] = await tx
      .update(storefrontDrafts)
      .set({ config: v.config, revision: draft.revision + 1, updatedAt: new Date(), updatedBy: actor.userId })
      .where(eq(storefrontDrafts.brandId, actor.brandId))
      .returning()
    await writeAudit({ actor: auditActor(actor), action: "storefront.version_restored_to_draft", target: `${actor.brand.name} storefront v${version}`, subjectType: "storefront", subjectId: actor.brandId, brandId: actor.brandId, ipHash, meta: { version } })
    const live = await latestVersion(tx, actor.brandId)
    return { draft: draftDto(row, live?.version ?? 0) }
  })
}

/** The full config of one version (Studio history preview). */
export async function getStorefrontVersion(actor: BrandActor, version: number) {
  const d = await db()
  const [v] = await d
    .select()
    .from(storefrontVersions)
    .where(and(eq(storefrontVersions.brandId, actor.brandId), eq(storefrontVersions.version, version)))
    .limit(1)
  if (!v) throw notFound("That storefront version doesn't exist.")
  return { version: v.version, config: v.config, note: v.note, publishedAt: v.publishedAt.toISOString(), publishedBy: v.publishedBy }
}
