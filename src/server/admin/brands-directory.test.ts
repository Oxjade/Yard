import assert from "node:assert/strict"
import path from "node:path"
import { after, before, describe, it } from "node:test"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import { adminBrandsQuery } from "../../lib/api/contracts/admin-brands"
import type { BrandApplication } from "../../lib/data/admin"
import { allBrandsRecordId, brandRowToApplication, matchesBrandFilter, openTargetFor, resolveReview } from "../../components/admin/marketplace/all-brands"
import { brands } from "../db/schema/brands"
import { brandOnboardings, catalogCategories, catalogProducts } from "../db/schema/catalog"
import { users } from "../db/schema/people"
import { listAdminBrandsDb, type Db } from "./brands-directory-db"

/* Admin › Brands › All brands (admin/brands-directory-db.ts) on a real (in-memory) database with
 * every migration applied: every row of the brands table is listed, whatever its application says,
 * and each one opens (all-brands.ts), so a test brand with no application or a rejected one can be
 * found and deleted. */

let pg: PGlite
let d: ReturnType<typeof drizzle>
const db = () => d as unknown as Db

async function brand(key: string, over: Partial<typeof brands.$inferInsert> = {}) {
  await d.insert(brands).values({ id: `b_${key}`, handle: key, name: over.name ?? key, city: "Lagos", citySlug: "lagos", country: "NG", currency: "NGN", categories: ["streetwear"], followersBase: 0, timeZone: "Africa/Lagos", ...over })
}
async function application(key: string, brandKey: string, status: "draft" | "submitted" | "approved" | "rejected", updatedAt: string) {
  const userId = `u_${key}`
  await d.insert(users).values({ id: userId, kind: "brand_staff", name: userId, email: `${userId}@example.test`, demo: false })
  await d.insert(brandOnboardings).values({ id: `onb_${key}`, userId, status, brandId: `b_${brandKey}`, submittedAt: status === "draft" ? null : new Date(updatedAt), updatedAt: new Date(updatedAt), createdAt: new Date(updatedAt) })
}

before(async () => {
  pg = new PGlite()
  d = drizzle(pg)
  await migrate(d, { migrationsFolder: path.join(process.cwd(), "drizzle") })
  await d.insert(catalogCategories).values({ slug: "streetwear", name: "Streetwear" })

  // The two the owner couldn't find: no application, and a rejected one.
  await brand("sectest-brand", { name: "Sectest Brand", joinedAt: "2026-11-10" })
  await brand("xss-probe-2", { name: "<script>xss-probe-2</script>", country: "GB", city: "London", citySlug: "london", timeZone: "Europe/London" })
  await application("xss", "xss-probe-2", "rejected", "2026-11-12T10:00:00Z")
  // An older approved application for the same brand doesn't win over the later rejection.
  await application("xss_old", "xss-probe-2", "approved", "2026-11-01T10:00:00Z")
  await brand("draft-label", { name: "Draft Label" })
  await application("draft", "draft-label", "draft", "2026-11-14T10:00:00Z")
  await brand("queued-label", { name: "Queued Label" })
  await application("queued", "queued-label", "submitted", "2026-11-15T10:00:00Z")
  await brand("closed-label", { name: "Closed Label", reviewStatus: "suspended", closedAt: new Date("2026-11-20T10:00:00Z") })
  await brand("founding-label", { name: "Founding Label", founding: true, claimStatus: "unclaimed", reviewStatus: "verified", verified: true })
  await brand("verified-label", { name: "Verified Label", reviewStatus: "verified", verified: true, joinedAt: "2026-10-01" })
  for (const [i, status] of (["draft", "published", "archived"] as const).entries())
    await d.insert(catalogProducts).values({ id: `p_${i}`, brandId: "b_sectest-brand", slug: `tee-${i}`, title: "Tee", categorySlug: "streetwear", priceMinor: 1000, currency: "NGN", status })
})
after(async () => {
  await pg?.close()
})

