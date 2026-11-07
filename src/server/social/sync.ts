import "server-only"
import { and, eq, gte, inArray, isNull, lte, ne, notInArray, or, sql } from "drizzle-orm"
import { isSafeEmbed, isSafePermalink, TIKTOK_EMBED_PREFIX } from "@/lib/api/contracts/social"
import { brandById } from "@/lib/data/brands"
import { activeRestriction } from "../auth/dal"
import { db, withTx } from "../db"
import { mediaAssets, socialAccounts, socialPosts } from "../db/schema"
import { newId } from "../ids"
import { log } from "../log"
import { mediaSrc } from "../media"
import { DownloadError, importMedia } from "./download"
import { mediaIdsOf, type StoredMedia } from "./dto"
import { deleteImportedMedia, refreshMedia } from "./media-ops"
import { getProvider, ProviderError, type RemotePost, type TokenSet } from "./providers"
import { liveAccountWhere, setAccountStatus, slots, type SyncGuard } from "./state"
import { loadTokens, storeTokens } from "./tokens"

/**
 * Sync (§6.1). Provider calls and downloads happen first, outside any transaction; then one short
 * withTx writes the posts, media rows and account status (§1.3). New posts arrive hidden (the
 * brand chooses what to show); existing posts get caption and permalink updates; a post Yard
 * removed is never updated or re-shown; a post missing from page 1 but newer than its oldest
 * item gets upstream_missing_at and is hidden.
 *
 * A Disconnect, Meta deauthorize, data deletion or reconnect can land while a sync downloads (that
 * can take minutes live). The final transaction re-reads the account and writes nothing when it is
 * no longer live or was reconnected since (connected_at differs); the files this run imported are
 * then deleted. Every account write carries the same condition, and tokens are re-sealed only when
 * that write matched, so a token the brand disconnected is never stored again.
 */
const SIX_HOURS = 6 * 3_600_000
const HOUR = 3_600_000

export type SyncOutcome = { ok: boolean; skipped?: boolean; added?: number; updated?: number; missing?: number; failed?: number }

type Account = typeof socialAccounts.$inferSelect

async function loadAccount(id: string) {
  const d = await db()
  return d.query.socialAccounts.findFirst({ where: (a, { eq }) => eq(a.id, id) })
}

const sourceOf = (a: Pick<Account, "mode" | "provider">) => (a.mode === "sandbox" ? "sandbox" : a.provider) as "sandbox" | "instagram" | "tiktok"

/** Downloads one remote post's files. Throws when any required file can't be stored (the post waits for the next sync). */
async function importPost(post: RemotePost, acct: Account, altBase: string): Promise<StoredMedia[]> {
  const sandbox = acct.mode === "sandbox"
  const out: StoredMedia[] = []
  for (const [i, m] of post.media.entries()) {
    const alt = post.media.length > 1 ? `${altBase}, ${i + 1} of ${post.media.length}` : altBase
    if (m.kind === "image") {
      const got = await importMedia({ url: m.url, kind: "image", sandbox, brandId: acct.brandId, createdBy: acct.connectedBy, source: sourceOf(acct) })
      out.push({ mediaId: got.mediaId, src: mediaSrc(got.mediaId), alt, width: got.width ?? m.width ?? 1080, height: got.height ?? m.height ?? 1350, kind: "image" })
      continue
    }
    // Video: the poster first (TikTok has only its cover; videos play through embed_link).
    const posterUrl = m.posterUrl ?? (acct.provider === "tiktok" ? m.url : undefined)
    const poster = posterUrl ? await importMedia({ url: posterUrl, kind: "image", sandbox, brandId: acct.brandId, createdBy: acct.connectedBy, source: sourceOf(acct) }) : null
    let file: { mediaId: string; durationMs?: number } | null = null
    if (acct.provider === "instagram" && m.url && m.url !== posterUrl) {
      try {
        file = await importMedia({ url: m.url, kind: "video", sandbox, brandId: acct.brandId, createdBy: acct.connectedBy, source: sourceOf(acct) })
      } catch (e) {
        // Over 50 MB: keep the poster only and play via "Watch on Instagram".
        if (!(e instanceof DownloadError && e.reason === "too_large") || !poster) throw e
      }
    }
    if (!file && !poster) throw new DownloadError("type")
    const main = file?.mediaId ?? poster!.mediaId
    out.push({
      mediaId: main,
      src: mediaSrc(main),
      alt,
      width: poster?.width ?? m.width ?? 1080,
      height: poster?.height ?? m.height ?? 1920,
      kind: "video",
      ...(poster ? { posterMediaId: poster.mediaId, posterSrc: mediaSrc(poster.mediaId) } : {}),
      ...((file?.durationMs ?? m.durationMs) ? { durationMs: file?.durationMs ?? m.durationMs } : {}),
    })
  }
  return out
}

