import "server-only"
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { and, eq, inArray } from "drizzle-orm"
import { writeAudit } from "../audit"
import { db, withTx } from "../db"
import { socialAccounts, socialDataDeletions, socialPosts } from "../db/schema"
import { getEnv } from "../env"
import { mediaIdsOf, type StoredMedia } from "./dto"
import { deleteImportedMedia, refreshMedia } from "./media-ops"
import { setAccountStatus } from "./state"
import { deleteTokens } from "./tokens"

/**
 * Meta's required callbacks for Instagram (§6.1, SEC-11). They exist only when Instagram is
 * configured (the routes answer 404 otherwise, so nothing can be "signed" with an empty secret),
 * verify `signed_request` with timingSafeEqual, and touch only live Instagram accounts: sandbox
 * accounts are never matched.
 */

const b64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64")

/** The verified payload of a signed_request, or null. Requires algorithm HMAC-SHA256. */
export function verifySignedRequest(signed: string, secret: string): { user_id?: string; algorithm?: string } | null {
  if (!secret || secret.length < 16) return null
  const parts = String(signed ?? "").split(".")
  if (parts.length !== 2 || !parts[0] || !parts[1] || parts[1].length > 8192) return null
  const [sigPart, payloadPart] = parts
  const sig = b64url(sigPart)
  const expected = createHmac("sha256", secret).update(payloadPart).digest()
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return null
  try {
    const payload = JSON.parse(b64url(payloadPart).toString("utf8")) as { user_id?: unknown; algorithm?: unknown }
    if (String(payload.algorithm ?? "").toUpperCase() !== "HMAC-SHA256") return null
    return { user_id: payload.user_id != null ? String(payload.user_id) : undefined, algorithm: "HMAC-SHA256" }
  } catch {
    return null
  }
}

async function liveInstagramAccounts(externalUserId: string) {
  const d = await db()
  return d
    .select()
    .from(socialAccounts)
    .where(and(eq(socialAccounts.provider, "instagram"), eq(socialAccounts.mode, "live"), eq(socialAccounts.externalUserId, externalUserId)))
}

/** Deauthorize: mark the accounts revoked, delete their tokens, hide imports, notify the brand. */
export async function deauthorize(externalUserId: string) {
  const accounts = (await liveInstagramAccounts(externalUserId)).filter((a) => a.status !== "disconnected" && a.status !== "revoked")
  return withTx(async () => {
    const d = await db()
    for (const acct of accounts) {
      await deleteTokens(acct.id)
      await setAccountStatus(acct, "revoked", { detail: "Yard's access was removed in Instagram. Reconnect to show your posts again.", errorCode: "deauthorized" })
      const posts = await d
        .update(socialPosts)
        .set({ visibility: "hidden", updatedAt: new Date() })
        .where(and(eq(socialPosts.accountId, acct.id), eq(socialPosts.source, "instagram")))
        .returning({ media: socialPosts.media })
      await refreshMedia(posts.flatMap((p) => mediaIdsOf(p.media as StoredMedia[])))
      await writeAudit({ actor: { kind: "system", name: "Instagram" }, action: "social.deauthorized", target: `Instagram @${acct.handle ?? ""}`, subjectType: "social_account", subjectId: acct.id, brandId: acct.brandId, meta: { provider: "instagram" } })
    }
    return { accounts: accounts.length }
  })
}

/**
 * Data deletion: records the request under a random confirmation code, deletes the imported
 * posts and their media (files after commit), marks the request completed, and answers with the
 * status URL Meta shows the person.
 */
export async function dataDeletion(externalUserId: string) {
  const code = randomBytes(16).toString("base64url")
  const accounts = await liveInstagramAccounts(externalUserId)
  await withTx(async () => {
    const d = await db()
    await d.insert(socialDataDeletions).values({ id: code, provider: "instagram", externalUserId, status: "received" })
    for (const acct of accounts) {
      await deleteTokens(acct.id)
      const posts = await d
        .delete(socialPosts)
        .where(and(eq(socialPosts.accountId, acct.id), eq(socialPosts.source, "instagram")))
        .returning({ media: socialPosts.media })
      const ids = posts.flatMap((p) => mediaIdsOf(p.media as StoredMedia[]))
      if (acct.avatarMediaId) ids.push(acct.avatarMediaId)
      await deleteImportedMedia(ids, [acct.brandId])
      if (acct.status !== "disconnected") await setAccountStatus(acct, "revoked", { detail: "Instagram asked Yard to delete this account's data. Reconnect to show your posts again.", errorCode: "data_deleted" })
      await d.update(socialAccounts).set({ handle: null, displayName: null, avatarMediaId: null }).where(eq(socialAccounts.id, acct.id))
      await writeAudit({ actor: { kind: "system", name: "Instagram" }, action: "social.data_deleted", subjectType: "social_account", subjectId: acct.id, brandId: acct.brandId, meta: { provider: "instagram", posts: posts.length } })
    }
    await d.update(socialDataDeletions).set({ status: "completed", completedAt: new Date() }).where(eq(socialDataDeletions.id, code))
  })
  return { url: `${getEnv().publicUrl}/legal/data-deletion?code=${encodeURIComponent(code)}`, confirmation_code: code }
}

/** GET /api/social/data-deletion/{code}: status only. */
export async function deletionStatus(code: string) {
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(code)) return null
  const d = await db()
  const [row] = await d.select({ status: socialDataDeletions.status }).from(socialDataDeletions).where(inArray(socialDataDeletions.id, [code])).limit(1)
  return row ? { status: row.status as "received" | "completed" } : null
}
