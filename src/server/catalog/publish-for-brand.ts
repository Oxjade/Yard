import "server-only"
import { and, asc, eq, sql } from "drizzle-orm"
import { brandRolePermissions } from "@/lib/permissions"
import { payoutAccountNeededToSell } from "@/lib/sell-rule"
import { acceptEachSuggestion, claimGoLivePlan, publishChecklist, publishForBrandBlock, publishForBrandOutcome, suggestionStillFits, type PublishForBrandFacts } from "@/lib/publish-for-brand"
import { writeAudit } from "../audit"
import type { AdminActor, BrandActor } from "../auth/dal"
import { db, withTx, type Executor, type Tx } from "../db"
import { brands } from "../db/schema"
import { catalogProducts, productProposals, storefrontDrafts, storefrontVersions } from "../db/schema/catalog"
import { brandPayoutAccounts } from "../db/schema/ledger"
import { HttpError, forbidden, notFound, restricted, rule } from "../http/errors"
import { log } from "../log"
import { emailBrandLeads } from "../orders/brand-email"
import { acceptProposal } from "./proposals"
import { refuseSampleBrand } from "./sample-guard"
import { draftForPublish, publishDraft } from "./storefront"
import { brandUnderReview } from "./studio"

/**
 * Yard puts a brand's shop live for it.
 *
 *  - Admin › "Publish storefront for {brand}" (publishForBrand): the brand's own publish
 *    (storefront.ts publishDraft: same draft, same checks, same version history), recorded with
 *    the admin as publisher and audited as brand.storefront_published_by_yard. Idempotent: once
 *    a storefront version exists the action does nothing (no second version, no second email).
 *  - "Go live when they claim" (goLiveAfterClaim, founding brands with brands.go_live_on_claim):
 *    right after the claim commits, Yard's pending product suggestions are accepted as the new
 *    owner (each on its own: one that fails stays pending and never fails the claim), then the
 *    Yard-prepared storefront is published, which sets launched_at.
 *
 * Either way the brand's owners and admins get "You're live 🎉" (brand_shop_live) once.
 */

type BrandRow = typeof brands.$inferSelect

async function loadBrand(d: Executor, brandId: string, lock = false) {
  const q = d.select().from(brands).where(eq(brands.id, brandId))
  const [b] = lock ? await q.for("update").limit(1) : await q.limit(1)
  if (!b) throw notFound("That brand doesn't exist.")
  return b
}

/** Products shoppers see the moment the shop is live: published (or due scheduled), passing moderation. */
async function liveProductCount(d: Executor, brandId: string) {
  const [r] = await d
    .select({ n: sql<number>`count(*)::int` })
    .from(catalogProducts)
    .where(
      and(
        eq(catalogProducts.brandId, brandId),
        eq(catalogProducts.moderationStatus, "ok"),
        sql`(${catalogProducts.status} = 'published' or (${catalogProducts.status} = 'scheduled' and ${catalogProducts.publishAt} <= now()))`,
      ),
    )
  return Number(r?.n) || 0
}

async function hasPayoutAccount(d: Executor, brandId: string) {
  const [p] = await d.select({ id: brandPayoutAccounts.brandId }).from(brandPayoutAccounts).where(eq(brandPayoutAccounts.brandId, brandId)).limit(1)
  return !!p
}

async function isPublished(d: Executor, brandId: string) {
  const [v] = await d.select({ v: storefrontVersions.version }).from(storefrontVersions).where(eq(storefrontVersions.brandId, brandId)).limit(1)
  return !!v
}

async function factsOf(d: Executor, b: BrandRow): Promise<PublishForBrandFacts> {
  const [draft] = await d.select({ config: storefrontDrafts.config }).from(storefrontDrafts).where(eq(storefrontDrafts.brandId, b.id)).limit(1)
  const config = (draft?.config ?? {}) as Record<string, unknown>
  return {
    name: b.name,
    founding: b.founding,
    claimStatus: b.claimStatus,
    reviewStatus: b.reviewStatus,
    underReview: await brandUnderReview(d, b.id),
    published: await isPublished(d, b.id),
    logo: !!b.logoMediaId,
    banner: typeof config.coverMediaId === "string" && !!config.coverMediaId,
    intro: typeof config.intro === "string" && config.intro.trim().length > 0,
    liveProducts: await liveProductCount(d, b.id),
  }
}

/** An unclaimed founding brand is Yard setup territory: only admins with brands.founding (owners) publish it. */
export function assertMayPublishFor(admin: AdminActor, b: Pick<BrandRow, "name" | "founding" | "claimStatus">) {
  if (b.founding && b.claimStatus === "unclaimed" && !admin.permissions.includes("brands.founding")) throw forbidden(`Only Yard owners can publish ${b.name} before it's claimed.`)
}