/**
 * Brands whose social feed Yard paused (an active social_disabled restriction): the scheduler
 * leaves their accounts alone, so no provider traffic runs for them.
 */
const notPaused = sql`not exists (select 1 from account_restrictions r where r.subject_kind = 'brand' and r.subject_id = ${socialAccounts.brandId} and r.kind = 'social_disabled' and r.status = 'active' and (r.until is null or r.until > now()))`

/** Safe, user-facing copy for a failed sync that wasn't the provider's doing. */
const SYNC_FAILED = "The last sync didn't finish. Yard tries again shortly."

export async function syncAccount(accountId: string, opts: { trigger: "connect" | "manual" | "schedule" | "admin" }): Promise<SyncOutcome> {
  const st = slots()
  if (st.syncing.has(accountId)) return { ok: true, skipped: true }
  st.syncing.add(accountId)
  // A marker left by an earlier Disconnect of this account belongs to that earlier run.
  st.cancelled.delete(accountId)
  try {
    const acct = await loadAccount(accountId)
    if (!acct || acct.status === "disconnected" || acct.status === "revoked") return { ok: false, skipped: true }
    // Paused by Yard: no provider calls at all until an admin resumes it.
    if (await activeRestriction("brand", acct.brandId, "social_disabled")) return { ok: false, skipped: true }
    const guard: SyncGuard = { connectedAt: acct.connectedAt }
    const ref = { accountId: acct.id, brandId: acct.brandId, provider: acct.provider }
    const provider = getProvider(acct.provider as "instagram" | "tiktok", acct.mode as "live" | "sandbox", acct.brandId)
    const opened = await loadTokens(ref)
    if (!opened) {
      // No tokens: Disconnect (or deauthorize) got here first, and the guard then writes nothing.
      await withTx(() => setAccountStatus(acct, "needs_reauth", { detail: "Yard no longer has access. Reconnect to keep your feed updating.", errorCode: "no_tokens", guard }))
      return { ok: false }
    }
    let tokens: TokenSet = { ...opened, expiresAt: acct.tokenExpiresAt ?? undefined, refreshExpiresAt: acct.refreshExpiresAt ?? undefined, scopes: acct.scopes, externalUserId: acct.externalUserId }
    let refreshed = false

    try {
      // 1. Refresh first when the access token is about to expire (TikTok: within 1 h).
      if (acct.mode === "live" && tokens.expiresAt && tokens.expiresAt.getTime() - Date.now() < provider.refreshWindowMs) {
        tokens = await provider.refresh(tokens)
        refreshed = true
      }
      // 2. Page 1 from the provider.
      const page = await provider.listMedia(tokens)
      const source = sourceOf(acct)
      const d = await db()
      const extIds = page.items.map((i) => i.externalId)
      const existing = extIds.length
        ? await d
            .select()
            .from(socialPosts)
            .where(and(eq(socialPosts.brandId, acct.brandId), eq(socialPosts.source, source), inArray(socialPosts.externalId, extIds)))
        : []
      const byExt = new Map(existing.map((p) => [p.externalId!, p]))
      const brandName = brandById.get(acct.brandId)?.name ?? "Brand"
      const label = acct.provider === "tiktok" ? "TikTok" : "Instagram"

      // 3. Downloads for new posts only, outside any transaction.
      const fresh: { post: RemotePost; media: StoredMedia[] }[] = []
      let failed = 0
      for (const post of page.items) {
        // A Disconnect started: stop downloading (the transaction below then writes nothing).
        if (st.cancelled.has(acct.id)) break
        if (byExt.has(post.externalId)) continue
        try {
          fresh.push({ post, media: await importPost(post, acct, `${label} post by ${brandName}`) })
        } catch (e) {
          failed++
          log.warn(`[yard] social: a ${label} post of ${acct.brandId} wasn't imported (${e instanceof DownloadError ? e.reason : e instanceof Error ? e.name : "error"}); it's retried at the next sync`)
        }
      }

      // 4. One short transaction.
      const oldest = page.items.length ? new Date(Math.min(...page.items.map((i) => i.postedAt.getTime()))) : null
      const now = new Date()
      const importedNow = fresh.flatMap((f) => mediaIdsOf(f.media))
      const result = await withTx(async () => {
        const tx = await db()
        // The account may have been disconnected, deauthorized or reconnected while we downloaded.
        // This transaction holds the only connection, so nothing can change it between this read
        // and the writes below.
        const [live] = await tx.select({ id: socialAccounts.id }).from(socialAccounts).where(liveAccountWhere(acct.id, guard))
        if (!live || st.cancelled.has(acct.id)) {
          await deleteImportedMedia(importedNow, [acct.brandId])
          return null
        }
        if (refreshed) {
          const [kept] = await tx
            .update(socialAccounts)
            .set({ tokenExpiresAt: tokens.expiresAt ?? null, refreshExpiresAt: tokens.refreshExpiresAt ?? null })
            .where(liveAccountWhere(acct.id, guard))
            .returning({ id: socialAccounts.id })
          if (kept) await storeTokens(ref, tokens)
        }
        let added = 0
        const newMedia: string[] = []
        for (const { post, media } of fresh) {
          const embed = post.embedUrl && isSafeEmbed(post.embedUrl) && post.embedUrl.startsWith(TIKTOK_EMBED_PREFIX) ? post.embedUrl : null
          const inserted = await tx
            .insert(socialPosts)
            .values({
              id: newId("sp"),
              brandId: acct.brandId,
              accountId: acct.id,
              source,
              externalId: post.externalId,
              kind: post.kind,
              caption: post.caption.slice(0, 2200),
              permalink: isSafePermalink(post.permalink) ? post.permalink : null,
              embedUrl: embed,
              media,
              postedAt: post.postedAt,
              importedAt: now,
              visibility: "hidden",
              createdBy: null,
            })
            .onConflictDoNothing()
            .returning({ id: socialPosts.id })
          if (inserted.length) {
            added++
            newMedia.push(...mediaIdsOf(media))
          }
        }
        // Imported files are marked with their source and as attached (they belong to a post).
        if (newMedia.length) await tx.update(mediaAssets).set({ source, attachedAt: now }).where(inArray(mediaAssets.id, newMedia))

        // Existing posts: caption and permalink updates; reappearing posts lose their "missing" note.
        let updated = 0
        for (const post of page.items) {
          const row = byExt.get(post.externalId)
          if (!row || row.moderationStatus === "removed") continue
          const permalink = isSafePermalink(post.permalink) ? post.permalink : null
          const caption = post.caption.slice(0, 2200)
          if (row.caption !== caption || row.permalink !== permalink || row.upstreamMissingAt || row.accountId !== acct.id) {
            // Yard may have removed the post since it was read above: a removed post is never touched.
            const changed = await tx
              .update(socialPosts)
              .set({ caption, permalink, upstreamMissingAt: null, accountId: acct.id, updatedAt: now })
              .where(and(eq(socialPosts.id, row.id), ne(socialPosts.moderationStatus, "removed")))
              .returning({ id: socialPosts.id })
            updated += changed.length
          }
        }

        // Removed upstream: newer than page 1's oldest item, but not on page 1. Only this account's
        // own imports: another (earlier) account's posts are never marked missing by this one.
        let missing = 0
        if (oldest) {
          const gone = await tx
            .update(socialPosts)
            .set({ upstreamMissingAt: now, visibility: "hidden", updatedAt: now })
            .where(
              and(
                eq(socialPosts.brandId, acct.brandId),
                eq(socialPosts.accountId, acct.id),
                eq(socialPosts.source, source),
                acct.mode === "sandbox" ? sql`${socialPosts.externalId} like ${acct.provider === "tiktok" ? "tt\\_%" : "ig\\_%"}` : undefined,
                gte(socialPosts.postedAt, oldest),
                extIds.length ? notInArray(socialPosts.externalId, extIds) : undefined,
                isNull(socialPosts.upstreamMissingAt),
                ne(socialPosts.moderationStatus, "removed"),
              ),
            )
            .returning({ media: socialPosts.media })
          missing = gone.length
          await refreshMedia(gone.flatMap((g) => mediaIdsOf(g.media as StoredMedia[])))
        }

        await tx.update(socialAccounts).set({ lastSyncAt: now, nextSyncAfter: new Date(now.getTime() + SIX_HOURS) }).where(liveAccountWhere(acct.id, guard))
        await setAccountStatus(acct, "connected", { errorCode: failed ? "partial" : null, guard })
        return { added, updated, missing }
      })
      if (!result) {
        log.info(`[yard] social: a sync of ${acct.provider} (${acct.mode}) for ${acct.brandId} stopped: the account was disconnected or reconnected meanwhile; nothing was written`)
        return { ok: false, skipped: true }
      }
      if (opts.trigger !== "schedule") log.info(`[yard] social: synced ${acct.provider} (${acct.mode}) for ${acct.brandId}: ${result.added} new, ${result.updated} updated, ${result.missing} missing, ${failed} not imported`)
      return { ok: true, ...result, failed }
    } catch (e) {
      if (e instanceof ProviderError) {
        await withTx(async () => {
          const tx = await db()
          if (e.kind === "rate") {
            // Back off an hour; the account stays connected.
            await tx.update(socialAccounts).set({ nextSyncAfter: new Date(Date.now() + HOUR), lastErrorCode: `rate:${e.code ?? ""}` }).where(liveAccountWhere(acct.id, guard))
          } else if (e.kind === "auth") {
            await setAccountStatus(acct, "needs_reauth", { detail: e.detail, errorCode: e.code ?? "auth", guard })
          } else if (await setAccountStatus(acct, "error", { detail: e.detail, errorCode: e.code ?? e.kind, guard })) {
            await tx.update(socialAccounts).set({ nextSyncAfter: new Date(Date.now() + HOUR) }).where(liveAccountWhere(acct.id, guard))
          }
        })
        return { ok: false }
      }
      log.error(`[yard] social: sync of ${acct.id} failed`, e)
      await withTx(async () => {
        const tx = await db()
        await tx.update(socialAccounts).set({ lastErrorCode: "sync_failed", nextSyncAfter: new Date(Date.now() + 30 * 60_000) }).where(liveAccountWhere(acct.id, guard))
      })
      return { ok: false }
    }
  } finally {
    st.syncing.delete(accountId)
  }
}

