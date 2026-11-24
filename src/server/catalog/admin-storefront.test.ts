import assert from "node:assert/strict"
import path from "node:path"
import { after, before, describe, it } from "node:test"
import { PGlite } from "@electric-sql/pglite"
import { and, eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import { claimedNotLive, publishBlockers, publishWarnings, storefrontActionPlan, storefrontLive, storefrontRoleBlock, type AdminStorefrontFacts } from "../../lib/admin-storefront"
import { adminBrandsQuery } from "../../lib/api/contracts/admin-brands"
import { adminRolePermissions, type AdminRole } from "../../lib/permissions"
import { listAdminBrandsDb, type Db as DirectoryDb } from "../admin/brands-directory-db"
import { brandPageVisibility } from "../../lib/page-visibility"
import { brands } from "../db/schema/brands"
import { brandOnboardings, catalogCategories, catalogProducts, storefrontVersions } from "../db/schema/catalog"
import { brandPayoutAccounts } from "../db/schema/ledger"
import { users } from "../db/schema/people"
import { auditLog } from "../db/schema/platform"
import { adminStorefrontFactsDb, loadBrandDb, setStorefrontListedDb, StorefrontRuleError, type Db } from "./admin-storefront-db"

/* Admin › Brands › Publish / Unpublish storefront (catalog/admin-storefront-db.ts and
 * lib/admin-storefront.ts) on a real (in-memory) database with every migration applied: what the
 * confirmation shows (live products, blockers, warnings), unpublish and republish with their audit
 * rows, the founding launch rule, and the refusals. The very first publish of a draft is the
 * founding flow's (publish-for-brand.ts → storefront.ts publishDraft), whose plan is checked here. */

let pg: PGlite
let d: ReturnType<typeof drizzle>
const db = () => d as unknown as Db
const ADMIN = { userId: "u_admin", name: "Kemi Admin", role: "owner" }

async function brand(key: string, over: Partial<typeof brands.$inferInsert> = {}) {
  await d.insert(brands).values({ id: `b_${key}`, handle: key, name: over.name ?? key, city: "Lagos", citySlug: "lagos", country: "NG", currency: "NGN", categories: ["streetwear"], followersBase: 0, timeZone: "Africa/Lagos", reviewStatus: "verified", verified: true, ...over })
}
async function version(key: string) {
  await d.insert(storefrontVersions).values({ id: `sfv_${key}`, brandId: `b_${key}`, version: 1, config: {} })
}
async function products(key: string, n: number, status: "published" | "draft" = "published") {
  for (let i = 0; i < n; i++) await d.insert(catalogProducts).values({ id: `p_${key}_${status}_${i}`, brandId: `b_${key}`, slug: `${key}-${status}-${i}`, title: "Tee", categorySlug: "streetwear", priceMinor: 1000, currency: "NGN", status })
}
async function facts(key: string) {
  const b = await loadBrandDb(db(), `b_${key}`)
  return (await adminStorefrontFactsDb(db(), b!)).facts
}
async function audits(key: string) {
  return d.select().from(auditLog).where(and(eq(auditLog.brandId, `b_${key}`), eq(auditLog.subjectType, "storefront")))
}
const tx = <T>(fn: (t: Db) => Promise<T>) => d.transaction((t) => fn(t as unknown as Db))

before(async () => {
  pg = new PGlite()
  d = drizzle(pg)
  await migrate(d, { migrationsFolder: path.join(process.cwd(), "drizzle") })
  await d.insert(catalogCategories).values({ slug: "streetwear", name: "Streetwear" })
  await d.insert(users).values([
    { id: "u_admin", kind: "admin", name: "Kemi Admin", email: "admin@example.test", demo: false },
    { id: "u_applicant", kind: "brand_staff", name: "Applicant", email: "applicant@example.test", demo: false },
  ])

  await brand("live-label", { name: "Live Label" })
  await version("live-label")
  await products("live-label", 3)
  await products("live-label", 2, "draft")
  await d.insert(brandPayoutAccounts).values({ brandId: "b_live-label", country: "NG", currency: "NGN", bankCode: "058", bankName: "GTBank", accountName: "LIVE LABEL LTD", accountNumberEnc: "v1.x", accountLast4: "4821", recipientProvider: "stub", updatedBy: "u_admin" })

  await brand("fresh-label", { name: "Fresh Label" })
  await brand("empty-label", { name: "Empty Label" })
  await version("empty-label")
  // A founding brand published once, but its launch never landed (launched_at null).
  await brand("founding-label", { name: "Founding Label", founding: true, claimStatus: "claimed" })
  await version("founding-label")
  await products("founding-label", 1)
  await brand("suspended-label", { name: "Suspended Label", reviewStatus: "suspended" })
  await version("suspended-label")
  await brand("closed-label", { name: "Closed Label", reviewStatus: "suspended", closedAt: new Date("2026-11-20T10:00:00Z") })
  await brand("review-label", { name: "Review Label", reviewStatus: "pending_review" })
  await d.insert(brandOnboardings).values({ id: "onb_review", userId: "u_applicant", status: "submitted", brandId: "b_review-label", submittedAt: new Date() })

  // Make live. Claimed before this change, Yard-prepared storefront published as a draft version but
  // never launched (what "Opening soon" brands look like), with approved products waiting.
  await brand("claimed-label", { name: "Claimed Label", founding: true, claimStatus: "claimed", claimedAt: new Date("2026-11-10T10:00:00Z") })
  await version("claimed-label")
  await products("claimed-label", 2)
  // Claimed with no storefront version at all: Make live runs the draft publish (publish-for-brand.ts).
  await brand("claimed-nodraft", { name: "Claimed No Draft", founding: true, claimStatus: "claimed" })
  // Go live when they claim: already live at the claim, so nothing to do.
  await brand("golive-label", { name: "Golive Label", founding: true, claimStatus: "claimed", goLiveOnClaim: true, launchedAt: new Date("2026-11-11T10:00:00Z") })
  await version("golive-label")
  await brand("unclaimed-label", { name: "Unclaimed Label", founding: true, claimStatus: "unclaimed" })
})

/** The public catalogue's product rule (sellable.ts productPublicWhere + brandLaunchedSql), in SQL. */
async function publicProducts(key: string) {
  const r = await pg.query<{ n: number }>(
    `select count(*)::int as n from catalog_products p join brands b on b.id = p.brand_id
     where p.brand_id = $1 and p.status = 'published' and p.moderation_status = 'ok'
       and b.review_status not in ('restricted', 'suspended')
       and (not b.founding or b.launched_at is not null) and b.unpublished_at is null`,
    [`b_${key}`],
  )
  return r.rows[0].n
}
after(async () => {
  await pg?.close()
})

describe("Admin › Brands › Publish / Unpublish storefront", () => {
  it("the confirmation shows what goes live: live products (drafts don't count), payout account", async () => {
    const f = await facts("live-label")
    assert.equal(f.liveProducts, 3)
    assert.equal(f.payoutAccount, true)
    assert.equal(f.hasVersion, true)
    assert.equal(storefrontLive(f), true)
    const b = await loadBrandDb(db(), "b_live-label")
    const { payout } = await adminStorefrontFactsDb(db(), b!)
    assert.deepEqual({ ...payout, changedAt: "x" }, { status: "pending", bankName: "GTBank", accountName: "LIVE LABEL LTD", last4: "4821", currency: "NGN", changedAt: "x" })
  })

  it("blockers refuse; warnings (no products, no payout account) only caution", async () => {
    const empty = await facts("empty-label")
    assert.deepEqual(publishBlockers(empty), [])
    assert.deepEqual(publishWarnings(empty), ["No live products, so the shop will show as empty until products are published.", "No payout account yet. The shop can take orders, but Yard can't pay the brand until it adds one in Studio."])
    const founding = await facts("founding-label")
    assert.deepEqual(publishWarnings(founding), ["No payout account, so Buy stays off until the brand adds one in Studio."])
    assert.deepEqual(publishBlockers(await facts("suspended-label")), ["Yard has suspended suspended-label. Reinstate it from Brands first.".replace("suspended-label", "Suspended Label")])
    assert.deepEqual(publishBlockers(await facts("review-label")), ["Review Label's application isn't approved yet. Approve it before publishing its storefront."])
    assert.deepEqual(publishBlockers(await facts("closed-label")), ["Closed Label is closed, so its storefront can't be published."])
    // Never published: Publish runs the draft publish (the founding flow's), not a relist.
    assert.deepEqual(storefrontActionPlan(await facts("fresh-label"), "publish"), { kind: "run" })
    assert.deepEqual(storefrontActionPlan(await facts("live-label"), "publish"), { kind: "already" })
    assert.deepEqual(storefrontActionPlan(await facts("fresh-label"), "unpublish"), { kind: "already" })
  })

  it("unpublish hides the shop (the public rule) and writes an audit row; a second press is a no-op", async () => {
    const r = await tx((t) => setStorefrontListedDb(t, { brandId: "b_live-label", action: "unpublish", admin: ADMIN, ipHash: "iphash", now: new Date("2026-11-24T10:00:00Z") }))
    assert.equal(r.changed, true)
    const [b] = await d.select().from(brands).where(eq(brands.id, "b_live-label"))
    assert.equal(b.unpublishedAt?.toISOString(), "2026-11-24T10:00:00.000Z")
    assert.equal(b.unpublishedBy, "u_admin")
    assert.equal(b.reviewStatus, "verified", "the brand isn't restricted")
    assert.equal(brandPageVisibility({ founding: b.founding, launchedAt: b.launchedAt, unpublishedAt: b.unpublishedAt, reviewStatus: b.reviewStatus }), "opens-soon")
    // The public catalogue's SQL (sellable.ts brandLaunchedSql: "unpublished_at is null") no longer lists it.
    const listed = await pg.query<{ n: number }>("select count(*)::int as n from brands where id = 'b_live-label' and unpublished_at is null")
    assert.equal(listed.rows[0].n, 0)
    const rows = await audits("live-label")
    assert.equal(rows.length, 1)
    assert.equal(rows[0].action, "brand.storefront_unpublished_by_yard")
    assert.equal(rows[0].actorKind, "admin")
    assert.equal(rows[0].actorId, "u_admin")
    assert.equal(rows[0].actorName, "Kemi Admin")
    assert.equal(rows[0].ipHash, "iphash")
    assert.deepEqual(rows[0].meta, { liveProducts: 3, payoutAccount: true, founding: false, claimStatus: "none", launched: false })
    const again = await tx((t) => setStorefrontListedDb(t, { brandId: "b_live-label", action: "unpublish", admin: ADMIN, ipHash: null }))
    assert.equal(again.changed, false)
    assert.equal((await audits("live-label")).length, 1)
  })

  it("publish puts an unpublished shop back and records it", async () => {
    const r = await tx((t) => setStorefrontListedDb(t, { brandId: "b_live-label", action: "relist", admin: ADMIN, ipHash: null }))
    assert.equal(r.changed, true)
    assert.equal(r.launched, false)
    const [b] = await d.select().from(brands).where(eq(brands.id, "b_live-label"))
    assert.equal(b.unpublishedAt, null)
    assert.equal(b.unpublishedBy, null)
    assert.equal(storefrontLive(await facts("live-label")), true)
    const rows = await audits("live-label")
    assert.deepEqual(rows.map((x) => x.action).sort(), ["brand.storefront_republished_by_yard", "brand.storefront_unpublished_by_yard"])
  })

  it("respects the founding launch rule: publishing sets launched_at so the shop is really live", async () => {
    assert.equal(storefrontLive(await facts("founding-label")), false)
    assert.equal(brandPageVisibility({ founding: true, launchedAt: null, reviewStatus: "verified" }), "opens-soon")
    const r = await tx((t) => setStorefrontListedDb(t, { brandId: "b_founding-label", action: "relist", admin: ADMIN, ipHash: null, now: new Date("2026-11-24T11:00:00Z") }))
    assert.equal(r.changed, true)
    assert.equal(r.launched, true)
    const [b] = await d.select().from(brands).where(eq(brands.id, "b_founding-label"))
    assert.equal(b.launchedAt?.toISOString(), "2026-11-24T11:00:00.000Z")
    assert.equal(storefrontLive(await facts("founding-label")), true)
    const [row] = await audits("founding-label")
    assert.equal(row.action, "brand.storefront_republished_by_yard")
    assert.equal((row.meta as { launched: boolean }).launched, true)
  })

  it("refuses with the blocker, and changes nothing", async () => {
    for (const [key, message] of [
      ["suspended-label", /suspended Suspended Label/],
      ["review-label", /application isn't approved/],
      ["closed-label", /is closed/],
    ] as const) {
      await assert.rejects(
        tx((t) => setStorefrontListedDb(t, { brandId: `b_${key}`, action: "relist", admin: ADMIN, ipHash: null })),
        (e: unknown) => e instanceof StorefrontRuleError && message.test(e.message),
        key,
      )
      assert.equal((await audits(key)).length, 0, key)
    }
    await assert.rejects(
      tx((t) => setStorefrontListedDb(t, { brandId: "b_closed-label", action: "unpublish", admin: ADMIN, ipHash: null })),
      (e: unknown) => e instanceof StorefrontRuleError && /closed/.test(e.message),
    )
    // A never-published draft isn't relisted here: the route sends it through the draft publish.
    await assert.rejects(
      tx((t) => setStorefrontListedDb(t, { brandId: "b_fresh-label", action: "relist", admin: ADMIN, ipHash: null })),
      (e: unknown) => e instanceof StorefrontRuleError && /never been published/.test(e.message),
    )
  })

  it("Make live: a claimed founding brand that isn't live is badged, filtered and counted", async () => {
    assert.equal(claimedNotLive(await facts("claimed-label")), true)
    assert.equal(claimedNotLive(await facts("claimed-nodraft")), true)
    assert.equal(claimedNotLive(await facts("golive-label")), false, "go-live-on-claim brands are live already")
    assert.equal(claimedNotLive(await facts("unclaimed-label")), false)
    const all = await listAdminBrandsDb(d as unknown as DirectoryDb, adminBrandsQuery.parse({ pageSize: "200" }))
    const by = Object.fromEntries(all.items.map((b) => [b.handle, b]))
    assert.equal(by["claimed-label"].storefront?.claimedNotLive, true)
    assert.equal(by["golive-label"].storefront?.claimedNotLive, false)
    assert.equal(by["golive-label"].storefront?.live, true)
    const filtered = await listAdminBrandsDb(d as unknown as DirectoryDb, adminBrandsQuery.parse({ status: "claimed_not_live" }))
    assert.deepEqual(filtered.items.map((b) => b.handle), ["claimed-label", "claimed-nodraft"])
    // The plan: a version → relist with launched_at; none → the draft publish.
    assert.deepEqual(storefrontActionPlan(await facts("claimed-label"), "publish"), { kind: "run" })
    assert.deepEqual(storefrontActionPlan(await facts("claimed-nodraft"), "publish"), { kind: "run" })
    assert.deepEqual(storefrontActionPlan(await facts("golive-label"), "publish"), { kind: "already" })
    assert.deepEqual(publishWarnings(await facts("claimed-label")), ["No payout account, so Buy stays off until the brand adds one in Studio."])
  })

  it("Make live: the brand launches, its public page opens and its published products show", async () => {
    const before = (await d.select().from(brands).where(eq(brands.id, "b_claimed-label")))[0]
    assert.equal(brandPageVisibility({ founding: true, launchedAt: before.launchedAt, unpublishedAt: before.unpublishedAt, reviewStatus: before.reviewStatus }), "opens-soon")
    assert.equal(await publicProducts("claimed-label"), 0)
    const r = await tx((t) => setStorefrontListedDb(t, { brandId: "b_claimed-label", action: "relist", admin: ADMIN, ipHash: null, now: new Date("2026-11-24T12:00:00Z") }))
    assert.equal(r.changed, true)
    assert.equal(r.launched, true)
    const after = (await d.select().from(brands).where(eq(brands.id, "b_claimed-label")))[0]
    assert.equal(after.launchedAt?.toISOString(), "2026-11-24T12:00:00.000Z")
    assert.equal(brandPageVisibility({ founding: true, launchedAt: after.launchedAt, unpublishedAt: after.unpublishedAt, reviewStatus: after.reviewStatus }), "public")
    assert.equal(await publicProducts("claimed-label"), 2)
    assert.equal(claimedNotLive(await facts("claimed-label")), false)
    assert.equal((await listAdminBrandsDb(d as unknown as DirectoryDb, adminBrandsQuery.parse({ status: "claimed_not_live" }))).items.some((b) => b.handle === "claimed-label"), false)
    const [row] = await audits("claimed-label")
    assert.equal(row.action, "brand.storefront_republished_by_yard")
    // A second press is a no-op: no second audit row.
    assert.equal((await tx((t) => setStorefrontListedDb(t, { brandId: "b_claimed-label", action: "relist", admin: ADMIN, ipHash: null }))).changed, false)
    assert.equal((await audits("claimed-label")).length, 1)
  })

  it("permissions: brands.restrict publishes and makes live; an unclaimed founding brand also needs brands.founding", () => {
    const perms = (role: AdminRole) => adminRolePermissions[role]
    const claimed = { name: "Claimed Label", founding: true, claimStatus: "claimed" }
    const unclaimed = { name: "Unclaimed Label", founding: true, claimStatus: "unclaimed" }
    assert.equal(storefrontRoleBlock(perms("owner"), claimed), null)
    assert.equal(storefrontRoleBlock(perms("trust_safety"), claimed), null)
    for (const role of ["finance", "support", "ads_ops", "engineering"] as const) assert.match(storefrontRoleBlock(perms(role), claimed) ?? "", /can't publish/, role)
    assert.equal(storefrontRoleBlock(perms("owner"), unclaimed), null)
    assert.match(storefrontRoleBlock(perms("trust_safety"), unclaimed) ?? "", /Only Yard owners/)
  })

  it("the plan matches the facts for every brand state", () => {
    const base: AdminStorefrontFacts = { name: "X", founding: false, claimStatus: "none", reviewStatus: "verified", closed: false, underReview: false, hasVersion: true, launched: false, unpublished: false, liveProducts: 1, payoutAccount: true }
    assert.deepEqual(storefrontActionPlan(base, "unpublish"), { kind: "run" })
    assert.deepEqual(storefrontActionPlan({ ...base, unpublished: true }, "publish"), { kind: "run" })
    assert.deepEqual(storefrontActionPlan({ ...base, founding: true, claimStatus: "unclaimed" }, "publish"), { kind: "run" })
    assert.deepEqual(publishWarnings({ ...base, founding: true, claimStatus: "unclaimed", payoutAccount: false }), ["Not claimed yet, so Buy stays off until the owner claims it and adds a payout account."])
    assert.deepEqual(storefrontActionPlan({ ...base, reviewStatus: "restricted" }, "publish"), { kind: "blocked", message: "Yard has restricted X, so publishing is paused. Lift the restriction first." })
  })
})