/** `buy` 1: Buy stays off until a payout account is saved (a founding brand, lib/sell-rule.ts), so the nudge says so. */
export const shopEmail = (tx: Tx, b: { id: string; handle: string; claimStatus: string }, variant: "yard" | "claim", payout: boolean) =>
  emailBrandLeads(tx, b.id, "brand_shop_live", { handle: b.handle, variant, payout: payout ? 1 : 0, buy: payoutAccountNeededToSell(b.claimStatus) ? 1 : 0 }, `brand_shop_live:${variant}:${b.id}`)

export type PublishForBrandPreview = {
  brand: { id: string; name: string; handle: string; founding: boolean; claimStatus: string }
  published: boolean
  checklist: ReturnType<typeof publishChecklist>
  /** Why it can't be published now (restricted, suspended, under review, or your role), else null. */
  blocked: string | null
  payoutAccount: boolean
  goLiveOnClaim: boolean
}

/** GET: what publishing would put live (the tray's checklist). */
export async function publishForBrandPreview(admin: AdminActor, brandId: string): Promise<PublishForBrandPreview> {
  refuseSampleBrand(brandId)
  const d = await db()
  const b = await loadBrand(d, brandId)
  const f = await factsOf(d, b)
  let blocked = publishForBrandBlock(f)
  if (!blocked && b.founding && b.claimStatus === "unclaimed" && !admin.permissions.includes("brands.founding")) blocked = `Only Yard owners can publish ${b.name} before it's claimed.`
  return {
    brand: { id: b.id, name: b.name, handle: b.handle, founding: b.founding, claimStatus: b.claimStatus },
    published: f.published,
    checklist: publishChecklist(f),
    blocked,
    payoutAccount: await hasPayoutAccount(d, b.id),
    goLiveOnClaim: b.goLiveOnClaim,
  }
}

/** POST: publishes the brand's storefront draft as Yard. A second press (or a race) is a no-op. */
export async function publishForBrand(admin: AdminActor, brandId: string, ipHash: string | null) {
  refuseSampleBrand(brandId)
  const out = await withTx(async (tx) => {
    // Locked first, so a double press waits here and then finds the version the first one made.
    const b = await loadBrand(tx, brandId, true)
    assertMayPublishFor(admin, b)
    const f = await factsOf(tx, b)
    const o = publishForBrandOutcome(f)
    if (o.kind === "already") return { created: false as const, version: null, emailed: 0 }
    if (o.kind === "blocked") throw b.reviewStatus === "restricted" ? restricted(o.message) : rule(o.message)
    const payout = await hasPayoutAccount(tx, b.id)
    // The outbox sends after commit: a failed publish below rolls these back too.
    const emailed = await shopEmail(tx, b, "yard", payout)
    const { draft, liveVersion } = await draftForPublish(tx, b.id, admin.userId)
    const r = await publishDraft(
      tx,
      { brandId: b.id, userId: admin.userId, audit: { kind: "admin", id: admin.userId, name: admin.name, role: admin.role }, action: "brand.storefront_published_by_yard", meta: { emailed, template: "brand_shop_live", liveProducts: f.liveProducts, founding: b.founding, claimStatus: b.claimStatus } },
      { draftRevision: draft.revision, expectedVersion: liveVersion, note: "Published by Yard" },
      ipHash,
    )
    return { created: true as const, version: r.version, emailed }
  })
  return { ...out, preview: await publishForBrandPreview(admin, brandId) }
}

/* ---------- Go live when they claim ---------- */

/** The new owner as Studio would see them, for the suggestion accepts (createProduct & co. take a BrandActor). */
function ownerActor(b: BrandRow, user: { id: string; name: string }): BrandActor {
  return {
    kind: "brand",
    sessionId: "claim",
    userId: user.id,
    name: user.name,
    brandId: b.id,
    brand: { id: b.id, handle: b.handle, name: b.name, reviewStatus: b.reviewStatus, currency: b.currency, country: b.country, city: b.city, citySlug: b.citySlug, timeZone: b.timeZone, claimStatus: b.claimStatus, logoMediaId: b.logoMediaId ?? null },
    role: "owner",
    permissions: brandRolePermissions.owner,
    demo: false,
  }
}

const reasonOf = (e: unknown) => (e instanceof HttpError ? `${e.status} ${e.message}` : e instanceof Error ? e.message : String(e)).slice(0, 200)

