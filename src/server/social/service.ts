import "server-only"
import { and, eq, inArray, ne, notInArray, sql } from "drizzle-orm"
import type { ConnectResult, SocialAccountDto, SocialAccountsResult } from "@/lib/api/contracts/social"
import { activeRestriction, assertBrandMayPublish, requireBrandResource, type BrandActor } from "../auth/dal"
import { writeAudit } from "../audit"
import { afterCommit, db, withTx } from "../db"
import { socialAccounts, socialPosts, users } from "../db/schema"
import { getEnv } from "../env"
import { conflict, notConfigured, notFound, rateLimited, restricted } from "../http/errors"
import { newId } from "../ids"
import { log } from "../log"
import { mediaSrc } from "../media"
import { hit, recordAbuse } from "../security/rate-limit"
import { importMedia } from "./download"
import { mediaIdsOf, type StoredMedia } from "./dto"
import { deleteImportedMedia, refreshMedia } from "./media-ops"
import { consumeState, createState } from "./oauth"
import { getProvider, liveConfigured, PROVIDERS, ProviderError, redirectUri, type ProviderId, type ProviderMode } from "./providers"
import { cancelSyncs, MANUAL_SYNC_MS, setAccountStatus, slots, syncAvailableAt } from "./state"
import { syncAccount, syncErrorCopy } from "./sync"
import { deleteTokens, loadTokens, storeTokens } from "./tokens"
import { isSafeId } from "@/lib/api/contracts/social"

/**
 * Social connections (§6.1): the accounts list, OAuth start and callback, Sync now and
 * Disconnect, plus the admin helpers M calls. Provider I/O (exchange, revoke, downloads) always
 * runs outside a transaction; each write is one short withTx.
 */
