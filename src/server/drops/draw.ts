import "server-only"
import { randomBytes } from "node:crypto"
import { and, asc, eq, inArray, lte } from "drizzle-orm"
import { db, withTx } from "../db"
import { users } from "../db/schema"
import { dropEntries, drops } from "../db/schema/engagement"
import { sha256hex } from "../security/crypto"

/**
 * Fair, verifiable draws. When a draw drop is scheduled the server picks a random 32-byte seed and
 * publishes only sha256(seed) (draw_seed_hash). At the draw every entry gets the key
 * sha256(seed + ":" + dropId + ":" + userId); entries sorted by key ascending give the order, the
 * first N win, the rest are waitlisted in that order. After the draw the seed is published, so
 * anyone can recompute the hash and the order. Nobody (brand or Yard staff) can choose the seed
 * after entries are in, and the order doesn't depend on when someone entered.
 */
export const DRAW_ALGORITHM =
  "Before entries open Yard commits to a secret random seed by publishing its SHA-256 hash. At the draw each entry's key is SHA-256(seed + ':' + dropId + ':' + userId); entries are ordered by key (ascending hex), the first N are winners and the rest are waitlisted in order. The seed is published after the draw so the hash and the order can be checked."

export function newDrawSeed() {
  const seed = randomBytes(32).toString("hex")
  return { seed, hash: sha256hex(seed) }
}

export function entryKey(seed: string, dropId: string, userId: string) {
  return sha256hex(`${seed}:${dropId}:${userId}`)
}

export function winnersFor(drop: { winnersCount: number | null; totalUnits: number; limitPerCustomer: number }) {
  if (drop.winnersCount) return drop.winnersCount
  return Math.max(drop.totalUnits > 0 ? 1 : 0, Math.floor(drop.totalUnits / Math.max(1, drop.limitPerCustomer)))
}

/** The purchase window a winner (or promoted waitlister) gets, never past the drop's end. */
export function windowFor(drop: { startsAt: Date; endsAt: Date; purchaseWindowMinutes: number }, from: Date) {
  const opens = from > drop.startsAt ? from : drop.startsAt
  const ends = new Date(Math.min(opens.getTime() + drop.purchaseWindowMinutes * 60_000, drop.endsAt.getTime()))
  return { opens, ends }
}

export type DrawOutcome = { dropId: string; entries: number; winners: { userId: string; windowEndsAt: Date }[]; waitlisted: string[]; excluded: string[] } | null

/**
 * Runs a drop's draw once (no-op when already drawn, not a draw, or entries still open). Inside one
 * transaction: ranks every entry, marks winners and the waitlist, reveals the seed.
 */
export async function runDraw(dropId: string, now = new Date()): Promise<DrawOutcome> {
  return withTx(async (tx) => {
    const [drop] = await tx.select().from(drops).where(eq(drops.id, dropId)).limit(1)
    if (!drop || drop.access !== "draw" || drop.drawnAt || !drop.drawSeed) return null
    if (drop.status !== "scheduled" && drop.status !== "live") return null
    const closes = drop.entryClosesAt ?? drop.startsAt
    if (now < closes) return null
    const entries = await tx
      .select({ id: dropEntries.id, userId: dropEntries.userId, status: dropEntries.status, userStatus: users.status })
      .from(dropEntries)
      .innerJoin(users, eq(users.id, dropEntries.userId))
      .where(and(eq(dropEntries.dropId, drop.id), eq(dropEntries.status, "entered")))
    const eligible = entries.filter((e) => e.userStatus !== "suspended")
    const excluded = entries.filter((e) => e.userStatus === "suspended")
    const ordered = eligible.map((e) => ({ ...e, key: entryKey(drop.drawSeed!, drop.id, e.userId) })).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    const n = winnersFor(drop)
    const { opens, ends } = windowFor(drop, now)
    const winners: { userId: string; windowEndsAt: Date }[] = []
    const waitlisted: string[] = []
    for (let i = 0; i < ordered.length; i++) {
      const e = ordered[i]
      if (i < n) {
        await tx.update(dropEntries).set({ status: "won", rank: i + 1, windowOpensAt: opens, windowEndsAt: ends, decidedAt: now }).where(eq(dropEntries.id, e.id))
        winners.push({ userId: e.userId, windowEndsAt: ends })
      } else {
        await tx.update(dropEntries).set({ status: "waitlisted", rank: i + 1, decidedAt: now }).where(eq(dropEntries.id, e.id))
        waitlisted.push(e.userId)
      }
    }
    if (excluded.length) await tx.update(dropEntries).set({ status: "lost", decidedAt: now }).where(inArray(dropEntries.id, excluded.map((e) => e.id)))
    await tx.update(drops).set({ drawnAt: now, updatedAt: now }).where(eq(drops.id, drop.id))
    return { dropId: drop.id, entries: entries.length, winners, waitlisted, excluded: excluded.map((e) => e.userId) }
  })
}

/**
 * Expires winners whose window closed without a purchase and passes each place to the next
 * waitlisted entry (while the drop is still running). Returns the promoted users per drop.
 */
export async function expireWindows(now = new Date()): Promise<{ dropId: string; promoted: { userId: string; windowEndsAt: Date }[]; expired: string[] }[]> {
  const d = await db()
  const due = await d
    .selectDistinct({ dropId: dropEntries.dropId })
    .from(dropEntries)
    .where(and(eq(dropEntries.status, "won"), lte(dropEntries.windowEndsAt, now)))
  const out: { dropId: string; promoted: { userId: string; windowEndsAt: Date }[]; expired: string[] }[] = []
  for (const { dropId } of due) {
    const r = await withTx(async (tx) => {
      const [drop] = await tx.select().from(drops).where(eq(drops.id, dropId)).limit(1)
      if (!drop) return null
      const expired = await tx
        .update(dropEntries)
        .set({ status: "expired", decidedAt: now })
        .where(and(eq(dropEntries.dropId, dropId), eq(dropEntries.status, "won"), lte(dropEntries.windowEndsAt, now)))
        .returning({ userId: dropEntries.userId })
      const promoted: { userId: string; windowEndsAt: Date }[] = []
      const running = (drop.status === "live" || drop.status === "scheduled") && now < drop.endsAt
      if (running && expired.length) {
        const next = await tx
          .select({ id: dropEntries.id, userId: dropEntries.userId })
          .from(dropEntries)
          .where(and(eq(dropEntries.dropId, dropId), eq(dropEntries.status, "waitlisted")))
          .orderBy(asc(dropEntries.rank))
          .limit(expired.length)
        const { opens, ends } = windowFor(drop, now)
        if (ends.getTime() - opens.getTime() >= 5 * 60_000) {
          for (const e of next) {
            await tx.update(dropEntries).set({ status: "won", windowOpensAt: opens, windowEndsAt: ends, decidedAt: now }).where(eq(dropEntries.id, e.id))
            promoted.push({ userId: e.userId, windowEndsAt: ends })
          }
        }
      }
      return { dropId, promoted, expired: expired.map((e) => e.userId) }
    })
    if (r) out.push(r)
  }
  return out
}

/** Undecided draw entries of drops that ended: waitlisted/entered become lost. */
export async function closeEntries(dropId: string) {
  const d = await db()
  await d
    .update(dropEntries)
    .set({ status: "lost", decidedAt: new Date() })
    .where(and(eq(dropEntries.dropId, dropId), inArray(dropEntries.status, ["entered", "waitlisted"])))
  await d
    .update(dropEntries)
    .set({ status: "expired", decidedAt: new Date() })
    .where(and(eq(dropEntries.dropId, dropId), eq(dropEntries.status, "won")))
}
