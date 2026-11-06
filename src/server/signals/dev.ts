import "server-only"
import { and, desc, eq, like, or } from "drizzle-orm"
import { db, withTx } from "../db"
import { chartEvents, rateLimitBuckets, shopperFollows, shopperReminders, shopperWishlist } from "../db/schema"
import { getEnv } from "../env"
import { resetWindows } from "../security/rate-limit"

/** Dev-only helpers behind /api/dev/signals (never reachable in production). */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)

export async function listTestSignals(who: { exact: string } | { prefix: string }, limit = 100) {
  if (!getEnv().dev) throw new Error("dev only")
  const d = await db()
  const actorWhere = "exact" in who ? eq(chartEvents.actorId, who.exact) : like(chartEvents.actorId, `${escapeLike(who.prefix)}%`)
  const userLike = (col: typeof shopperFollows.userId | typeof shopperWishlist.userId | typeof shopperReminders.userId) => ("exact" in who ? eq(col, who.exact) : like(col, `${escapeLike(who.prefix)}%`))
  const rows = await d.select().from(chartEvents).where(actorWhere).orderBy(desc(chartEvents.seq)).limit(limit)
  const [follows, wishlist, reminders] = await Promise.all([
    d.select({ userId: shopperFollows.userId, brandId: shopperFollows.brandId }).from(shopperFollows).where(userLike(shopperFollows.userId)),
    d.select({ userId: shopperWishlist.userId, productId: shopperWishlist.productId }).from(shopperWishlist).where(userLike(shopperWishlist.userId)),
    d.select({ userId: shopperReminders.userId, dropId: shopperReminders.dropId }).from(shopperReminders).where(userLike(shopperReminders.userId)),
  ])
  return {
    items: rows.map((r) => ({ seq: r.seq, kind: r.kind, brandId: r.brandId, actorId: r.actorId, verdict: r.verdict, day: r.day, ipHash: r.ipHash, createdAt: r.createdAt.toISOString() })),
    state: { follows, wishlist, reminders },
  }
}

/** Clears test actors' (u_t_…) follow/wishlist/reminder state, today's events and their rate windows. */
export async function clearTestSignals(prefix: string) {
  if (!getEnv().dev || !prefix.startsWith("u_t_")) throw new Error("dev only, test accounts only")
  const p = `${escapeLike(prefix)}%`
  const today = new Date().toISOString().slice(0, 10)
  const out = await withTx(async () => {
    const d = await db()
    const events = await d.delete(chartEvents).where(and(like(chartEvents.actorId, p), eq(chartEvents.day, today))).returning({ seq: chartEvents.seq })
    const follows = await d.delete(shopperFollows).where(like(shopperFollows.userId, p)).returning({ u: shopperFollows.userId })
    const wishlist = await d.delete(shopperWishlist).where(like(shopperWishlist.userId, p)).returning({ u: shopperWishlist.userId })
    const reminders = await d.delete(shopperReminders).where(like(shopperReminders.userId, p)).returning({ u: shopperReminders.userId })
    // Durable daily upload caps of the same test actors (uploads:day:shopper:u_t_…:<date>).
    await d.delete(rateLimitBuckets).where(or(like(rateLimitBuckets.key, `uploads:day:shopper:${p}`), like(rateLimitBuckets.key, `reports:day:shopper:${p}`)))
    return { events: events.length, follows: follows.length, wishlist: wishlist.length, reminders: reminders.length }
  })
  let windows = 0
  for (const action of ["signals", "uploads", "reports"]) windows += resetWindows(`${action}:shopper:${prefix}`)
  return { ...out, windows }
}
