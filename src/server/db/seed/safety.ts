import "server-only"
import { and, eq, inArray, sql } from "drizzle-orm"
import type { Actor } from "../../auth/dal"
import { NotImplemented } from "../../http/errors"
import { buildSnapshot } from "../../reports"
import { brandRolePermissions } from "@/lib/permissions"
import { db } from "../tx"
import { abuseEvents, brands, reports, users } from "../schema"
import type { SeedModule } from "./types"

/**
 * Safety fixtures (Appendix D, cluster M). Four reports, each with a snapshot frozen by the same
 * function live reports use (F2's reports.buildSnapshot), and a few rate-limit hits for u_7.
 * No restrictions and no abuse alerts: those only ever come from an admin or the spam rules.
 * Re-running deletes the fixed rows first (POST /api/dev/reseed?module=safety).
 */

const REPORT_IDS = ["rp_seed_msg", "rp_seed_post", "rp_seed_place", "rp_seed_event"]

async function shopperActor(userId: string): Promise<Actor> {
  const d = await db()
  const u = await d.query.users.findFirst({ where: (x, { eq }) => eq(x.id, userId) })
  if (!u) throw new Error(`seed:safety needs ${userId}`)
  return { kind: "shopper", sessionId: "seed", userId: u.id, name: u.name, email: u.email, status: u.status as "active", createdAt: u.createdAt, demo: u.demo }
}

async function brandActor(userId: string, brandId: string): Promise<Actor> {
  const d = await db()
  const [u] = await d.select().from(users).where(eq(users.id, userId))
  const [b] = await d.select().from(brands).where(eq(brands.id, brandId))
  if (!u || !b) throw new Error(`seed:safety needs ${userId} in ${brandId}`)
  return {
    kind: "brand",
    sessionId: "seed",
    userId: u.id,
    name: u.name,
    brandId: b.id,
    brand: { id: b.id, handle: b.handle, name: b.name, reviewStatus: b.reviewStatus, currency: b.currency, country: b.country, city: b.city, citySlug: b.citySlug, timeZone: b.timeZone },
    role: "owner",
    permissions: brandRolePermissions.owner,
    demo: u.demo,
  }
}

async function snapshot(actor: Actor, subjectType: string, subjectId: string) {
  try {
    return await buildSnapshot(actor, subjectType, subjectId)
  } catch (e) {
    // Waits like a missing requirement: the module isn't recorded and runs again at the next reseed.
    if (e instanceof NotImplemented) throw new Error("seed:safety waiting for reports.buildSnapshot (F2) so its snapshots match live reports")
    throw e
  }
}

const seed: SeedModule = {
  key: "seed:safety",
  version: 1,
  requires: ["messages:msg_seed_u7_1", "social_posts:sp_seed_gl_1", "brand_locations:loc_seed_pr_maboneng", "location_events:lev_seed_gl_restock"],
  async run(ctx) {
    const d = await db()
    const tobi = await brandActor("u_b_tobi", "b_lagos_static")
    const u2 = await shopperActor("u_2")
    const u3 = await shopperActor("u_3")
    // Snapshots first (they read the subjects as each reporter sees them), then the rows.
    const snaps = {
      msg: await snapshot(tobi, "message", "msg_seed_u7_1"),
      post: await snapshot(u3, "social_post", "sp_seed_gl_1"),
      place: await snapshot(u2, "location", "loc_seed_pr_maboneng"),
      event: await snapshot(u2, "location_event", "lev_seed_gl_restock"),
    }
    await d.delete(reports).where(inArray(reports.id, REPORT_IDS))
    await d.delete(abuseEvents).where(and(eq(abuseEvents.actorId, "u_7"), sql`${abuseEvents.detail}->>'seed' = 'true'`))
    const at = (hoursAgo: number) => new Date(ctx.now.getTime() - hoursAgo * 3600_000)
    await d.insert(reports).values([
      { id: "rp_seed_msg", subjectType: "message", subjectId: "msg_seed_u7_1", brandId: "b_lagos_static", reporterKind: "brand", reporterId: "u_b_tobi", reason: "scam_or_offplatform_payment", snapshot: snaps.msg, priority: 1, createdAt: at(5) },
      { id: "rp_seed_post", subjectType: "social_post", subjectId: "sp_seed_gl_1", brandId: "b_gridlock_supply", reporterKind: "shopper", reporterId: "u_3", reason: "misleading", details: null, snapshot: snaps.post, createdAt: at(20) },
      { id: "rp_seed_place", subjectType: "location", subjectId: "loc_seed_pr_maboneng", brandId: "b_paper_riot", reporterKind: "shopper", reporterId: "u_2", reason: "wrong_location", snapshot: snaps.place, createdAt: at(30) },
      { id: "rp_seed_event", subjectType: "location_event", subjectId: "lev_seed_gl_restock", brandId: "b_gridlock_supply", reporterKind: "shopper", reporterId: "u_2", reason: "misleading", snapshot: snaps.event, createdAt: at(26) },
    ])
    // A few rate-limit hits for u_7 (the seeded spam case): counts only, never message text.
    await d.insert(abuseEvents).values(
      [3, 2, 1].map((h, i) => ({ actorKind: "shopper", actorId: "u_7", action: i === 2 ? "inbox.start" : "inbox.send", rule: i === 2 ? "first_contact_cap" : "rate_limit", detail: { limit: i === 2 ? 5 : 20, windowSec: i === 2 ? 3600 : 60, seed: true }, createdAt: at(h) })),
    )
  },
}

export default seed
