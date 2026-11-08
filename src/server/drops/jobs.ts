import "server-only"
import { and, eq, gt, inArray, isNull, lte, lt } from "drizzle-orm"
import { db, withTx } from "../db"
import { brands, shopperFollows, shopperReminders, users } from "../db/schema"
import { drops } from "../db/schema/engagement"
import { enqueueEmail } from "../email"
import { inAppPref, notifyEngagement, type EngagementTemplate } from "../email/inapp"
import { getPreferencesMany } from "../email/preferences"
import { log } from "../log"
import { closeEntries, expireWindows, runDraw, type DrawOutcome } from "./draw"
import { sweepExpiredClaims } from "./limits"

/**
 * Drop scheduler (every minute): early-access openings, reminders, draws, starts, winner-window
 * expiry with waitlist promotion, ends, and expired checkout claims. Every step is idempotent
 * (a *_sent_at / status column records it), so a missed or repeated tick never double-notifies;
 * notification keys and email dedupe keys guard the rest.
 */

type DropRow = typeof drops.$inferSelect
type Person = { id: string; email: string; name: string }

const CHUNK = 200

async function people(ids: string[]): Promise<Person[]> {
  if (!ids.length) return []
  const d = await db()
  const rows = await d.select({ id: users.id, email: users.email, name: users.name, status: users.status }).from(users).where(inArray(users.id, [...new Set(ids)]))
  return rows.filter((r) => r.status !== "suspended").map(({ status: _s, ...r }) => r)
}

async function brandOf(id: string) {
  const d = await db()
  const [b] = await d.select({ name: brands.name, timeZone: brands.timeZone }).from(brands).where(eq(brands.id, id)).limit(1)
  return b ?? { name: "The brand", timeZone: "UTC" }
}

function when(at: Date, timeZone: string) {
  try {
    return `on ${new Intl.DateTimeFormat("en-GB", { timeZone, dateStyle: "medium", timeStyle: "short", timeZoneName: "short" }).format(at)}`
  } catch {
    return `on ${at.toISOString().slice(0, 16).replace("T", " ")} UTC`
  }
}

/**
 * Notifies people about a drop in chunks of CHUNK per transaction: in-app when their preference
 * allows, email (if `email`) through enqueueEmail, which applies preferences and suppressions.
 */
async function fanout(drop: DropRow, userIds: string[], n: { template: EngagementTemplate; key: string; vars: Record<string, string | number>; email?: { template: string; vars: Record<string, string | number> } }) {
  const href = `/drops/${drop.slug}`
  for (let i = 0; i < userIds.length; i += CHUNK) {
    const batch = await people(userIds.slice(i, i + CHUNK))
    const prefs = await getPreferencesMany(batch.map((p) => p.id))
    const pref = inAppPref(n.template)
    await withTx(async (tx) => {
      for (const p of batch) {
        if (!pref || prefs.get(p.id)?.inApp[pref] !== false) await notifyEngagement({ kind: "shopper", id: p.id }, { key: `${n.key}:${drop.id}`, template: n.template, vars: n.vars, href })
        if (n.email) await enqueueEmail(tx, { template: n.email.template, to: p.email, vars: { name: p.name, url: href, ...n.email.vars }, dedupeKey: `${n.key}:${drop.id}:${p.id}` })
      }
    })
  }
}

async function reminderHolders(dropId: string) {
  const d = await db()
  return (await d.select({ id: shopperReminders.userId }).from(shopperReminders).where(eq(shopperReminders.dropId, dropId))).map((r) => r.id)
}

async function followers(brandId: string, before?: Date | null) {
  const d = await db()
  return (
    await d
      .select({ id: shopperFollows.userId })
      .from(shopperFollows)
      .where(and(eq(shopperFollows.brandId, brandId), before ? lt(shopperFollows.createdAt, before) : undefined))
  ).map((r) => r.id)
}

/** Sends the draw's results: winners and the waitlist, and a summary to the brand. */
export async function announceDraw(out: NonNullable<DrawOutcome>) {
  const d = await db()
  const [drop] = await d.select().from(drops).where(eq(drops.id, out.dropId)).limit(1)
  if (!drop) return
  const b = await brandOf(drop.brandId)
  const byEnd = new Map<number, string[]>()
  for (const w of out.winners) byEnd.set(w.windowEndsAt.getTime(), [...(byEnd.get(w.windowEndsAt.getTime()) ?? []), w.userId])
  for (const [end, ids] of byEnd) {
    const until = when(new Date(end), b.timeZone).replace(/^on /, "")
    await fanout(drop, ids, { template: "drop.draw_won", key: "drop_won", vars: { drop: drop.name, until }, email: { template: "drop_draw_won", vars: { drop: drop.name, until } } })
  }
  await fanout(drop, out.waitlisted, { template: "drop.draw_lost", key: "drop_lost", vars: { drop: drop.name }, email: { template: "drop_draw_lost", vars: { drop: drop.name } } })
  await withTx(() => notifyEngagement({ kind: "brand", id: drop.brandId }, { key: `drop_drawn:${drop.id}`, template: "drop.draw_closed_for_brand", vars: { drop: drop.name, winners: out.winners.length, entries: out.entries }, href: "/studio" }))
}

