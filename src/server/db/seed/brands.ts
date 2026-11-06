import "server-only"
import { sql } from "drizzle-orm"
import { brands as sampleBrands } from "@/lib/data/brands"
import { countryTimeZone } from "@/lib/data/zones"
import { brandMembers, brands } from "../schema"
import { db } from "../tx"
import type { SeedModule } from "./types"

/** The brand memberships of Appendix D. */
export const memberships = [
  { id: "tm_owner", brandId: "b_lagos_static", userId: "u_b_tobi", role: "owner" },
  { id: "tm_kemi", brandId: "b_lagos_static", userId: "u_b_kemi", role: "fulfilment" },
  { id: "tm_designer", brandId: "b_lagos_static", userId: "u_b_designer", role: "designer" },
  { id: "tm_viewer", brandId: "b_lagos_static", userId: "u_b_viewer", role: "viewer" },
  { id: "tm_nf_owner", brandId: "b_null_form", userId: "u_b_minji", role: "owner" },
  { id: "tm_or_owner", brandId: "b_orun_studio", userId: "u_b_orun", role: "owner" },
  { id: "tm_kt_owner", brandId: "b_kumasi_thread", userId: "u_b_multi", role: "owner" },
  { id: "tm_sb_owner", brandId: "b_signal_bloom", userId: "u_b_multi", role: "owner" },
] as const

/** "Mexico City" → "mexico-city": the gazetteer's city slugs (Appendix C). */
export const citySlug = (city: string) =>
  city
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")

const excluded = (column: string) => sql.raw(`excluded.${column}`)

/**
 * Brands (F1): a server mirror of the 14 sample brands. review_status copies the matching Admin
 * brand application by handle when there is one, otherwise verified/pending_review.
 */
const seed: SeedModule = {
  key: "seed:brands",
  version: 1,
  async run(ctx) {
    const d = await db()
    const rows = sampleBrands.map((b) => ({
      id: b.id,
      handle: b.handle,
      name: b.name,
      city: b.city,
      citySlug: citySlug(b.city),
      country: b.country,
      currency: b.currency,
      categories: [...b.categories],
      verified: b.verified,
      reviewStatus: ctx.brandApplications.find((a) => a.handle === b.handle)?.status ?? (b.verified ? "verified" : "pending_review"),
      joinedAt: b.joinedAt.slice(0, 10),
      followersBase: b.followers,
      timeZone: countryTimeZone[b.country],
    }))
    await d
      .insert(brands)
      .values(rows)
      .onConflictDoUpdate({
        target: brands.id,
        set: {
          handle: excluded("handle"),
          name: excluded("name"),
          city: excluded("city"),
          citySlug: excluded("city_slug"),
          country: excluded("country"),
          currency: excluded("currency"),
          categories: excluded("categories"),
          verified: excluded("verified"),
          reviewStatus: excluded("review_status"),
          joinedAt: excluded("joined_at"),
          followersBase: excluded("followers_base"),
          timeZone: excluded("time_zone"),
        },
      })
    await d
      .insert(brandMembers)
      .values(memberships.map((m) => ({ ...m, status: "active" })))
      .onConflictDoUpdate({ target: brandMembers.id, set: { role: excluded("role"), status: excluded("status") } })
  },
}

export default seed
