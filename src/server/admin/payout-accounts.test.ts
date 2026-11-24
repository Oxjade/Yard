import assert from "node:assert/strict"
import path from "node:path"
import { after, before, describe, it } from "node:test"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import { adminPayoutAccountsQuery } from "../../lib/api/contracts/admin-payout-accounts"
import { brands } from "../db/schema/brands"
import { brandOnboardings, storefrontVersions } from "../db/schema/catalog"
import { brandPayoutAccounts } from "../db/schema/ledger"
import { users } from "../db/schema/people"
import { eq, sql } from "drizzle-orm"
import { notForSaleOf } from "../../lib/sell-rule"
import { brandForSaleSql } from "../catalog/for-sale-sql"
import { listPayoutAccountsDb, type Db } from "./payout-accounts-db"

/* Admin › Finance › Payout accounts (admin/payout-accounts-db.ts) on a real (in-memory) database with
 * every migration applied: every brand is listed with its payout account status, the account is
 * masked (bank, name, last 4; the sealed number never leaves the table), the filters and search
 * work, and "can sell" needs a live storefront, good standing and the sell rule (never a payout
 * account; only an unclaimed founding brand is held back; checked against catalog/for-sale-sql.ts
 * brandForSaleSql below). */

let pg: PGlite
let d: ReturnType<typeof drizzle>
const db = () => d as unknown as Db
const FULL_NUMBER = "0123456789"

async function brand(key: string, over: Partial<typeof brands.$inferInsert> = {}) {
  await d.insert(brands).values({ id: `b_${key}`, handle: key, name: over.name ?? key, city: "Lagos", citySlug: "lagos", country: "NG", currency: "NGN", categories: ["streetwear"], followersBase: 0, timeZone: "Africa/Lagos", reviewStatus: "verified", verified: true, ...over })
}
async function published(key: string) {
  await d.insert(storefrontVersions).values({ id: `sfv_${key}`, brandId: `b_${key}`, version: 1, config: {} })
}
async function account(key: string, over: Partial<typeof brandPayoutAccounts.$inferInsert> = {}) {
  await d.insert(brandPayoutAccounts).values({
    brandId: `b_${key}`,
    country: "NG",
    currency: "NGN",
    bankCode: "058",
    bankName: "GTBank",
    accountName: `${key.toUpperCase()} LTD`,
    accountNumberEnc: `v1.sealed.${FULL_NUMBER}`,
    accountLast4: FULL_NUMBER.slice(-4),
    recipientCode: "RCP_stub_x",
    recipientProvider: "stub",
    updatedBy: "u_owner",
    changedAt: new Date("2026-11-20T10:00:00Z"),
    ...over,
  })
}

before(async () => {
  pg = new PGlite()
  d = drizzle(pg)
  await migrate(d, { migrationsFolder: path.join(process.cwd(), "drizzle") })
  await d.insert(users).values({ id: "u_owner", kind: "brand_staff", name: "Owner", email: "owner@example.test", demo: false })

  // Ready to sell: verified (Paystack) account, published storefront, good standing.
  await brand("ready-label", { name: "Ready Label" })
  await published("ready-label")
  await account("ready-label", { recipientProvider: "paystack", recipientCode: "RCP_live_1", changedAt: new Date("2026-11-21T09:00:00Z") })
  // Pending: on file with the stub recipient (Bachs, Yard pays by hand), published.
  await brand("pending-label", { name: "Pending Label" })
  await published("pending-label")
  await account("pending-label")
  // Missing: published, no account.
  await brand("missing-label", { name: "Missing Label" })
  await published("missing-label")
  // Account but never published.
  await brand("draft-shop", { name: "Draft Shop" })
  await account("draft-shop")
  // Unpublished by Yard, restricted, closed, founding unclaimed, in review.
  await brand("hidden-label", { name: "Hidden Label", unpublishedAt: new Date("2026-11-22T10:00:00Z") })
  await published("hidden-label")
  await account("hidden-label")
  await brand("restricted-label", { name: "Restricted Label", reviewStatus: "restricted" })
  await published("restricted-label")
  await account("restricted-label")
  await brand("closed-label", { name: "Closed Label", reviewStatus: "suspended", closedAt: new Date("2026-11-20T10:00:00Z") })
  await brand("founding-label", { name: "Founding Label", founding: true, claimStatus: "unclaimed", launchedAt: new Date("2026-11-01T10:00:00Z") })
  await published("founding-label")
  await brand("review-label", { name: "Review Label", reviewStatus: "pending_review", verified: false })
  await d.insert(brandOnboardings).values({ id: "onb_review", userId: "u_owner", status: "submitted", brandId: "b_review-label", submittedAt: new Date("2026-11-23T10:00:00Z") })
  await account("review-label")
})
after(async () => {
  await pg?.close()
})