export type ClaimLive = { live: boolean; handle: string; payoutAccount: boolean; liveProducts: number; accepted: number; skipped: number }

/**
 * Runs after a claim commits (auth/claims.ts acceptClaim). With the brand's "Go live when they
 * claim" on: accepts Yard's pending suggestions as the owner, then publishes the Yard-prepared
 * storefront (launched_at). Never throws: the claim already succeeded, and anything that couldn't
 * go live stays where the owner can finish it in Studio.
 */
export async function goLiveAfterClaim(input: { brandId: string; user: { id: string; name: string }; ipHash: string | null }): Promise<ClaimLive> {
  const d = await db()
  const b = await loadBrand(d, input.brandId)
  const plan = claimGoLivePlan({ goLiveOnClaim: b.goLiveOnClaim, published: await isPublished(d, b.id) })
  const owner = ownerActor(b, input.user)
  let accepted: string[] = []
  let skipped: { id: string; reason: string }[] = []
  let publishError: string | null = null

  if (plan.acceptSuggestions) {
    const pending = await d
      .select({ id: productProposals.id, kind: productProposals.kind, productId: productProposals.productId, baseVersion: productProposals.baseVersion })
      .from(productProposals)
      .where(and(eq(productProposals.brandId, b.id), eq(productProposals.status, "pending")))
      .orderBy(asc(productProposals.createdAt), asc(productProposals.id))
    const byId = new Map(pending.map((p) => [p.id, p]))
    const r = await acceptEachSuggestion(
      pending.map((p) => p.id),
      async (id) => {
        const p = byId.get(id)!
        if (p.kind === "edit") {
          // Versioning: an edit is accepted only against the product version Yard suggested it for.
          const [prod] = await (await db()).select({ version: catalogProducts.version }).from(catalogProducts).where(eq(catalogProducts.id, p.productId ?? "")).limit(1)
          if (!suggestionStillFits(p, prod?.version ?? null)) throw new Error("The product changed since Yard suggested this.")
        }
        return acceptProposal(owner, id, undefined, input.ipHash)
      },
      reasonOf,
    )
    accepted = r.accepted.map((a) => a.id)
    skipped = r.skipped
    for (const s of skipped) log.warn(`[yard] claim go-live: suggestion ${s.id} left pending (${s.reason})`)
  }

  if (plan.publish) {
    try {
      await withTx(async (tx) => {
        const { draft, liveVersion } = await draftForPublish(tx, b.id, input.user.id)
        await publishDraft(
          tx,
          { brandId: b.id, userId: input.user.id, audit: { kind: "brand", id: input.user.id, name: input.user.name, role: "owner" }, action: "storefront.published", meta: { trigger: "claim", goLiveOnClaim: true } },
          { draftRevision: draft.revision, expectedVersion: liveVersion, note: "Went live on claim" },
          input.ipHash,
        )
      })
    } catch (e) {
      publishError = reasonOf(e)
      log.warn(`[yard] claim go-live: ${b.name}'s storefront wasn't published (${publishError})`)
    }
  }

  const fresh = await loadBrand(await db(), b.id)
  const published = await isPublished(await db(), b.id)
  const live = (fresh.founding ? !!fresh.launchedAt : published) && !fresh.unpublishedAt && fresh.reviewStatus !== "restricted" && fresh.reviewStatus !== "suspended"
  const payoutAccount = await hasPayoutAccount(await db(), b.id)
  const liveProducts = await liveProductCount(await db(), b.id)
  if (plan.acceptSuggestions || plan.publish || live) {
    try {
      await withTx(async (tx) => {
        const emailed = live ? await shopEmail(tx, fresh, "claim", payoutAccount) : 0
        // A system row (the claim did it): Sent lately reads it as Yard's email, not one the owner sent.
        await writeAudit({
          actor: { kind: "system" },
          action: live ? "founding.claim_went_live" : "founding.claim_go_live_incomplete",
          target: fresh.name,
          subjectType: "brand",
          subjectId: fresh.id,
          brandId: fresh.id,
          ipHash: input.ipHash,
          meta: { emailed, template: live ? "brand_shop_live" : null, owner: input.user.id, goLiveOnClaim: b.goLiveOnClaim, published: plan.publish && !publishError, publishError, accepted, skipped: skipped.map((s) => s.id), liveProducts },
        })
      })
    } catch (e) {
      log.error("[yard] claim go-live: the email or audit row failed", e)
    }
  }
  return { live, handle: fresh.handle, payoutAccount, liveProducts, accepted: accepted.length, skipped: skipped.length }
}
