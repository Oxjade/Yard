import "server-only"
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm"
import { writeAudit } from "../audit"
import { afterCommit, db, withTx, type Tx } from "../db"
import { brandMembers, notifications, sessions, shopperFollows, shopperReminders, shopperWishlist, users } from "../db/schema"
import { accountDeletions, adminMfa, authOauthStates, authTokens, mfaRecoveryCodes, oauthIdentities, userCredentials } from "../db/schema/identity"
import { HttpError } from "../http/errors"
import { newId } from "../ids"
import { log } from "../log"
import type { ShopperActor } from "./dal"
import { AUTH_EMAIL_TEMPLATES, sendAuthEmail, userById, type RequestMeta } from "./identity"
import { endSessionsForUser } from "./session"
import { voidTokens } from "./tokens"

/**
 * Shopper account deletion (v3).
 *
 * Request (immediate): needs a recent re-auth (route), then in one transaction: an
 * account_deletions row, every sign-in method removed (password hash, Google/Apple links, open
 * tokens), every session ended, a confirmation email queued. From that moment nobody can sign in.
 *
 * Erasure job (right after commit, and hourly for retries): anonymises the users row (name,
 * email, city, country), deletes AUTH's own rows, notifications and the shopper's follow /
 * wishlist / reminder state, then calls every area's `eraseCustomerData(tx, userId)` hook in the
 * same transaction. Orders and ledger entries are KEPT (financial records) but their owners
 * anonymise the personal fields in their hook. A failing hook rolls the run back; it retries up
 * to 5 times, then the row is `failed` for an admin to look at.
 */

const MAX_ATTEMPTS = 5

/** An area's erasure hook: anonymise or delete what it holds about the customer. Runs in the erasure transaction. */
export type EraseHook = (tx: Tx, userId: string) => Promise<void | { erased?: number; anonymised?: number }>

/**
 * The areas that hold shopper data. Each module's index may export `eraseCustomerData`; a module
 * without it is skipped and named in the run's meta, so a missing hook is visible.
 */
const hookModules: Record<string, () => Promise<Record<string, unknown>>> = {
  orders: () => import("../orders"),
  payments: () => import("../payments"),
  email: () => import("../email"),
  cart: () => import("../cart"),
  follows: () => import("../follows"),
  drops: () => import("../drops"),
}

export async function requestAccountDeletion(actor: ShopperActor, meta: RequestMeta) {
  const user = await userById(actor.userId)
  if (!user) throw new HttpError(404, "not_found", "We couldn't find your account.")
  if (user.demo) throw new HttpError(422, "rule", "Demo accounts can't be deleted.")
  const d = await db()
  // A sole active owner of a brand must hand the brand over first.
  const owned = await d
    .select({ brandId: brandMembers.brandId })
    .from(brandMembers)
    .where(and(eq(brandMembers.userId, user.id), eq(brandMembers.role, "owner"), eq(brandMembers.status, "active")))
  for (const o of owned) {
    const [others] = await d
      .select({ n: sql<number>`count(*)::int` })
      .from(brandMembers)
      .where(and(eq(brandMembers.brandId, o.brandId), eq(brandMembers.role, "owner"), eq(brandMembers.status, "active"), sql`${brandMembers.userId} <> ${user.id}`))
    if (!others?.n) throw new HttpError(422, "rule", "You're the only owner of a brand on Yard. Make someone else an owner before deleting your account.")
  }
  const out = await withTx(async (tx) => {
    const t = await db()
    const [existing] = await t
      .select({ id: accountDeletions.id })
      .from(accountDeletions)
      .where(and(eq(accountDeletions.userId, user.id), inArray(accountDeletions.status, ["pending", "processing"])))
      .limit(1)
    const id = existing?.id ?? newId("del")
    if (!existing) await t.insert(accountDeletions).values({ id, userId: user.id, status: "pending", scheduledFor: new Date() })
    await t.update(userCredentials).set({ passwordHash: null, updatedAt: new Date() }).where(eq(userCredentials.userId, user.id))
    await t.delete(oauthIdentities).where(eq(oauthIdentities.userId, user.id))
    await voidTokens(user.id)
    await sendAuthEmail(tx, AUTH_EMAIL_TEMPLATES.accountDeleted, user.email, { name: user.name }, `account-deleted:${user.id}`)
    await writeAudit({ actor: { kind: "shopper", id: user.id, name: user.name }, action: "account.deletion_requested", target: user.id, subjectType: "user", subjectId: user.id, ipHash: meta.ipHash, meta: { requestId: id } })
    await endSessionsForUser(user.id, ["shopper", "brand", "admin"], "account_deleted")
    return { id }
  })
  afterCommit(() => processDueErasures().then(() => undefined))
  return { ok: true as const, requestId: out.id }
}

