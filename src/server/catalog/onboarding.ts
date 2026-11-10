import "server-only"
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm"
import type { z } from "zod"
import { countryTimeZone } from "@/lib/data/zones"
import { writeAudit } from "../audit"
import type { AdminActor, ShopperActor } from "../auth/dal"
import { db, withTx, type Executor } from "../db"
import { brandMembers, brands, mediaAssets } from "../db/schema"
import { brandOnboardings, catalogCategories, catalogImages, catalogOptions, catalogProducts, catalogVariants, ONBOARDING_STEPS, storefrontDrafts } from "../db/schema/catalog"
import { badRequest, conflict, notFound, rule } from "../http/errors"
import { newId } from "../ids"
import { createStarterShipping } from "../shipping/profile"
import { onboardingStepSchemas, type OnboardingStep } from "./contracts"
import { catalogChanged } from "./hooks"
import { moveStock } from "./stock"
import { DEFAULT_STOREFRONT } from "./storefront"
import { slugify } from "./studio"

/**
 * Brand onboarding (Studio wizard). A signed-in shopper saves the wizard step by step (each step
 * validated by its own schema; `revision` guards against two tabs overwriting each other). Submit
 * re-validates every step and, in one transaction, creates the brand (pending_review), the owner
 * membership, the storefront draft and the first product (draft). Nothing goes public until Yard
 * approves (reviewOnboarding, for the admin area to call). Payout details: only the last four
 * digits are kept here; full bank details go through LEDGER's encrypted flow after approval.
 */

type Data = Partial<{ [K in OnboardingStep]: z.output<(typeof onboardingStepSchemas)[K]> }>

const RESERVED = new Set([
  "admin", "studio", "brands", "brand", "shop", "drops", "drop", "categories", "category", "following", "wishlist", "search", "account",
  "sign-in", "signin", "sign-up", "signup", "login", "logout", "help", "support", "settings", "api", "checkout", "cart", "bag", "orders",
  "about", "terms", "privacy", "yard", "official", "stories", "collections", "products", "you", "new", "sale",
])

export type HandleStatus = "too-short" | "too-long" | "characters" | "hyphen" | "reserved" | "taken" | "available"

/** Handle rules (the wizard's own, plus server uniqueness against brands and other open applications). */
export async function handleStatus(handle: string, exceptOnboardingId?: string, exceptBrandId?: string | null): Promise<HandleStatus> {
  if (handle.length < 3) return "too-short"
  if (handle.length > 30) return "too-long"
  if (!/^[a-z0-9-]+$/.test(handle)) return "characters"
  if (handle.startsWith("-") || handle.endsWith("-") || handle.includes("--")) return "hyphen"
  if (RESERVED.has(handle)) return "reserved"
  const d = await db()
  const [b] = await d
    .select({ id: brands.id })
    .from(brands)
    .where(and(eq(brands.handle, handle), exceptBrandId ? ne(brands.id, exceptBrandId) : undefined))
    .limit(1)
  if (b) return "taken"
  const [o] = await d
    .select({ id: brandOnboardings.id })
    .from(brandOnboardings)
    .where(and(inArray(brandOnboardings.status, ["draft", "submitted"]), sql`${brandOnboardings.data} -> 'brand' ->> 'handle' = ${handle}`, exceptOnboardingId ? ne(brandOnboardings.id, exceptOnboardingId) : undefined))
    .limit(1)
  return o ? "taken" : "available"
}

const handleMessages: Record<Exclude<HandleStatus, "available">, string> = {
  "too-short": "Use at least 3 characters.",
  "too-long": "Use 30 characters or fewer.",
  characters: "Use lowercase letters, numbers and hyphens.",
  hyphen: "Hyphens go between words, one at a time.",
  reserved: "That handle is reserved. Try another.",
  taken: "Another brand already uses that handle.",
}

function dto(row: typeof brandOnboardings.$inferSelect) {
  return {
    id: row.id,
    status: row.status,
    currentStep: row.currentStep,
    completedSteps: row.completedSteps,
    data: row.data,
    revision: row.revision,
    brandId: row.brandId,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    reviewNote: row.status === "rejected" ? row.reviewNote : null,
    updatedAt: row.updatedAt.toISOString(),
  }
}

