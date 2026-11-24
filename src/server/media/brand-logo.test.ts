import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import { brandLogoSrc } from "./brand-logo"

/*
 * The brand logo on the read paths that show a brand avatar (media/brand-logo.ts): the logo comes
 * back only while its file is public and not removed; a private or removed file, or no logo at
 * all, comes back null so the UI shows the brand's initials. Checked on the real DTO builders:
 * the inbox summary (shopper list, thread header), search brand hits and the brand facet, the
 * follows list, the shopper's order summaries and Admin › Brands › All brands. Those modules are
 * "server-only" and read the app's database (db()), so they run in a child under the
 * react-server condition, on a throwaway PGlite data directory with every migration applied.
 */

const SELF = fileURLToPath(import.meta.url)
const CHILD = process.env.BRAND_LOGO_CHILD

type Logos = Record<string, string | null | undefined>
type Result = { inbox: Logos; search: Logos; facet: Logos; follows: Logos; orders: Logos; admin: Logos }

const PUB = "med_bl_public"

if (!CHILD) {
  describe("brandLogoSrc", () => {
    it("is the bare /api/media address of a public logo, and null without one", () => {
      assert.equal(brandLogoSrc(PUB), `/api/media/${PUB}`)
      assert.equal(brandLogoSrc(null), null)
      assert.equal(brandLogoSrc(undefined), null)
    })
  })

  describe("brand logos in DTOs (inbox, search, follows, orders, admin brands)", () => {
    it("include the logo while it is public, and leave it out when it is private, removed or missing", () => {
      const dir = mkdtempSync(path.join(tmpdir(), "yard-brand-logo-"))
      try {
        const out = execFileSync(process.execPath, ["--conditions=react-server", "--import", "tsx", SELF], {
          env: { ...process.env, BRAND_LOGO_CHILD: "run", NODE_ENV: "test", NODE_TEST_CONTEXT: "", YARD_DATA_DIR: dir, DATABASE_URL: "" },
          encoding: "utf8",
          timeout: 180_000,
        })
        const line = out.trim().split("\n").filter((l) => l.startsWith("{")).pop()
        const r = JSON.parse(line!) as Result
        const expected = { b_bl_public: `/api/media/${PUB}`, b_bl_private: null, b_bl_removed: null, b_bl_none: null }
        for (const [where, logos] of Object.entries(r)) assert.deepEqual(logos, expected, where)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  })
} else {
  async function run(): Promise<Result> {
    const { sql, eq } = await import("drizzle-orm")
    const { db } = await import("../db")
    const { brands, conversations, conversationParticipants, mediaAssets, orderRefs, shopperFollows, users } = await import("../db/schema")
    const { selectSummaries, toSummary } = await import("../inbox/dto")
    const { reindexBrand, reindexProduct, searchBrandsQuery, searchCatalog } = await import("../search")
    const { catalogProducts, catalogVariants } = await import("../db/schema/catalog")
    const { listFollows } = await import("../follows")
    const { shopperOrders } = await import("../orders/views")
    const { listAdminBrandsDb } = await import("../admin/brands-directory-db")
    const d = await db()

    await d.insert(users).values({ id: "u_bl", kind: "shopper", name: "Logo Shopper", email: "logo-shopper@example.test" })
    const media = (id: string, brandId: string, visibility: "public" | "private", moderationStatus: "ok" | "removed") =>
      d.insert(mediaAssets).values({ id, ownerKind: "brand", ownerId: brandId, brandId, purpose: "onboarding_image", mime: "image/png", ext: "png", bytes: 1, sha256: id, storagePath: `${id}.png`, visibility, moderationStatus, source: "upload" })
    const cases = [
      { key: "public", logo: PUB, visibility: "public", moderation: "ok" },
      { key: "private", logo: "med_bl_private", visibility: "private", moderation: "ok" },
      { key: "removed", logo: "med_bl_removed", visibility: "public", moderation: "removed" },
      { key: "none", logo: null, visibility: "public", moderation: "ok" },
    ] as const
    let n = 0
    for (const c of cases) {
      const id = `b_bl_${c.key}`
      n++
      await d.insert(brands).values({ id, handle: `bl-${c.key}`, name: `Logotest ${c.key}`, city: "Lagos", citySlug: "lagos", country: "NG", currency: "NGN", categories: ["streetwear"], followersBase: 0, timeZone: "Africa/Lagos", reviewStatus: "verified", verified: true })
      if (c.logo) {
        await media(c.logo, id, c.visibility, c.moderation)
        await d.update(brands).set({ logoMediaId: c.logo }).where(eq(brands.id, id))
      }
      // A conversation with the shopper, a follow, an order and a published piece (for the brand facet).
      await d.insert(conversations).values({ id: `cv_bl_${c.key}`, kind: "brand", brandId: id, customerId: "u_bl", origin: "storefront" })
      await d.insert(conversationParticipants).values({ conversationId: `cv_bl_${c.key}`, side: "customer", partyId: "u_bl" })
      await d.insert(shopperFollows).values({ userId: "u_bl", brandId: id })
      await d.execute(sql`set session_replication_role = replica`)
      await d.insert(orderRefs).values({ id: `or_bl_${c.key}`, groupId: "og_bl", reference: `YD-BL-${n}`, brandId: id, customerId: "u_bl", placedAt: new Date(Date.UTC(2026, 10, 20, n)), status: "paid", paid: true, currency: "NGN", subtotalMinor: 1000, shippingMinor: 0, totalMinor: 1000, items: [], shipToCountry: "NG", source: "browser" })
      await d.execute(sql`set session_replication_role = origin`)
      await d.insert(catalogProducts).values({ id: `p_bl_${c.key}`, brandId: id, slug: `bl-${c.key}-tee`, title: "Logotest tee", categorySlug: "streetwear", priceMinor: 1_000_000, currency: "NGN", status: "published", publishedAt: new Date("2026-11-01T10:00:00Z") })
      await d.insert(catalogVariants).values({ id: `v_bl_${c.key}`, productId: `p_bl_${c.key}`, brandId: id, sku: `BL-${c.key}-M`, options: { Size: "M" }, onHand: 3 })
      await reindexBrand(id)
      await reindexProduct(`p_bl_${c.key}`)
    }

    const ours = (id: string) => id.startsWith("b_bl_")
    const byBrand = <T,>(rows: T[], id: (r: T) => string, logo: (r: T) => string | null | undefined): Logos => Object.fromEntries(rows.filter((r) => ours(id(r))).map((r) => [id(r), logo(r)]).sort(([a], [b]) => String(a).localeCompare(String(b))).map(([k, v]) => [k, v ?? null]))
    const sorted = (l: Logos) => Object.fromEntries(Object.entries(l).sort(([a], [b]) => a.localeCompare(b)))

    const summaries = (await selectSummaries("customer", eq(conversations.customerId, "u_bl"))).map((r) => toSummary(r, "customer"))
    const hits = await searchBrandsQuery("Logotest", 10)
    const catalog = await searchCatalog({ q: "Logotest", currency: "NGN" })
    const follows = await listFollows("u_bl")
    const orders = await shopperOrders("u_bl", { limit: 10 })
    const admin = await listAdminBrandsDb(d, { q: "Logotest" })
    return {
      inbox: sorted(byBrand(summaries, (s) => s.brand.id, (s) => s.brand.logoSrc)),
      search: sorted(byBrand(hits, (h) => h.brandId, (h) => h.logoSrc)),
      facet: sorted(byBrand(catalog.facets.brands, (b) => b.value, (b) => b.logoSrc)),
      follows: sorted(byBrand(follows, (f) => f.brandId, (f) => f.logoSrc)),
      orders: sorted(byBrand(orders.items, (o) => o.brand.id, (o) => o.brand.logoSrc)),
      admin: sorted(byBrand(admin.items, (b) => b.id, (b) => b.logoSrc)),
    }
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