/** Erases one user inside the ambient transaction; returns which hook modules ran. */
async function eraseUser(tx: Tx, userId: string) {
  const d = await db()
  const ran: string[] = []
  const skipped: string[] = []
  for (const [name, load] of Object.entries(hookModules)) {
    let mod: Record<string, unknown>
    try {
      mod = await load()
    } catch {
      skipped.push(name)
      continue
    }
    const hook = mod.eraseCustomerData as EraseHook | undefined
    if (typeof hook !== "function") {
      skipped.push(name)
      continue
    }
    await hook(tx, userId)
    ran.push(name)
  }
  // AUTH's own rows and F1 shopper state.
  await d.delete(oauthIdentities).where(eq(oauthIdentities.userId, userId))
  await d.delete(authTokens).where(eq(authTokens.userId, userId))
  await d.delete(authOauthStates).where(eq(authOauthStates.userId, userId))
  await d.delete(adminMfa).where(eq(adminMfa.userId, userId))
  await d.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, userId))
  await d.delete(userCredentials).where(eq(userCredentials.userId, userId))
  await d.delete(sessions).where(eq(sessions.userId, userId))
  await d.delete(notifications).where(and(eq(notifications.recipientKind, "shopper"), eq(notifications.recipientId, userId)))
  await d.delete(shopperFollows).where(eq(shopperFollows.userId, userId))
  await d.delete(shopperWishlist).where(eq(shopperWishlist.userId, userId))
  await d.delete(shopperReminders).where(eq(shopperReminders.userId, userId))
  await d.delete(brandMembers).where(eq(brandMembers.userId, userId))
  // The row stays (orders, messages and audit rows reference it); everything that identifies a person goes.
  await d
    .update(users)
    .set({ name: "Deleted shopper", email: `deleted+${userId}@deleted.invalid`, city: null, country: null, status: "suspended" })
    .where(eq(users.id, userId))
  return { ran, skipped }
}

/** The erasure job: processes due requests (oldest first, at most 20 a run). */
export async function processDueErasures() {
  const d = await db()
  const due = await d
    .select()
    .from(accountDeletions)
    .where(and(eq(accountDeletions.status, "pending"), lte(accountDeletions.scheduledFor, new Date())))
    .orderBy(asc(accountDeletions.scheduledFor))
    .limit(20)
  let done = 0
  for (const req of due) {
    // Claim it (compare-and-set), so the post-commit run and the hourly run never both erase.
    const [claimed] = await d
      .update(accountDeletions)
      .set({ status: "processing", attempts: sql`${accountDeletions.attempts} + 1` })
      .where(and(eq(accountDeletions.id, req.id), eq(accountDeletions.status, "pending")))
      .returning()
    if (!claimed) continue
    try {
      await withTx(async (tx) => {
        const r = await eraseUser(tx, req.userId)
        const t = await db()
        await t
          .update(accountDeletions)
          .set({ status: "completed", completedAt: new Date(), lastError: null, meta: { hooksRan: r.ran, hooksMissing: r.skipped } })
          .where(eq(accountDeletions.id, req.id))
        await writeAudit({ actor: { kind: "system" }, action: "account.erased", target: req.userId, subjectType: "user", subjectId: req.userId, meta: { requestId: req.id, hooksRan: r.ran, hooksMissing: r.skipped } })
      })
      done++
    } catch (e) {
      log.error(`[yard] erasure ${req.id} failed (attempt ${claimed.attempts})`, e)
      const failed = claimed.attempts >= MAX_ATTEMPTS
      await d
        .update(accountDeletions)
        .set({ status: failed ? "failed" : "pending", lastError: e instanceof Error ? e.name.slice(0, 80) : "error", scheduledFor: new Date(Date.now() + 15 * 60_000) })
        .where(eq(accountDeletions.id, req.id))
    }
  }
  return { processed: done, due: due.length }
}

/** The shopper's own deletion status (none / pending / completed). */
export async function deletionStatus(userId: string) {
  const d = await db()
  const [row] = await d.select().from(accountDeletions).where(eq(accountDeletions.userId, userId)).orderBy(sql`${accountDeletions.requestedAt} desc`).limit(1)
  return row ? { status: row.status, requestedAt: row.requestedAt.toISOString() } : null
}
