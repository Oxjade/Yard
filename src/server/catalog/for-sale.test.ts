import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"

/*
 * The sell rule on the real read paths (catalog/for-sale-sql.ts brandForSaleSql): a claimed founding
 * brand sells without a payout account, like an ordinary brand, and an unclaimed one never does.
 * Checked through getSellableVariants (cart pricing, PDP availability), isSellable (the stock hold
 * inside checkout) and priceLines (cart pricing). Those modules are "server-only" and read the app's
 * database (db()), so they run in a child under the react-server condition, on a throwaway PGlite
 * data directory with every migration applied.
 */

const SELF = fileURLToPath(import.meta.url)
const CHILD = process.env.FOR_SALE_CHILD

type Result = {
  sellable: Record<string, { forSale: boolean; notForSale: string | null; available: number }>
  held: string[]
  priced: Record<string, { status: string; unavailableReason?: string }>
}

if (!CHILD) {
  describe("who can sell (getSellableVariants, isSellable, cart pricing)", () => {
    it("a claimed founding brand without a payout account sells; an unclaimed one doesn't", () => {
      const dir = mkdtempSync(path.join(tmpdir(), "yard-for-sale-"))
      try {
        const out = execFileSync(process.execPath, ["--conditions=react-server", "--import", "tsx", SELF], {
          env: { ...process.env, FOR_SALE_CHILD: "run", NODE_ENV: "test", NODE_TEST_CONTEXT: "", YARD_DATA_DIR: dir, DATABASE_URL: "" },
          encoding: "utf8",
          timeout: 180_000,
        })
        const line = out.trim().split("\n").filter((l) => l.startsWith("{")).pop()
        const r = JSON.parse(line!) as Result
        // Claimed founding brand, no payout account: for sale, stock available, held, priced.
        assert.deepEqual(r.sellable.v_claimed, { forSale: true, notForSale: null, available: 3 })
        assert.ok(r.held.includes("v_claimed"))
        assert.equal(r.priced.v_claimed.status, "ok")
        // Ordinary brand without a payout account: the same.
        assert.deepEqual(r.sellable.v_ordinary, { forSale: true, notForSale: null, available: 3 })
        assert.ok(r.held.includes("v_ordinary"))
        assert.equal(r.priced.v_ordinary.status, "ok")
        // Unclaimed founding brand (even with a payout account): shown, never sold.
        assert.deepEqual(r.sellable.v_unclaimed, { forSale: false, notForSale: "unclaimed", available: 0 })
        assert.ok(!r.held.includes("v_unclaimed"))
        assert.deepEqual(r.priced.v_unclaimed, { status: "unavailable", unavailableReason: "not_for_sale" })
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  })
} else {
  async function run(): Promise<Result> {
    const { db } = await import("../db")
    const { brands } = await import("../db/schema/brands")
    const { catalogProducts, catalogVariants } = await import("../db/schema/catalog")
    const { brandPayoutAccounts } = await import("../db/schema/ledger")
    const { getSellableVariants, isSellable } = await import("./sellable")
    const { priceLines } = await import("../cart/pricing")
    const d = await db()
    const launched = new Date("2026-11-01T10:00:00Z")
    const brand = async (key: string, over: Partial<typeof brands.$inferInsert>) => {
      await d.insert(brands).values({ id: `b_fs_${key}`, handle: `fs-${key}`, name: `FS ${key}`, city: "Lagos", citySlug: "lagos", country: "NG", currency: "NGN", categories: ["streetwear"], followersBase: 0, timeZone: "Africa/Lagos", reviewStatus: "verified", verified: true, ...over })
      await d.insert(catalogProducts).values({ id: `p_fs_${key}`, brandId: `b_fs_${key}`, slug: `fs-${key}-tee`, title: "Tee", categorySlug: "streetwear", priceMinor: 1_000_000, currency: "NGN", status: "published", publishedAt: launched })
      await d.insert(catalogVariants).values({ id: `v_${key}`, productId: `p_fs_${key}`, brandId: `b_fs_${key}`, sku: `fs-${key}-M`, options: { Size: "M" }, onHand: 3 })
    }
    await brand("claimed", { founding: true, claimStatus: "claimed", launchedAt: launched, claimedAt: launched })
    await brand("ordinary", {})
    await brand("unclaimed", { founding: true, claimStatus: "unclaimed", launchedAt: launched })
    await d.insert(brandPayoutAccounts).values({ brandId: "b_fs_unclaimed", country: "NG", currency: "NGN", bankCode: "058", bankName: "GTBank", accountName: "FS LTD", accountNumberEnc: "v1.sealed.x", accountLast4: "6789", recipientProvider: "stub", updatedBy: "u_x" })
    const ids = ["v_claimed", "v_ordinary", "v_unclaimed"]
    const sellable = Object.fromEntries((await getSellableVariants(ids)).map((s) => [s.variantId, { forSale: s.forSale, notForSale: s.notForSale, available: s.available }]))
    const held = [...(await isSellable(d, ids))]
    const priced = Object.fromEntries((await priceLines(ids.map((variantId) => ({ variantId, qty: 1 })), "NGN")).map((l) => [l.variantId, { status: l.status, ...(l.unavailableReason ? { unavailableReason: l.unavailableReason } : {}) }]))
    return { sellable, held, priced }
  }
  run().then(
    (r) => {
      process.stdout.write(`${JSON.stringify(r)}\n`)
      process.exit(0)
    },
    (e) => {
      process.stderr.write(String(e?.stack ?? e))
      process.exit(1)
    },
  )
}