async function currentRow(d: Executor, userId: string) {
  const [row] = await d.select().from(brandOnboardings).where(eq(brandOnboardings.userId, userId)).orderBy(desc(brandOnboardings.createdAt)).limit(1)
  return row ?? null
}

export async function getOnboarding(actor: ShopperActor) {
  const row = await currentRow(await db(), actor.userId)
  return { onboarding: row ? dto(row) : null, steps: ONBOARDING_STEPS }
}

/** Discards only an unsubmitted draft that has not created a brand. */
export async function discardOnboarding(actor: ShopperActor) {
  return withTx(async (tx) => {
    const [row] = await tx.select().from(brandOnboardings).where(eq(brandOnboardings.userId, actor.userId)).orderBy(desc(brandOnboardings.createdAt)).for("update").limit(1)
    if (!row) return { discarded: false }
    if (row.status !== "draft" || row.brandId) throw rule("Only an unfinished application can be cleared. You can edit a rejected application or manage an approved brand in Studio.")
    await tx.delete(brandOnboardings).where(eq(brandOnboardings.id, row.id))
    return { discarded: true }
  })
}

/** The applicant's own image uploads (they have no brand yet). */
async function assertOwnImages(d: Executor, userId: string, ids: string[], field: string) {
  if (!ids.length) return
  const rows = await d
    .select({ id: mediaAssets.id, mime: mediaAssets.mime, moderation: mediaAssets.moderationStatus, purpose: mediaAssets.purpose })
    .from(mediaAssets)
    .where(and(inArray(mediaAssets.id, ids), eq(mediaAssets.ownerKind, "user"), eq(mediaAssets.ownerId, userId)))
  const ok = new Set(rows.filter((r) => r.mime.startsWith("image/") && r.moderation !== "removed" && r.purpose === "onboarding_image").map((r) => r.id))
  const fields: Record<string, string> = {}
  ids.forEach((id, i) => {
    if (!ok.has(id)) fields[`${field}.${i}`] = "That photo isn't one of your uploads."
  })
  if (Object.keys(fields).length) throw badRequest(fields)
}

async function validateStep(d: Executor, actor: ShopperActor, step: OnboardingStep, raw: unknown, row: typeof brandOnboardings.$inferSelect | null) {
  const parsed = onboardingStepSchemas[step].safeParse(raw)
  if (!parsed.success) throw parsed.error
  const data = parsed.data as Data[OnboardingStep]
  if (step === "brand") {
    const b = data as NonNullable<Data["brand"]>
    const status = await handleStatus(b.handle, row?.id, row?.brandId)
    if (status !== "available") throw badRequest({ "data.handle": handleMessages[status] })
    const [c] = await d.select({ slug: catalogCategories.slug }).from(catalogCategories).where(eq(catalogCategories.slug, b.category)).limit(1)
    if (!c) throw badRequest({ "data.category": "Choose the category you mostly sell in." })
    if (b.logoMediaId) await assertOwnImages(d, actor.userId, [b.logoMediaId], "data.logoMediaId")
  }
  if (step === "storefront") {
    const s = data as NonNullable<Data["storefront"]>
    if (!s.coverMediaId && !s.coverPath) throw badRequest({ "data.cover": "Choose a cover photo or upload your own." })
    if (s.coverPath?.includes("..")) throw badRequest({ "data.coverPath": "Choose a photo from the library." })
    if (s.coverMediaId) await assertOwnImages(d, actor.userId, [s.coverMediaId], "data.coverMediaId")
  }
  if (step === "business") {
    const b = data as NonNullable<Data["business"]>
    if (!(b.country in countryTimeZone)) throw badRequest({ "data.country": "Choose a country Yard sells in." })
    if (b.sellerType === "company" && b.legalName.trim().length < 2) throw badRequest({ "data.legalName": "Enter the registered business name." })
  }
  if (step === "product") {
    const p = data as NonNullable<Data["product"]>
    if (!p.images.length) throw badRequest({ "data.images": "Add at least one photo." })
    if (p.images.some((i) => "path" in i && i.path.includes(".."))) throw badRequest({ "data.images": "Choose photos from the library or your uploads." })
    await assertOwnImages(
      d,
      actor.userId,
      p.images.flatMap((i) => ("mediaId" in i ? [i.mediaId] : [])),
      "data.images",
    )
    if (new Set(p.sizes.map((s) => s.label.toLowerCase())).size !== p.sizes.length) throw badRequest({ "data.sizes": "Each size needs its own label." })
    if (!p.sizes.some((s) => s.stock > 0)) throw badRequest({ "data.stock": "Add stock to at least one size." })
  }
  if (step === "payments") {
    const p = data as NonNullable<Data["payments"]>
    if (p.processingMax < p.processingMin) throw badRequest({ "data.processingMax": "The longest time can't be shorter than the shortest." })
  }
  return data
}