export const syncErrorCopy = (code: string | null) => (code === "sync_failed" ? SYNC_FAILED : code === "partial" ? "Some posts couldn't be imported. Yard tries them again at the next sync." : code?.startsWith("rate:") ? "The network asked Yard to slow down. Yard tries again in an hour." : null)

/** Scheduler (every 30 min): accounts whose next_sync_after has passed (every 6 h after a sync), except brands Yard paused. */
export async function syncDue() {
  const d = await db()
  const due = await d
    .select({ id: socialAccounts.id })
    .from(socialAccounts)
    .where(and(eq(socialAccounts.status, "connected"), or(isNull(socialAccounts.nextSyncAfter), lte(socialAccounts.nextSyncAfter, new Date())), notPaused))
    .limit(50)
  for (const a of due) await syncAccount(a.id, { trigger: "schedule" })
}

/**
 * Scheduler (every 30 min): refreshes live tokens inside their provider's window (IG 10 days,
 * TikTok 1 h), except for brands Yard paused and accounts a sync is working on (it refreshes on its
 * own). The new tokens are sealed only when the account is still live and not reconnected since.
 */
export async function refreshDueTokens() {
  const d = await db()
  const rows = await d
    .select()
    .from(socialAccounts)
    .where(and(eq(socialAccounts.status, "connected"), eq(socialAccounts.mode, "live"), lte(socialAccounts.tokenExpiresAt, new Date(Date.now() + 10 * 86_400_000)), notPaused))
    .limit(50)
  const st = slots()
  for (const acct of rows) {
    if (st.syncing.has(acct.id)) continue
    const guard: SyncGuard = { connectedAt: acct.connectedAt }
    const provider = getProvider(acct.provider as "instagram" | "tiktok", "live", acct.brandId)
    if (!acct.tokenExpiresAt || acct.tokenExpiresAt.getTime() - Date.now() > provider.refreshWindowMs) continue
    // Instagram tokens must be at least 24 h old before they can be refreshed.
    if (acct.provider === "instagram" && Date.now() - acct.connectedAt.getTime() < 86_400_000) continue
    const ref = { accountId: acct.id, brandId: acct.brandId, provider: acct.provider }
    const opened = await loadTokens(ref)
    if (!opened) continue
    try {
      const next = await provider.refresh({ ...opened, expiresAt: acct.tokenExpiresAt, refreshExpiresAt: acct.refreshExpiresAt ?? undefined, scopes: acct.scopes, externalUserId: acct.externalUserId })
      const kept = await withTx(async () => {
        const tx = await db()
        const [row] = await tx
          .update(socialAccounts)
          .set({ tokenExpiresAt: next.expiresAt ?? null, refreshExpiresAt: next.refreshExpiresAt ?? null })
          .where(liveAccountWhere(acct.id, guard))
          .returning({ id: socialAccounts.id })
        // Disconnected (or reconnected) while the refresh ran: the new token is dropped, never stored.
        if (row) await storeTokens(ref, next)
        return !!row
      })
      if (!kept) log.info(`[yard] social: a refreshed ${acct.provider} token for ${acct.brandId} was dropped: the account was disconnected meanwhile`)
    } catch (e) {
      if (e instanceof ProviderError && e.kind !== "rate") {
        const when = acct.tokenExpiresAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })
        await withTx(() => setAccountStatus(acct, "needs_reauth", { detail: `${acct.provider === "tiktok" ? "TikTok" : "Instagram"} access expired on ${when}. Reconnect to keep your feed updating.`, errorCode: e.code ?? "refresh", guard }))
      } else log.warn(`[yard] social: token refresh for ${acct.id} failed; retried in 30 min`)
    }
  }
}