const label: Record<ProviderId, string> = { instagram: "Instagram", tiktok: "TikTok" }
const envVars: Record<ProviderId, string[]> = { instagram: ["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET"], tiktok: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"] }

type AccountRow = typeof socialAccounts.$inferSelect

/** The brand's live (not disconnected) account for a provider, if any. */
async function activeAccount(brandId: string, provider: ProviderId) {
  const d = await db()
  const [row] = await d
    .select()
    .from(socialAccounts)
    .where(and(eq(socialAccounts.brandId, brandId), eq(socialAccounts.provider, provider), ne(socialAccounts.status, "disconnected")))
    .limit(1)
  return row ?? null
}

/** Yard paused social connections for this brand (admin "Pause social for brand"). */
export async function pausedFor(brandId: string) {
  const r = await activeRestriction("brand", brandId, "social_disabled")
  return r ? { reason: r.reason, until: r.until?.toISOString() ?? null } : null
}

async function assertNotPaused(brandId: string) {
  const p = await pausedFor(brandId)
  if (p) throw restricted(`Yard has paused social connections for your brand: ${p.reason}`)
}

/* ---------- Accounts (GET /api/studio/social/accounts) ---------- */

export async function listAccounts(actor: BrandActor): Promise<SocialAccountsResult> {
  const env = getEnv()
  const d = await db()
  const rows = await d
    .select()
    .from(socialAccounts)
    .where(and(eq(socialAccounts.brandId, actor.brandId), ne(socialAccounts.status, "disconnected")))
  const ids = rows.map((r) => r.id)
  const counts = ids.length
    ? await d
        .select({ accountId: socialPosts.accountId, n: sql<number>`count(*)::int` })
        .from(socialPosts)
        .where(inArray(socialPosts.accountId, ids))
        .groupBy(socialPosts.accountId)
    : []
  const people = rows.length
    ? await d
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(inArray(users.id, rows.map((r) => r.connectedBy)))
    : []
  const st = slots()
  const accounts: SocialAccountDto[] = PROVIDERS.map((provider) => {
    const row = rows.find((r) => r.provider === provider)
    const base = {
      provider,
      configured: liveConfigured(provider),
      sandboxAvailable: env.sandboxEnabled,
      ...(env.sandboxEnabled ? { setup: { envVars: envVars[provider], redirectUri: redirectUri(provider) } } : {}),
    }
    if (!row)
      return {
        ...base,
        id: null,
        mode: null,
        status: "not_connected" as const,
        statusDetail: null,
        handle: null,
        displayName: null,
        avatarSrc: null,
        accountType: null,
        connectedAt: null,
        connectedBy: null,
        lastSyncAt: null,
        syncError: null,
        tokenExpiresAt: null,
        postCount: 0,
        syncing: false,
        syncAvailableAt: null,
      }
    return {
      ...base,
      id: row.id,
      mode: row.mode as ProviderMode,
      status: row.status as SocialAccountDto["status"],
      statusDetail: row.status === "connected" ? null : row.statusDetail,
      handle: row.handle,
      displayName: row.displayName,
      avatarSrc: row.avatarMediaId ? mediaSrc(row.avatarMediaId, "brand") : null,
      accountType: row.accountType,
      connectedAt: row.connectedAt.toISOString(),
      connectedBy: people.find((p) => p.id === row.connectedBy)?.name ?? null,
      lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
      syncError: row.status === "connected" ? syncErrorCopy(row.lastErrorCode) : null,
      tokenExpiresAt: row.tokenExpiresAt?.toISOString() ?? null,
      postCount: counts.find((c) => c.accountId === row.id)?.n ?? 0,
      syncing: st.syncing.has(row.id),
      syncAvailableAt: syncAvailableAt(row.id)?.toISOString() ?? null,
    }
  })
  return { accounts, paused: await pausedFor(actor.brandId) }
}

/* ---------- OAuth start (POST /api/social/{provider}/start) ---------- */

const START_LIMIT = 10
const START_WINDOW_SEC = 3600

export async function startConnect(actor: BrandActor, provider: ProviderId, wantSandbox: boolean, ipHash: string | null = null) {
  const env = getEnv()
  assertBrandMayPublish(actor)
  await assertNotPaused(actor.brandId)
  const mode: ProviderMode | null = wantSandbox ? (env.sandboxEnabled ? "sandbox" : null) : liveConfigured(provider) ? "live" : null
  if (!mode) throw notConfigured(`${label[provider]} connections aren't switched on for Yard yet. Upload posts in Content Studio in the meantime.`)
  // 10 starts per hour per brand (§5.1): the budget is the brand's, whoever clicks. Going over it
  // is an abuse event, so Admin › Abuse sees connect flooding.
  const key = `social.start:brand:${actor.brandId}`
  const r = hit(key, START_LIMIT, START_WINDOW_SEC)
  if (!r.ok) {
    await recordAbuse(key, { kind: "brand", id: actor.userId, ipHash }, "social.start", "rate_limit", { limit: START_LIMIT, windowSec: START_WINDOW_SEC, brandId: actor.brandId }).catch(() => {})
    throw rateLimited(r.retryAfter, "Too many connection attempts. Try again later.")
  }
  const p = getProvider(provider, mode, actor.brandId)
  const { state, codeChallenge } = await withTx(() => createState({ brandId: actor.brandId, userId: actor.userId, provider, mode, pkce: mode === "live" && p.usesPkce() }))
  return { url: p.authorizeUrl({ state, redirectUri: redirectUri(provider), codeChallenge }) }
}

/* ---------- OAuth callback (GET /api/social/{provider}/callback) ---------- */

/**
 * Verifies state (and PKCE), exchanges the code outside any transaction, then upserts the
 * account and its sealed tokens in one transaction. Returns the result for the redirect and the
 * account to sync (the route kicks the sync off with after()).
 */
export async function completeConnect(i: { provider: ProviderId; code: string | null; error: string | null; state: string | null; session: BrandActor | null; ipHash: string | null }): Promise<{ result: ConnectResult; accountId?: string }> {
  const check = await consumeState(i.state ?? "", i.provider, i.session ? { userId: i.session.userId, brandId: i.session.brandId } : null)
  if (!check.ok || !i.session) return { result: "invalid_state" }
  const actor = i.session
  if (i.error || !i.code) return { result: "denied" }
  if (check.mode === "sandbox" && !getEnv().sandboxEnabled) return { result: "invalid_state" }
  if (await pausedFor(actor.brandId)) return { result: "error" }
  const provider = getProvider(i.provider, check.mode, actor.brandId)
  try {
    const tokens = await provider.exchangeCode({ code: i.code, redirectUri: redirectUri(i.provider), codeVerifier: check.codeVerifier })
    const profile = await provider.profile(tokens)
    const existing = await activeAccount(actor.brandId, i.provider)
    if (existing && (existing.externalUserId !== profile.externalUserId || existing.mode !== check.mode)) return { result: "already_connected" }
    // The profile picture (live only), downloaded before the transaction; best effort.
    let avatarMediaId: string | null = null
    if (profile.avatarUrl && check.mode === "live") {
      try {
        avatarMediaId = (await importMedia({ url: profile.avatarUrl, kind: "image", sandbox: false, brandId: actor.brandId, createdBy: actor.userId, source: i.provider })).mediaId
      } catch (e) {
        log.warn(`[yard] social: profile picture for ${actor.brandId} wasn't imported (${e instanceof Error ? e.name : "error"})`)
      }
    }
    const accountId = await withTx(async () => {
      const d = await db()
      const now = new Date()
      const values = {
        mode: check.mode,
        externalUserId: profile.externalUserId,
        handle: profile.handle || null,
        displayName: profile.displayName || null,
        accountType: profile.accountType ?? null,
        scopes: tokens.scopes,
        status: "connected",
        statusDetail: null,
        tokenExpiresAt: tokens.expiresAt ?? null,
        refreshExpiresAt: tokens.refreshExpiresAt ?? null,
        connectedBy: actor.userId,
        connectedAt: now,
        nextSyncAfter: now,
        lastErrorCode: null,
        disconnectedAt: null,
        ...(avatarMediaId ? { avatarMediaId } : {}),
      }
      let id: string
      if (existing) {
        await d.update(socialAccounts).set(values).where(eq(socialAccounts.id, existing.id))
        id = existing.id
        if (existing.status !== "connected") await setAccountStatus(existing, "connected")
      } else {
        id = newId("sa")
        await d.insert(socialAccounts).values({ id, brandId: actor.brandId, provider: i.provider, ...values })
        await setAccountStatus({ id, brandId: actor.brandId, provider: i.provider, status: "not_connected" }, "connected")
      }
      await storeTokens({ accountId: id, brandId: actor.brandId, provider: i.provider }, tokens)
      // Reconnecting the same profile: its earlier imports (kept hidden by "Hide imported posts")
      // belong to this account again, so the brand can show them. They stay hidden until it does.
      const earlier = await d
        .select({ id: socialAccounts.id })
        .from(socialAccounts)
        .where(
          and(
            eq(socialAccounts.brandId, actor.brandId),
            eq(socialAccounts.provider, i.provider),
            eq(socialAccounts.mode, check.mode),
            eq(socialAccounts.externalUserId, profile.externalUserId),
            ne(socialAccounts.id, id),
            inArray(socialAccounts.status, ["disconnected", "revoked"]),
          ),
        )
      if (earlier.length) await d.update(socialPosts).set({ accountId: id }).where(and(eq(socialPosts.brandId, actor.brandId), inArray(socialPosts.accountId, earlier.map((e) => e.id))))
      if (avatarMediaId) await refreshMedia([avatarMediaId])
      await writeAudit({
        actor: { kind: "brand", id: actor.userId, name: actor.name, role: actor.role },
        action: "social.connected",
        target: `${label[i.provider]} @${profile.handle}`,
        subjectType: "social_account",
        subjectId: id,
        brandId: actor.brandId,
        ipHash: i.ipHash,
        meta: { provider: i.provider, mode: check.mode },
      })
      return id
    })
    return { result: "connected", accountId }
  } catch (e) {
    log.warn(`[yard] social: ${i.provider} connect for ${actor.brandId} failed (${e instanceof ProviderError ? `${e.kind} ${e.code ?? ""}` : e instanceof Error ? e.name : "error"})`)
    return { result: e instanceof ProviderError && e.kind === "auth" && check.mode === "sandbox" ? "invalid_state" : "error" }
  }
}

/* ---------- Sync now (POST /api/studio/social/accounts/{id}/sync) ---------- */

export async function loadOwnAccount(id: string) {
  return requireBrandResource(async (brandId) => {
    // A malformed id is simply not one of the brand's accounts (never a query with a NUL in it).
    if (!isSafeId(id)) return null
    const d = await db()
    const [row] = await d
      .select()
      .from(socialAccounts)
      .where(and(eq(socialAccounts.id, id), eq(socialAccounts.brandId, brandId), ne(socialAccounts.status, "disconnected")))
      .limit(1)
    return row ?? null
  }, "social.connect")
}

/** Validates and reserves a manual sync (1 per 5 min per account). The caller runs it with after(). */
export async function requestSync(id: string, ipHash: string | null = null) {
  const { actor, resource: acct } = await loadOwnAccount(id)
  await assertNotPaused(actor.brandId)
  if (acct.status !== "connected") throw conflict(`Reconnect ${label[acct.provider as ProviderId]} before syncing.`)
  const key = `social.sync:${acct.id}`
  const r = hit(key, 1, MANUAL_SYNC_MS / 1000)
  if (!r.ok) {
    await recordAbuse(key, { kind: "brand", id: actor.userId, ipHash }, "social.sync", "rate_limit", { limit: 1, windowSec: MANUAL_SYNC_MS / 1000, brandId: actor.brandId }).catch(() => {})
    throw rateLimited(r.retryAfter, "You can sync once every 5 minutes.")
  }
  slots().manualAt.set(acct.id, Date.now())
  return { accountId: acct.id }
}

/* ---------- Disconnect ---------- */

type DisconnectBy = { kind: "brand"; actor: BrandActor; ipHash: string | null } | { kind: "admin"; reason: string }

/**
 * Disconnect, safe inside or outside a caller's transaction (M's force-disconnect runs inside its
 * decision's transaction):
 * 1. any sync running for the account is told to stop and write nothing;
 * 2. the tokens are read (a DB read), then one transaction deletes them, marks the account
 *    disconnected, hides or deletes its imports (hidden imports lose `featured`: they can't lead
 *    the feed) and refreshes their media visibility;
 * 3. the provider revoke (TikTok) runs after commit, so no network call ever holds the connection.
 * Brand disconnects are audited here; M audits its own.
 */
async function disconnectAccount(acct: AccountRow, deletePosts: boolean, by: DisconnectBy) {
  cancelSyncs([acct.id])
  const provider = getProvider(acct.provider as ProviderId, acct.mode as ProviderMode, acct.brandId)
  return withTx(async () => {
    const d = await db()
    const tokens = provider.revoke ? await loadTokens({ accountId: acct.id, brandId: acct.brandId, provider: acct.provider }) : null
    await deleteTokens(acct.id)
    await setAccountStatus(acct, "disconnected", { detail: by.kind === "admin" ? by.reason : null })
    const posts = await d.select().from(socialPosts).where(and(eq(socialPosts.brandId, acct.brandId), eq(socialPosts.accountId, acct.id)))
    const media = posts.flatMap((p) => mediaIdsOf(p.media as StoredMedia[]))
    if (deletePosts) {
      // Removed posts stay listed under "Removed by Yard" (they're evidence); the rest go.
      const gone = posts.filter((p) => p.moderationStatus !== "removed")
      if (gone.length) await d.delete(socialPosts).where(inArray(socialPosts.id, gone.map((p) => p.id)))
      await deleteImportedMedia(gone.flatMap((p) => mediaIdsOf(p.media as StoredMedia[])), [acct.brandId])
    } else if (posts.length) {
      await d
        .update(socialPosts)
        .set({ visibility: "hidden", featured: false, featureOrder: null, updatedAt: new Date() })
        .where(and(eq(socialPosts.accountId, acct.id), eq(socialPosts.brandId, acct.brandId), notInArray(socialPosts.moderationStatus, ["removed"])))
    }
    if (tokens && provider.revoke) {
      const revoke = provider.revoke.bind(provider)
      afterCommit(() =>
        revoke({ ...tokens, scopes: acct.scopes, externalUserId: acct.externalUserId }).catch((e) =>
          // ProviderError details and our own assertion are safe to log (never a token or a URL).
          log.warn(`[yard] social: revoking ${acct.provider} for ${acct.brandId} failed (${e instanceof ProviderError ? (e.code ?? e.kind) : e instanceof Error ? e.message : "error"}); Yard's copy of the tokens is deleted anyway`),
        ),
      )
    }
    await refreshMedia(media)
    if (by.kind === "brand")
      await writeAudit({
        actor: { kind: "brand", id: by.actor.userId, name: by.actor.name, role: by.actor.role },
        action: "social.disconnected",
        target: `${label[acct.provider as ProviderId]} @${acct.handle ?? ""}`,
        subjectType: "social_account",
        subjectId: acct.id,
        brandId: acct.brandId,
        ipHash: by.ipHash,
        meta: { provider: acct.provider, mode: acct.mode, deletePosts, posts: posts.length },
      })
    return { posts: posts.length, deleted: deletePosts }
  })
}

export async function disconnect(id: string, deletePosts: boolean, ipHash: string | null) {
  const { actor, resource } = await loadOwnAccount(id)
  return disconnectAccount(resource, deletePosts, { kind: "brand", actor, ipHash })
}

/* ---------- Admin helpers (M's decisions call these) ---------- */

/**
 * Admin › Content › Integrations: disconnects an account, deletes its tokens and hides its
 * imports. Safe inside the caller's transaction (M's decision): the database part joins it and the
 * provider revoke runs after it commits. M sends the brand's notification and writes the audit
 * row, so this sends neither.
 */
export async function forceDisconnect(accountId: string, reason: string) {
  const d = await db()
  const acct = await d.query.socialAccounts.findFirst({ where: (a, { eq }) => eq(a.id, accountId) })
  if (!acct || acct.status === "disconnected") throw notFound()
  return disconnectAccount(acct, false, { kind: "admin", reason })
}

/** Admin "Retry sync": runs a sync now, whatever the 5-minute limit (returns when it finishes). */
export async function retrySync(accountId: string) {
  const d = await db()
  const acct = await d.query.socialAccounts.findFirst({ where: (a, { eq }) => eq(a.id, accountId) })
  if (!acct || acct.status === "disconnected" || acct.status === "revoked") throw notFound()
  return syncAccount(accountId, { trigger: "admin" })
}

/** The account's status as Admin shows it (metadata only, never tokens). */
export async function accountsForAdmin(brandId?: string) {
  const d = await db()
  const rows = await d
    .select({
      id: socialAccounts.id,
      brandId: socialAccounts.brandId,
      provider: socialAccounts.provider,
      mode: socialAccounts.mode,
      handle: socialAccounts.handle,
      status: socialAccounts.status,
      statusDetail: socialAccounts.statusDetail,
      lastSyncAt: socialAccounts.lastSyncAt,
      connectedAt: socialAccounts.connectedAt,
      lastErrorCode: socialAccounts.lastErrorCode,
    })
    .from(socialAccounts)
    .where(brandId ? eq(socialAccounts.brandId, brandId) : undefined)
  return rows
}