async function promoted(dropId: string, list: { userId: string; windowEndsAt: Date }[]) {
  if (!list.length) return
  const d = await db()
  const [drop] = await d.select().from(drops).where(eq(drops.id, dropId)).limit(1)
  if (!drop) return
  const b = await brandOf(drop.brandId)
  for (const w of list) {
    const until = when(w.windowEndsAt, b.timeZone).replace(/^on /, "")
    // A new key per window, so a promoted shopper is told even though they got the "not drawn" notice.
    await fanout(drop, [w.userId], { template: "drop.draw_won", key: `drop_won_${w.windowEndsAt.getTime()}`, vars: { drop: drop.name, until }, email: { template: "drop_draw_won", vars: { drop: drop.name, until } } })
  }
}

export async function tick(now = new Date()) {
  const d = await db()
  const counts = { earlyAccess: 0, reminders: 0, draws: 0, started: 0, ended: 0, promoted: 0, claims: 0 }

  // 1. Early access opens: tell followers who qualify.
  const early = await d
    .select()
    .from(drops)
    .where(and(eq(drops.status, "scheduled"), eq(drops.access, "early_access"), lte(drops.earlyAccessAt, now), isNull(drops.earlyAccessSentAt)))
  for (const drop of early) {
    const [claimed] = await withTx((tx) => tx.update(drops).set({ earlyAccessSentAt: now }).where(and(eq(drops.id, drop.id), isNull(drops.earlyAccessSentAt))).returning({ id: drops.id }))
    if (!claimed || now >= drop.startsAt) continue
    const b = await brandOf(drop.brandId)
    await fanout(drop, await followers(drop.brandId, drop.earlyAccessAt), { template: "drop.early_access", key: "drop_early", vars: { drop: drop.name, brand: b.name } })
    counts.earlyAccess++
  }

  // 2. Reminders: lead minutes before release (or before draw entries close).
  const pending = await d
    .select()
    .from(drops)
    .where(and(eq(drops.status, "scheduled"), isNull(drops.reminderSentAt)))
  for (const drop of pending) {
    const target = drop.access === "draw" ? (drop.entryClosesAt ?? drop.startsAt) : drop.startsAt
    if (now.getTime() < target.getTime() - drop.reminderLeadMinutes * 60_000) continue
    const [claimed] = await withTx((tx) => tx.update(drops).set({ reminderSentAt: now }).where(and(eq(drops.id, drop.id), isNull(drops.reminderSentAt))).returning({ id: drops.id }))
    if (!claimed || now >= target) continue // too late to remind: the "live" notice covers it
    const b = await brandOf(drop.brandId)
    const w = drop.access === "draw" ? `entries close ${when(target, b.timeZone)}` : when(target, b.timeZone)
    await fanout(drop, await reminderHolders(drop.id), { template: "drop.reminder", key: "drop_reminder", vars: { drop: drop.name, brand: b.name, when: w }, email: { template: "drop_reminder", vars: { drop: drop.name, brand: b.name, when: w } } })
    counts.reminders++
  }

  // 3. Draws whose entries have closed.
  const due = await d
    .select({ id: drops.id })
    .from(drops)
    .where(and(eq(drops.access, "draw"), inArray(drops.status, ["scheduled", "live"]), isNull(drops.drawnAt)))
  for (const { id } of due) {
    const out = await runDraw(id, now)
    if (out) {
      counts.draws++
      await announceDraw(out)
    }
  }

  // 4. Starts.
  const starting = await d
    .select()
    .from(drops)
    .where(and(eq(drops.status, "scheduled"), lte(drops.startsAt, now), gt(drops.endsAt, now)))
  for (const drop of starting) {
    const [claimed] = await withTx((tx) => tx.update(drops).set({ status: "live", startedAt: now, updatedAt: now }).where(and(eq(drops.id, drop.id), eq(drops.status, "scheduled"))).returning({ id: drops.id }))
    if (!claimed) continue
    counts.started++
    if (drop.access === "draw") continue // winners were told by the draw
    const b = await brandOf(drop.brandId)
    const holders = await reminderHolders(drop.id)
    await fanout(drop, holders, { template: "drop.live", key: "drop_live", vars: { drop: drop.name, brand: b.name }, email: { template: "drop_live", vars: { drop: drop.name, brand: b.name } } })
    const fans = (await followers(drop.brandId)).filter((id) => !holders.includes(id))
    // Followers without a reminder: in-app only, under their brand-news preference.
    const prefs = await getPreferencesMany(fans)
    await fanout(
      drop,
      fans.filter((id) => prefs.get(id)?.inApp.brand_news !== false),
      { template: "drop.live", key: "drop_live", vars: { drop: drop.name, brand: b.name } },
    )
  }

  // 5. Winner windows that closed: expire and promote the waitlist.
  for (const r of await expireWindows(now)) {
    counts.promoted += r.promoted.length
    await promoted(r.dropId, r.promoted)
  }

  // 6. Ends.
  const ending = await d
    .select()
    .from(drops)
    .where(and(inArray(drops.status, ["scheduled", "live"]), lte(drops.endsAt, now)))
  for (const drop of ending) {
    await withTx(async (tx) => {
      const [claimed] = await tx.update(drops).set({ status: "ended", endedAt: now, updatedAt: now }).where(and(eq(drops.id, drop.id), inArray(drops.status, ["scheduled", "live"]))).returning({ id: drops.id })
      if (claimed && drop.access === "draw") await closeEntries(drop.id)
      if (claimed) counts.ended++
    })
  }

  // 7. Expired checkout claims.
  counts.claims = await sweepExpiredClaims()

  if (counts.earlyAccess + counts.reminders + counts.draws + counts.started + counts.ended + counts.promoted) log.info(`[yard] drops: ${JSON.stringify(counts)}`)
  return counts
}