describe("GET /api/admin/finance/payout-accounts (listPayoutAccountsDb)", () => {
  it("lists every brand with its payout account status", async () => {
    const r = await listPayoutAccountsDb(db(), adminPayoutAccountsQuery.parse({}))
    assert.equal(r.total, 9)
    const by = Object.fromEntries(r.items.map((x) => [x.handle, x]))
    assert.equal(by["ready-label"].status, "verified")
    assert.equal(by["pending-label"].status, "pending")
    assert.equal(by["missing-label"].status, "none")
    assert.equal(by["missing-label"].account, null)
    assert.deepEqual(r.counts, { all: 9, owed: 0, missing: 3, pending: 5, verified: 1 })
  })

  it("masks the account: bank, name, last 4 and when it changed, never the number", async () => {
    const r = await listPayoutAccountsDb(db(), adminPayoutAccountsQuery.parse({ q: "ready" }))
    assert.equal(r.items.length, 1)
    const a = r.items[0].account!
    assert.deepEqual(a, { bankName: "GTBank", accountName: "READY-LABEL LTD", last4: "6789", currency: "NGN", country: "NG", provider: "paystack", changedAt: "2026-11-21T09:00:00.000Z" })
    const json = JSON.stringify(await listPayoutAccountsDb(db(), adminPayoutAccountsQuery.parse({})))
    assert.ok(!json.includes(FULL_NUMBER), "the full account number never appears")
    assert.ok(!json.includes("sealed"), "the sealed column is never read")
    assert.ok(!json.includes("RCP_"), "the recipient code is never read")
  })

  it("filters by missing, pending and verified, and searches by brand", async () => {
    const handles = async (q: Record<string, string>) => (await listPayoutAccountsDb(db(), adminPayoutAccountsQuery.parse(q))).items.map((x) => x.handle)
    assert.deepEqual(await handles({ status: "missing" }), ["closed-label", "founding-label", "missing-label"])
    assert.deepEqual(await handles({ status: "verified" }), ["ready-label"])
    assert.deepEqual(await handles({ status: "pending" }), ["draft-shop", "hidden-label", "pending-label", "restricted-label", "review-label"])
    assert.deepEqual(await handles({ q: "LABEL", status: "pending" }), ["hidden-label", "pending-label", "restricted-label", "review-label"])
    assert.deepEqual(await handles({ q: "draft" }), ["draft-shop"])
    // LIKE wildcards in the search are literal.
    assert.deepEqual(await handles({ q: "%" }), [])
  })

  it("can sell: a live storefront, good standing and the sell rule; otherwise says why", async () => {
    const r = await listPayoutAccountsDb(db(), adminPayoutAccountsQuery.parse({ pageSize: "200" }))
    const by = Object.fromEntries(r.items.map((x) => [x.handle, x]))
    assert.equal(by["ready-label"].canSell, true)
    assert.equal(by["ready-label"].storefrontLive, true)
    assert.equal(by["pending-label"].canSell, true, "a pending (unconfirmed) account still sells; Yard pays it by hand")
    assert.equal(by["ready-label"].sellNote, null)
    // An ordinary brand sells without a payout account (Yard holds its earnings): yes, with a note.
    assert.equal(by["missing-label"].canSell, true, "no payout account never stops an ordinary brand selling")
    assert.deepEqual(by["missing-label"].reasons, [])
    assert.equal(by["missing-label"].sellNote, "Add a payout account to get paid")
    assert.deepEqual(by["draft-shop"].reasons, ["Storefront not published"])
    assert.deepEqual(by["hidden-label"].reasons, ["Unpublished by Yard"])
    assert.equal(by["hidden-label"].storefrontLive, false)
    assert.deepEqual(by["restricted-label"].reasons, ["Restricted"])
    assert.deepEqual(by["closed-label"].reasons, ["Closed", "Storefront not published"])
    assert.equal(by["closed-label"].sellNote, null)
    assert.deepEqual(by["founding-label"].reasons, ["Not claimed"])
    assert.deepEqual(by["review-label"].reasons, ["In review", "Storefront not published"])
  })

  it("pages", async () => {
    const one = await listPayoutAccountsDb(db(), adminPayoutAccountsQuery.parse({ page: "2", pageSize: "4" }))
    assert.equal(one.total, 9)
    assert.deepEqual(one.items.map((x) => x.handle), ["missing-label", "pending-label", "ready-label", "restricted-label"])
  })
})

describe("can sell matches the sell rule checkout uses (brandForSaleSql)", () => {
  it("a claimed founding brand sells without a payout account (with the note to add one), and with one", async () => {
    await brand("claimed-label", { name: "Claimed Label", founding: true, claimStatus: "claimed", launchedAt: new Date("2026-11-01T10:00:00Z") })
    await published("claimed-label")
    const row = async () => (await listPayoutAccountsDb(db(), adminPayoutAccountsQuery.parse({ q: "claimed-label" }))).items[0]
    let r = await row()
    assert.equal(r.canSell, true)
    assert.deepEqual(r.reasons, [])
    assert.equal(r.sellNote, "Add a payout account to get paid")
    await account("claimed-label")
    r = await row()
    assert.equal(r.canSell, true)
    assert.deepEqual(r.reasons, [])
    assert.equal(r.sellNote, null)
  })

  it("lib/sell-rule.ts agrees with brandForSaleSql on every claim status, with and without an account", async () => {
    const forSale = async (id: string) => {
      const [x] = await d.select({ forSale: sql<boolean>`${brandForSaleSql()}` }).from(brands).where(eq(brands.id, id))
      return !!x.forSale
    }
    for (const claimStatus of ["none", "unclaimed", "claimed"]) {
      for (const withAccount of [false, true]) {
        const key = `rule-${claimStatus}-${withAccount ? "acct" : "none"}`
        await brand(key, { founding: claimStatus !== "none", claimStatus })
        if (withAccount) await account(key)
        assert.equal(await forSale(`b_${key}`), notForSaleOf(claimStatus) === null, key)
      }
    }
  })
})