/** Saves one step. Creates the application on the first save (revision 0). */
export async function saveOnboardingStep(actor: ShopperActor, step: OnboardingStep, body: { data: unknown; revision: number }) {
  return withTx(async (tx) => {
    let row = await currentRow(tx, actor.userId)
    if (row && (row.status === "submitted" || row.status === "approved")) throw rule(row.status === "submitted" ? "Your brand is with Yard for review, so it can't be edited right now." : "Your brand is approved. Make changes in Brand Studio.")
    const data = await validateStep(tx, actor, step, body.data, row)
    if (!row) {
      if (body.revision !== 0) throw conflict("This application changed in another tab. Reload to continue.")
      ;[row] = await tx
        .insert(brandOnboardings)
        .values({ id: newId("onb"), userId: actor.userId, status: "draft", currentStep: step, completedSteps: [step], data: { [step]: data }, revision: 1 })
        .returning()
      return { onboarding: dto(row) }
    }
    if (row.revision !== body.revision) throw conflict("This application changed in another tab. Reload to continue.")
    const completed = [...new Set([...row.completedSteps, step])].sort((a, b) => ONBOARDING_STEPS.indexOf(a as OnboardingStep) - ONBOARDING_STEPS.indexOf(b as OnboardingStep))
    const next = ONBOARDING_STEPS.find((s) => !completed.includes(s)) ?? "payments"
    const [updated] = await tx
      .update(brandOnboardings)
      .set({ data: { ...row.data, [step]: data }, completedSteps: completed, currentStep: next, revision: row.revision + 1, status: "draft", updatedAt: new Date() })
      .where(and(eq(brandOnboardings.id, row.id), eq(brandOnboardings.revision, row.revision)))
      .returning()
    if (!updated) throw conflict("This application changed in another tab. Reload to continue.")
    return { onboarding: dto(updated) }
  })
}

