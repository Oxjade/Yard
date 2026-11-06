import "server-only"
import { sql } from "drizzle-orm"
import { adminMembers, users } from "../schema"
import { db } from "../tx"
import type { SeedModule } from "./types"

/** Brand staff (Appendix D). Their memberships are written by the brands module. */
export const brandStaff = [
  { id: "u_b_tobi", name: "Tobi Adeyemi", email: "tobi@lagosstatic.example" },
  { id: "u_b_kemi", name: "Kemi Balogun", email: "kemi@lagosstatic.example" },
  { id: "u_b_designer", name: "Dami Ade", email: "dami@lagosstatic.example" },
  { id: "u_b_viewer", name: "Tolu Bakare", email: "tolu@lagosstatic.example" },
  { id: "u_b_minji", name: "Min-ji Park", email: "minji@nullform.example" },
  { id: "u_b_orun", name: "Adaeze Okafor", email: "adaeze@orunstudio.example" },
  { id: "u_b_multi", name: "Remi Cole", email: "remi@kumasithread.example" },
] as const

/** Test shoppers: each cluster mutates only its own (Appendix D). */
export const testShoppers = ["f1", "i1", "i2", "i3", "c1", "c2", "c3", "c4", "c5", "a1", "d1", "m1", "m2", "s1"] as const

const at = (isoDay: string, plusDays = 0) => {
  const d = new Date(`${isoDay}T09:00:00Z`)
  d.setUTCDate(d.getUTCDate() + plusDays)
  return d
}

const excluded = (column: string) => sql.raw(`excluded.${column}`)

/**
 * People (F1): Ada, the 64 sample shoppers (statuses copied from the Admin Users sample, so both
 * views agree: u_7 restricted, u_23 suspended), the u_t_* test shoppers, brand staff and the
 * admin team. Rows are upserted, so a reseed restores sample names and statuses without
 * deleting anyone (sessions and conversations point at these ids).
 */
const seed: SeedModule = {
  key: "seed:people",
  version: 1,
  async run(ctx) {
    const d = await db()
    const rows = [
      { id: "u_ada", kind: "shopper", name: "Ada Nwosu", email: "ada@example.com", city: "Lagos", country: "NG", status: "active", createdAt: at("2026-03-01") },
      ...ctx.shoppers.map((s, i) => ({
        id: s.id,
        kind: "shopper",
        name: s.name,
        email: s.email,
        city: s.city,
        country: s.country,
        status: ctx.platformUsers.find((u) => u.id === s.id)?.status ?? "active",
        // u_7 reads as a brand-new account to spam scoring (§5.2). It has no restriction rows,
        // so it can still message.
        createdAt: s.id === "u_7" ? new Date(ctx.now.getTime() - 2 * 3600_000) : at("2026-01-01", i),
      })),
      ...testShoppers.map((x) => ({
        id: `u_t_${x}`,
        kind: "shopper",
        name: `Test shopper ${x.toUpperCase()}`,
        email: `t-${x}@example.test`,
        city: null,
        country: null,
        status: "active",
        createdAt: at("2026-06-01"),
      })),
      ...brandStaff.map((s) => ({ ...s, kind: "brand_staff", city: null, country: null, status: "active", createdAt: at("2026-02-01") })),
      ...ctx.adminTeam.map((a) => ({ id: a.id, kind: "admin", name: a.name, email: a.email, city: null, country: null, status: "active", createdAt: at("2026-01-02") })),
    ]
    await d
      .insert(users)
      .values(rows.map((r) => ({ ...r, demo: true })))
      .onConflictDoUpdate({
        target: users.id,
        set: {
          kind: excluded("kind"),
          name: excluded("name"),
          email: excluded("email"),
          city: excluded("city"),
          country: excluded("country"),
          status: excluded("status"),
          createdAt: excluded("created_at"),
        },
      })
    await d
      .insert(adminMembers)
      .values(ctx.adminTeam.map((a) => ({ userId: a.id, role: a.role, mfa: a.mfa })))
      .onConflictDoUpdate({ target: adminMembers.userId, set: { role: excluded("role"), mfa: excluded("mfa") } })
  },
}

export default seed