describe("GET /api/admin/brands (listAdminBrandsDb)", () => {
  it("lists every brand, whatever its application says", async () => {
    const r = await listAdminBrandsDb(db())
    assert.equal(r.total, 7)
    assert.deepEqual(
      r.items.map((b) => b.handle),
      // By name, case-insensitive: "<script>…" sorts first.
      ["xss-probe-2", "closed-label", "draft-label", "founding-label", "queued-label", "sectest-brand", "verified-label"],
    )
    const by = Object.fromEntries(r.items.map((b) => [b.handle, b]))
    assert.equal(by["sectest-brand"].application, null)
    assert.equal(by["sectest-brand"].products, 3)
    assert.equal(by["sectest-brand"].since, "2026-11-10T00:00:00.000Z")
    assert.equal(by["xss-probe-2"].application?.status, "rejected")
    assert.equal(by["xss-probe-2"].application?.id, "onb_xss")
    assert.equal(by["draft-label"].application?.status, "draft")
    assert.equal(by["queued-label"].application?.status, "submitted")
    assert.equal(by["closed-label"].closedAt, "2026-11-20T10:00:00.000Z")
    assert.equal(by["founding-label"].founding, true)
    assert.equal(by["verified-label"].products, 0)
  })

  it("filters by status the same way on the server and in the tab", async () => {
    const all = (await listAdminBrandsDb(db())).items
    const cases: [Parameters<typeof matchesBrandFilter>[1], string[]][] = [
      ["no_application", ["closed-label", "founding-label", "sectest-brand", "verified-label"]],
      ["rejected", ["xss-probe-2"]],
      ["draft", ["draft-label"]],
      ["closed", ["closed-label"]],
      ["founding", ["founding-label"]],
      ["suspended", []],
      ["verified", ["founding-label", "verified-label"]],
      ["pending_review", ["xss-probe-2", "draft-label", "queued-label", "sectest-brand"]],
    ]
    for (const [status, handles] of cases) {
      const r = await listAdminBrandsDb(db(), { status })
      assert.deepEqual(r.items.map((b) => b.handle), handles, status)
      assert.equal(r.total, handles.length, status)
      assert.deepEqual(all.filter((b) => matchesBrandFilter(b, status)).map((b) => b.handle), handles, `${status} (client)`)
    }
  })

  it("searches by name, handle or country, and pages", async () => {
    assert.deepEqual((await listAdminBrandsDb(db(), { q: "sectest" })).items.map((b) => b.handle), ["sectest-brand"])
    assert.deepEqual((await listAdminBrandsDb(db(), { q: "XSS-PROBE" })).items.map((b) => b.handle), ["xss-probe-2"])
    assert.deepEqual((await listAdminBrandsDb(db(), { q: "GB" })).items.map((b) => b.handle), ["xss-probe-2"])
    // LIKE wildcards are literal.
    assert.equal((await listAdminBrandsDb(db(), { q: "%" })).total, 0)
    const p1 = await listAdminBrandsDb(db(), { page: 1, pageSize: 3 })
    const p3 = await listAdminBrandsDb(db(), { page: 3, pageSize: 3 })
    assert.equal(p1.total, 7)
    assert.equal(p1.items.length, 3)
    assert.deepEqual(p3.items.map((b) => b.handle), ["verified-label"])
  })

  it("validates the query", () => {
    assert.deepEqual(adminBrandsQuery.parse({}), { status: "all", page: 1, pageSize: 50 })
    assert.equal(adminBrandsQuery.safeParse({ status: "nope" }).success, false)
    assert.equal(adminBrandsQuery.safeParse({ pageSize: "500" }).success, false)
  })
})

describe("All brands opens every brand (all-brands.ts)", () => {
  it("opens a brand with no application and one with a rejected application", async () => {
    const items = (await listAdminBrandsDb(db())).items
    for (const handle of ["sectest-brand", "xss-probe-2"]) {
      const row = items.find((b) => b.handle === handle)!
      const target = openTargetFor(row, [])
      assert.equal(target, allBrandsRecordId(row.id))
      const opened = resolveReview(target, [], items)
      assert.ok(opened, handle)
      assert.equal(opened.brandId, row.id)
      assert.equal(opened.handle, handle)
      assert.equal(opened.status, "pending_review")
      assert.equal(opened.closedAt, undefined)
      // A brand from All brands is decided by its status, never as an application review.
      assert.equal(opened.onboardingId, undefined)
    }
    assert.equal(resolveReview(allBrandsRecordId("b_sectest-brand"), [], items)?.listing?.application, "none")
    assert.equal(resolveReview(allBrandsRecordId("b_sectest-brand"), [], items)?.products, 3)
    assert.equal(resolveReview(allBrandsRecordId("b_xss-probe-2"), [], items)?.listing?.application, "rejected")
    // Unknown and missing ids open nothing.
    assert.equal(resolveReview(allBrandsRecordId("b_gone"), [], items), undefined)
    assert.equal(resolveReview(null, [], items), undefined)
  })

  it("opens a brand in the review queue as its application", async () => {
    const items = (await listAdminBrandsDb(db())).items
    const row = items.find((b) => b.handle === "queued-label")!
    const queued: BrandApplication = { ...brandRowToApplication(row), id: "onb_queued", onboardingId: "onb_queued", listing: undefined }
    assert.equal(openTargetFor(row, [queued]), "onb_queued")
    assert.equal(resolveReview("onb_queued", [queued], items), queued)
  })

  it("keeps a closed brand closed and marks a founding one", async () => {
    const items = (await listAdminBrandsDb(db())).items
    assert.equal(brandRowToApplication(items.find((b) => b.handle === "closed-label")!).closedAt, "2026-11-20T10:00:00.000Z")
    const founding = brandRowToApplication(items.find((b) => b.handle === "founding-label")!)
    assert.equal(founding.listing?.founding, true)
    assert.equal(founding.listing?.dated, false)
  })
})