/** Submits the application for review: creates (or, after a rejection, updates) the brand and its first product. */
export async function submitOnboarding(actor: ShopperActor, body: { revision: number }, ipHash: string | null) {
  return withTx(async (tx) => {
    const row = await currentRow(tx, actor.userId)
    if (!row) throw notFound("Start your brand application first.")
    if (row.status === "submitted") return { onboarding: dto(row) }
    if (row.status === "approved") throw rule("Your brand is already approved.")
    if (row.revision !== body.revision) throw conflict("This application changed in another tab. Reload to continue.")
    const missing = ONBOARDING_STEPS.filter((s) => !(row.data as Record<string, unknown>)[s])
    if (missing.length) throw badRequest(Object.fromEntries(missing.map((s) => [s, "Finish this step first."])), "Some steps aren't finished yet.")
    // Re-validate every step against today's rules (a handle may have been taken meanwhile).
    const data: Data = {}
    for (const s of ONBOARDING_STEPS) (data as Record<string, unknown>)[s] = await validateStep(tx, actor, s, (row.data as Record<string, unknown>)[s], row)
    const brand = data.brand!
    const business = data.business!
    const store = data.storefront!
    const product = data.product!
    const payments = data.payments!

    const now = new Date()
    const brandValues = {
      handle: brand.handle,
      name: brand.name.trim(),
      city: business.city.trim(),
      citySlug: slugify(business.city),
      country: business.country,
      currency: business.currency,
      categories: [brand.category],
      timeZone: (countryTimeZone as Record<string, string>)[business.country] ?? "UTC",
    }
    let brandId = row.brandId
    if (brandId) {
      // A resubmission never lifts an admin's suspension or restriction: only an admin can.
      const [current] = await tx.select({ reviewStatus: brands.reviewStatus }).from(brands).where(eq(brands.id, brandId)).for("update").limit(1)
      if (current && (current.reviewStatus === "suspended" || current.reviewStatus === "restricted"))
        throw rule("Your brand is on hold by Yard, so it can't be resubmitted. Contact Yard support.")
      await tx
        .update(brands)
        .set({ ...brandValues, reviewStatus: "pending_review" })
        .where(eq(brands.id, brandId))
    } else {
      brandId = newId("b")
      await tx.insert(brands).values({ id: brandId, ...brandValues, verified: false, reviewStatus: "pending_review", joinedAt: now.toISOString().slice(0, 10), followersBase: 0 })
      await tx.insert(brandMembers).values({ id: newId("tm"), brandId, userId: actor.userId, role: "owner", status: "active" })
    }

    // Storefront draft from the wizard's choices (published only after approval).
    const config = {
      ...DEFAULT_STOREFRONT,
      template: store.template,
      accent: store.accent,
      typePreset: store.typePreset,
      intro: brand.description,
      ...(store.coverMediaId ? { coverMediaId: store.coverMediaId } : {}),
      ...(store.coverPath ? { coverPath: store.coverPath } : {}),
      mark: { text: brand.markText ?? brand.name.slice(0, 2).toUpperCase(), style: brand.markStyle },
    }
    await tx
      .insert(storefrontDrafts)
      .values({ brandId, config, revision: 1, baseVersion: 0, updatedBy: actor.userId })
      .onConflictDoUpdate({ target: storefrontDrafts.brandId, set: { config, revision: sql`${storefrontDrafts.revision} + 1`, updatedAt: now, updatedBy: actor.userId } })

    // The first product, as a draft, once (a resubmission keeps the one already created).
    const [existingProduct] = await tx.select({ id: catalogProducts.id }).from(catalogProducts).where(eq(catalogProducts.brandId, brandId)).limit(1)
    if (!existingProduct) {
      const productId = newId("p")
      let slug = slugify(`${brand.handle}-${product.name}`)
      const [taken] = await tx.select({ id: catalogProducts.id }).from(catalogProducts).where(eq(catalogProducts.slug, slug)).limit(1)
      if (taken) slug = `${slug}-${Date.now().toString(36)}`
      await tx.insert(catalogProducts).values({
        id: productId,
        brandId,
        slug,
        title: product.name.trim(),
        description: product.description,
        categorySlug: brand.category,
        priceMinor: product.priceMinor,
        currency: business.currency,
        status: "draft",
        processingMin: payments.processingMin,
        processingMax: payments.processingMax,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      await tx.insert(catalogOptions).values({ id: newId("po"), productId, name: "Size", values: product.sizes.map((s) => ({ value: s.label })), position: 0 })
      for (const [position, s] of product.sizes.entries()) {
        const variantId = newId("pv")
        await tx.insert(catalogVariants).values({ id: variantId, productId, brandId, sku: onboardingSku(brand.handle, product.name, s.label), options: { Size: s.label }, position })
        if (s.stock > 0) await moveStock(tx, { variantId, brandId, delta: s.stock, reason: "adjustment", note: "Opening stock (onboarding)", actor: { kind: "shopper", id: actor.userId } })
      }
      if (product.images.length)
        await tx.insert(catalogImages).values(product.images.map((img, position) => ({ id: newId("pi"), productId, brandId: brandId!, mediaId: "mediaId" in img ? img.mediaId : null, path: "path" in img ? img.path : null, alt: img.alt || product.name, position })))
    }

    const [updated] = await tx
      .update(brandOnboardings)
      .set({ status: "submitted", brandId, submittedAt: now, currentStep: "payments", revision: row.revision + 1, updatedAt: now, reviewNote: null })
      .where(eq(brandOnboardings.id, row.id))
      .returning()
    await writeAudit({ actor: { kind: "shopper", id: actor.userId, name: actor.name }, action: "onboarding.submitted", target: brand.name, subjectType: "brand_onboarding", subjectId: row.id, brandId, ipHash, meta: { handle: brand.handle, country: business.country, currency: business.currency, resubmission: !!row.brandId } })
    catalogChanged({})
    return { onboarding: dto(updated) }
  })
}

/** Admin queue: submitted applications, oldest first. For the admin area's route. */
export async function listSubmittedOnboardings(limit = 50) {
  const d = await db()
  const rows = await d.select().from(brandOnboardings).where(eq(brandOnboardings.status, "submitted")).orderBy(brandOnboardings.submittedAt).limit(Math.min(200, limit))
  return { onboardings: rows.map(dto) }
}

/** A first-product SKU within Studio's 40-character limit (a longer one would block every later save in the editor); the size stays whole. */
export function onboardingSku(handle: string, name: string, size: string) {
  const tail = `-${slugify(size)}`
  return `${`${handle}-${slugify(name).slice(0, 20)}`.slice(0, 40 - tail.length).replace(/-+$/, "")}${tail}`.toUpperCase()
}

/**
 * Admin decision on a submitted application (for the admin area's route; brands.restrict
 * permission suggested). Approve: the brand becomes verified, so its products and storefront can
 * be published. Reject: the applicant can edit and resubmit; the note is shown to them.
 */
export async function reviewOnboarding(actor: AdminActor, input: { onboardingId: string; decision: "approve" | "reject"; note?: string; ipHash?: string | null }) {
  return withTx(async (tx) => {
    const [row] = await tx.select().from(brandOnboardings).where(eq(brandOnboardings.id, input.onboardingId)).limit(1)
    if (!row) throw notFound("That application doesn't exist.")
    if (row.status !== "submitted" || !row.brandId) throw rule("Only submitted applications can be reviewed.")
    if (input.decision === "reject" && !input.note?.trim()) throw badRequest({ note: "Tell the brand what to change." })
    if (input.decision === "approve") {
      const [brand] = await tx.select({ reviewStatus: brands.reviewStatus }).from(brands).where(eq(brands.id, row.brandId)).for("update").limit(1)
      if (brand && (brand.reviewStatus === "suspended" || brand.reviewStatus === "restricted"))
        throw rule(`Yard has ${brand.reviewStatus === "suspended" ? "suspended" : "restricted"} this brand, so its application can't be approved. Reinstate the brand from Brands first.`)
    }
    const now = new Date()
    await tx
      .update(brandOnboardings)
      .set({ status: input.decision === "approve" ? "approved" : "rejected", reviewedAt: now, reviewedBy: actor.userId, reviewNote: input.note?.slice(0, 1000) ?? null, updatedAt: now, revision: row.revision + 1 })
      .where(eq(brandOnboardings.id, row.id))
    if (input.decision === "approve") {
      const [brand] = await tx.update(brands).set({ reviewStatus: "verified" }).where(eq(brands.id, row.brandId)).returning({ id: brands.id, country: brands.country, city: brands.city, currency: brands.currency })
      const data = row.data as { brand?: { logoMediaId?: string | null }; storefront?: { coverMediaId?: string | null }; product?: { images?: { mediaId?: string }[] } }
      const mediaIds = [...new Set([data.storefront?.coverMediaId, ...(data.product?.images ?? []).map((image) => image.mediaId)].filter((id): id is string => !!id))]
      if (mediaIds.length) {
        await tx
          .update(mediaAssets)
          .set({ ownerKind: "brand", ownerId: row.brandId, brandId: row.brandId })
          .where(and(inArray(mediaAssets.id, mediaIds), eq(mediaAssets.ownerKind, "user"), eq(mediaAssets.ownerId, row.userId), eq(mediaAssets.purpose, "onboarding_image")))
      }
      // Approved brands can sell at once: they start with shipping from their application (editable in Studio).
      const payments = (row.data as { payments?: { processingMin?: number; processingMax?: number; delivery?: string[] } }).payments
      if (brand) await createStarterShipping(brand, { handling: [payments?.processingMin ?? 1, payments?.processingMax ?? 3], delivery: payments?.delivery ?? ["domestic"] })
    }
    await writeAudit({
      actor: { kind: "admin", id: actor.userId, name: actor.name, role: actor.role },
      action: input.decision === "approve" ? "onboarding.approved" : "onboarding.rejected",
      target: (row.data as { brand?: { name?: string } }).brand?.name ?? row.brandId,
      subjectType: "brand_onboarding",
      subjectId: row.id,
      brandId: row.brandId,
      reason: input.note ?? null,
      ipHash: input.ipHash ?? null,
    })
    catalogChanged({ brands: [row.brandId] })
    return { onboardingId: row.id, status: input.decision === "approve" ? "approved" : "rejected", brandId: row.brandId }
  })
}
