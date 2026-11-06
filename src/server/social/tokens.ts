import "server-only"
import { eq } from "drizzle-orm"
import { db } from "../db"
import { socialTokens } from "../db/schema/social-tokens"
import { open, seal } from "../security/crypto"
import type { TokenSet } from "./providers"

/**
 * The token vault for social accounts (§5.5). Sealed tokens live only in social_tokens, as
 * v1.<iv>.<tag>.<ct> under keys.vault with the AAD `${brandId}:${provider}:${accountId}`, which
 * binds a token to its tenant. This is the one module that reads or writes that table; nothing
 * here ever returns a token to a route.
 */
export type VaultRef = { accountId: string; brandId: string; provider: string }

const aad = (r: VaultRef) => `${r.brandId}:${r.provider}:${r.accountId}`

/** Seals and upserts an account's tokens (inside the caller's transaction). */
export async function storeTokens(ref: VaultRef, t: Pick<TokenSet, "accessToken" | "refreshToken">) {
  const d = await db()
  const row = {
    accountId: ref.accountId,
    accessTokenEnc: seal(t.accessToken, aad(ref)),
    refreshTokenEnc: t.refreshToken ? seal(t.refreshToken, aad(ref)) : null,
    sealedAt: new Date(),
  }
  await d.insert(socialTokens).values(row).onConflictDoUpdate({ target: socialTokens.accountId, set: { accessTokenEnc: row.accessTokenEnc, refreshTokenEnc: row.refreshTokenEnc, sealedAt: row.sealedAt } })
}

/** Opens an account's tokens, or null when there are none (disconnected) or they can't be opened. */
export async function loadTokens(ref: VaultRef): Promise<{ accessToken: string; refreshToken?: string } | null> {
  const d = await db()
  const [row] = await d.select().from(socialTokens).where(eq(socialTokens.accountId, ref.accountId)).limit(1)
  if (!row) return null
  try {
    return { accessToken: open(row.accessTokenEnc, aad(ref)), refreshToken: row.refreshTokenEnc ? open(row.refreshTokenEnc, aad(ref)) : undefined }
  } catch {
    return null
  }
}

/** Deletes an account's tokens (Disconnect, deauthorize, force disconnect). */
export async function deleteTokens(accountId: string) {
  const d = await db()
  await d.delete(socialTokens).where(eq(socialTokens.accountId, accountId))
}

/** For the curl kit and checks/s.mjs (dev only): how many sealed rows exist and whether all are v1. */
export async function vaultStats() {
  const d = await db()
  const rows = await d.select({ a: socialTokens.accessTokenEnc, r: socialTokens.refreshTokenEnc }).from(socialTokens)
  return { rows: rows.length, allV1: rows.every((x) => x.a.startsWith("v1.") && (x.r === null || x.r.startsWith("v1."))) }
}
