import "server-only"
import { rm } from "node:fs/promises"
import path from "node:path"
import { and, inArray, like, not, notInArray, or, sql } from "drizzle-orm"
import { afterCommit, db, withTx } from "../db"
import { abuseEvents, accountRestrictions, auditLog, mediaAssets, notifications, oauthStates, socialAccounts, socialDataDeletions, socialPosts } from "../db/schema"
import { getEnv } from "../env"
import { log } from "../log"
import { refreshVisibility } from "../media"
import { mediaIdsOf } from "./dto"
import { resetWindows } from "../security/rate-limit"
import { setSandboxDelay, slots } from "./state"

/**
 * Development only (the route answers 404 in production): puts the social tables back to exactly
 * what the seed module writes, so test runs leave no trace for the demo accounts.
 * - every post that isn't a seed row (sp_seed_*): sandbox and live imports, and uploads;
 * - every social account (none are seeded) with its sealed tokens (cascade), OAuth states and
 *   Meta data-deletion records;
 * - the media files those posts used, plus social media nothing references any more (an upload
 *   whose post was never created), the files after commit;
 * - the brands' social_status notifications, and M's force-disconnect notifications (they name
 *   accounts this deletes; no account is seeded);
 * - the abuse_events rows S's own rate limits wrote (social.start, social.sync, social.meta), and
 *   those limiters' in-memory windows, so the next run starts fresh;
 * - the audit rows about social accounts (every account is a test account, and this deletes them
 *   all), and what S's kit did through M's decisions with a kit reason ("Curl kit: S …", or the
 *   earlier "Kit check: …"): its social_disabled restrictions, their social-paused notifications
 *   and audit rows. The kit also hands those audit ids to M's own dev cleanup.
 * Seed posts themselves are restored by POST /api/dev/reseed?module=social.
 */
export async function resetSocialToSeed() {
  setSandboxDelay(0)
  slots().cancelled.clear()
  slots().manualAt.clear()
  const windows = resetWindows("social.")
  return withTx(async () => {
    const d = await db()
    const posts = await d.select({ id: socialPosts.id, media: socialPosts.media }).from(socialPosts).where(not(like(socialPosts.id, "sp\\_seed\\_%")))
    const fromPosts = posts.flatMap((p) => mediaIdsOf(p.media))
    if (posts.length) await d.delete(socialPosts).where(inArray(socialPosts.id, posts.map((p) => p.id)))

    // Social media still referenced by a (seed) post stays; everything else of these purposes goes.
    const kept = new Set(mediaIdsOf((await d.select({ media: socialPosts.media }).from(socialPosts)).flatMap((r) => r.media)))
    const avatars = (await d.select({ id: socialAccounts.avatarMediaId }).from(socialAccounts)).map((r) => r.id).filter((x): x is string => !!x)
    await d.update(socialAccounts).set({ avatarMediaId: null })
    const candidates = await d
      .select({ id: mediaAssets.id, storagePath: mediaAssets.storagePath })
      .from(mediaAssets)
      .where(and(or(inArray(mediaAssets.purpose, ["social_post", "social_import"]), inArray(mediaAssets.id, [...fromPosts, ...avatars, "-"])), notInArray(mediaAssets.source, ["seed"])))
    const doomed = candidates.filter((m) => !kept.has(m.id))
    if (doomed.length) await d.delete(mediaAssets).where(inArray(mediaAssets.id, doomed.map((m) => m.id)))

    const accounts = await d.delete(socialAccounts).returning({ id: socialAccounts.id })
    await d.delete(oauthStates)
    await d.delete(socialDataDeletions)
    const notes = await d
      .delete(notifications)
      .where(and(sql`${notifications.recipientKind} = 'brand'`, or(like(notifications.eventKey, "social:%"), like(notifications.eventKey, "social-disconnect:%"))))
      .returning({ id: notifications.id })
    const kitReason = (col: typeof auditLog.reason | typeof accountRestrictions.reason) => sql`(${col} like 'Kit check:%' or ${col} like 'Curl kit: S %')`
    const paused = await d
      .delete(accountRestrictions)
      .where(and(sql`${accountRestrictions.kind} = 'social_disabled'`, sql`${accountRestrictions.subjectKind} = 'brand'`, kitReason(accountRestrictions.reason)))
      .returning({ brandId: accountRestrictions.subjectId })
    const pausedNotes = paused.length
      ? await d
          .delete(notifications)
          .where(and(sql`${notifications.recipientKind} = 'brand'`, inArray(notifications.eventKey, [...new Set(paused.map((r) => `social-paused:${r.brandId}`))])))
          .returning({ id: notifications.id })
      : []
    const audits = await d
      .delete(auditLog)
      .where(or(sql`${auditLog.subjectType} = 'social_account'`, and(inArray(auditLog.action, ["social.paused", "social.resumed"]), kitReason(auditLog.reason))))
      .returning({ id: auditLog.id })
    const abuse = await d
      .delete(abuseEvents)
      .where(and(inArray(abuseEvents.action, ["social.start", "social.sync", "social.meta"]), sql`coalesce(${abuseEvents.detail}->>'seed', '') <> 'true'`))
      .returning({ id: abuseEvents.id })
    await refreshVisibility([...kept])

    const root = path.join(getEnv().envDir, "uploads")
    afterCommit(async () => {
      for (const m of doomed) {
        if (m.storagePath.startsWith("/")) continue
        const file = path.resolve(root, m.storagePath)
        if (!file.startsWith(root + path.sep)) continue
        await rm(file, { force: true }).catch((e) => log.error("[yard] social: couldn't delete a test file", e))
      }
    })
    return { posts: posts.length, media: doomed.length, accounts: accounts.length, notifications: notes.length + pausedNotes.length, abuseEvents: abuse.length, auditRows: audits.length, restrictions: paused.length, windows }
  })
}
