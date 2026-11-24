import "server-only"
import { claimedNotLive, storefrontRoleBlock, publishBlockers, publishWarnings, storefrontActionPlan, storefrontLive } from "@/lib/admin-storefront"
import { canAdminFinance } from "@/lib/permissions"
import type { AdminActor } from "../auth/dal"
import { db, withTx } from "../db"
import { notFound, restricted, rule } from "../http/errors"
import { adminStorefrontFactsDb, loadBrandDb, setStorefrontListedDb, StorefrontRuleError, type Db, type StorefrontPayout } from "./admin-storefront-db"
import { catalogChanged } from "./hooks"
import { assertMayPublishFor, publishForBrand, publishForBrandPreview, shopEmail } from "./publish-for-brand"
import { refuseSampleBrand } from "./sample-guard"

/**
 * Admin › Brands › Publish / Unpublish storefront, for any brand that isn't closed (brands.restrict,
 * which owners hold; an unclaimed founding brand also needs brands.founding, like "Publish
 * storefront for {brand}").
 *
 *  - Publish, never published: the brand's own publish of its storefront draft, exactly as the
 *    founding brands' "Publish storefront for {brand}" does it (publish-for-brand.ts: same checks,
 *    version history, launched_at for a founding brand, audit brand.storefront_published_by_yard,
 *    and "You're live 🎉" to the owners and admins once).
 *  - Publish, published before but unpublished by Yard (or a founding brand whose launch never
 *    landed): back on the marketplace (admin-storefront-db.ts), audited
 *    brand.storefront_republished_by_yard, with the same "You're live" email (sent at most once).
 *  - Unpublish: off the marketplace without restricting the brand, audited
 *    brand.storefront_unpublished_by_yard. No email: the founding flow has none for it.
 */

export type AdminStorefrontDto = {
  live: boolean
  /** Claimed by its owner, not live yet: the action reads "Make live". */
  claimedNotLive: boolean
  hasVersion: boolean
  unpublished: boolean
  closed: boolean
  founding: boolean
  claimStatus: string
  liveProducts: number
  payout: StorefrontPayout
  publish: { allowed: boolean; noop: boolean; blockers: string[]; warnings: string[] }
  unpublish: { allowed: boolean; noop: boolean; blocker: string | null }
}

const asDb = (x: unknown) => x as Db

async function stateOf(admin: AdminActor, brandId: string): Promise<AdminStorefrontDto> {
  const d = asDb(await db())
  const b = await loadBrandDb(d, brandId)
  if (!b) throw notFound("That brand doesn't exist.")
  const { facts, payout } = await adminStorefrontFactsDb(d, b)
  const role = storefrontRoleBlock(admin.permissions, b)
  const pub = storefrontActionPlan(facts, "publish")
  const unpub = storefrontActionPlan(facts, "unpublish")
  const blockers = [...publishBlockers(facts), ...(role ? [role] : [])]
  return {
    live: storefrontLive(facts),
    claimedNotLive: claimedNotLive(facts),
    hasVersion: facts.hasVersion,
    unpublished: facts.unpublished,
    closed: facts.closed,
    founding: facts.founding,
    claimStatus: facts.claimStatus,
    liveProducts: facts.liveProducts,
    // The bank, account name and last 4 are Finance's (Owner and Finance roles); everyone else sees the status.
    payout: payout && !canAdminFinance(admin.role) ? { ...payout, bankName: "", accountName: "", last4: "" } : payout,
    publish: { allowed: pub.kind === "run" && !role, noop: pub.kind === "already", blockers, warnings: publishWarnings(facts) },
    unpublish: { allowed: unpub.kind === "run" && !role, noop: unpub.kind === "already", blocker: unpub.kind === "blocked" ? unpub.message : role },
  }
}

/** GET: the founding tray's preview (checklist, payout, go-live) plus the Publish / Unpublish state. */
export async function adminStorefrontPreview(admin: AdminActor, brandId: string) {
  refuseSampleBrand(brandId)
  const [preview, storefront] = await Promise.all([publishForBrandPreview(admin, brandId), stateOf(admin, brandId)])
  return { ...preview, storefront }
}

const mapRule = (e: unknown) => (e instanceof StorefrontRuleError ? (e.restricted ? restricted(e.message) : rule(e.message)) : e)

/** POST: Publish storefront. 201 when something went live, 200 when it already was (a no-op). */
export async function adminPublishStorefront(admin: AdminActor, brandId: string, ipHash: string | null) {
  refuseSampleBrand(brandId)
  const b = await loadBrandDb(asDb(await db()), brandId)
  if (!b) throw notFound("That brand doesn't exist.")
  if (b.closedAt) throw rule(`${b.name} is closed, so its storefront can't be published.`)
  assertMayPublishFor(admin, b)
  const { facts } = await adminStorefrontFactsDb(asDb(await db()), b)
  let created = false
  let emailed = 0
  let version: number | null = null
  if (!facts.hasVersion) {
    // Never published: the founding flow's publish, reused as is.
    const r = await publishForBrand(admin, brandId, ipHash)
    created = r.created
    emailed = r.emailed
    version = r.version
  } else {
    const r = await withTx(async (tx) => {
      const out = await setStorefrontListedDb(asDb(tx), { brandId, action: "relist", admin: { userId: admin.userId, name: admin.name, role: admin.role }, ipHash })
      const sent = out.changed ? await shopEmail(tx, b, "yard", out.facts.payoutAccount) : 0
      if (out.changed) catalogChanged({ reindexBrands: [brandId] })
      return { ...out, sent }
    }).catch((e: unknown) => {
      throw mapRule(e)
    })
    created = r.changed
    emailed = r.sent
  }
  return { created, version, emailed, preview: await adminStorefrontPreview(admin, brandId) }
}

/** DELETE: Unpublish storefront. 200 { changed } (false when it wasn't live). */
export async function adminUnpublishStorefront(admin: AdminActor, brandId: string, ipHash: string | null) {
  refuseSampleBrand(brandId)
  const b = await loadBrandDb(asDb(await db()), brandId)
  if (!b) throw notFound("That brand doesn't exist.")
  assertMayPublishFor(admin, b)
  const r = await withTx(async (tx) => {
    const out = await setStorefrontListedDb(asDb(tx), { brandId, action: "unpublish", admin: { userId: admin.userId, name: admin.name, role: admin.role }, ipHash })
    if (out.changed) catalogChanged({ reindexBrands: [brandId] })
    return out
  }).catch((e: unknown) => {
    throw mapRule(e)
  })
  return { changed: r.changed, preview: await adminStorefrontPreview(admin, brandId) }
}
