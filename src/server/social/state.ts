import "server-only"
import { and, eq, notInArray } from "drizzle-orm"
import { db } from "../db"
import { socialAccounts } from "../db/schema"
import { notify } from "../notify"
import { publish } from "../realtime/bus"
import { channels } from "../realtime/channels"
import { yard } from "../state"

/**
 * In-process sync bookkeeping (on globalThis, so HMR never duplicates it). `cancelled` holds the
 * accounts a Disconnect, Meta deauthorize or data deletion has started on: a sync that is
 * downloading for one stops early and writes nothing.
 */
type SocialSlots = { syncing: Set<string>; manualAt: Map<string, number>; cancelled: Set<string>; sandboxDelay?: { ms: number; until: number } }
export function slots(): SocialSlots {
  const s = (yard.slots ??= {})
  const out = (s.social ??= { syncing: new Set<string>(), manualAt: new Map<string, number>(), cancelled: new Set<string>() }) as SocialSlots
  out.cancelled ??= new Set<string>()
  return out
}

/**
 * Development only (POST /api/social/dev/slow-sync): makes each sandbox file copy wait `ms`, for two
 * minutes, so the curl kit can land a Disconnect in the middle of a sync and check it wins.
 */
export function setSandboxDelay(ms: number) {
  slots().sandboxDelay = ms > 0 ? { ms, until: Date.now() + 120_000 } : undefined
}
export function sandboxDelayMs() {
  const d = slots().sandboxDelay
  return d && d.until > Date.now() ? d.ms : 0
}

/** Tells any sync running for these accounts to stop and write nothing (Disconnect, deauthorize, data deletion). */
export function cancelSyncs(accountIds: string[]) {
  const c = slots().cancelled
  for (const id of accountIds) c.add(id)
}

/**
 * The account as a sync or token refresh saw it when it started: still not disconnected or
 * revoked, and not reconnected since (same connected_at). Every write a sync makes to the account
 * carries this condition, so a Disconnect that lands mid-sync always wins.
 */
export type SyncGuard = { connectedAt: Date }
export const liveAccountWhere = (accountId: string, guard: SyncGuard) =>
  and(eq(socialAccounts.id, accountId), notInArray(socialAccounts.status, ["disconnected", "revoked"]), eq(socialAccounts.connectedAt, guard.connectedAt))

/** "Sync now" is allowed once per 5 minutes per account (§5.1). */
export const MANUAL_SYNC_MS = 5 * 60_000

export function syncAvailableAt(accountId: string): Date | null {
  const at = slots().manualAt.get(accountId)
  return at && Date.now() - at < MANUAL_SYNC_MS ? new Date(at + MANUAL_SYNC_MS) : null
}

const providerName = { instagram: "Instagram", tiktok: "TikTok" } as const

export type AccountStatus = "connected" | "needs_reauth" | "error" | "revoked" | "disconnected"

/**
 * Sets an account's status (inside the caller's transaction) and, when it changed, publishes
 * social.status to the brand after commit. Failures and expiries notify the brand (template only,
 * §2.7); success never does. With `guard` (syncs and token refreshes), nothing is written unless
 * the account is still live and not reconnected since: returns whether the row was updated.
 */
export async function setAccountStatus(
  acct: { id: string; brandId: string; provider: string; status: string },
  status: AccountStatus,
  opts: { detail?: string | null; errorCode?: string | null; notifyDetail?: string; guard?: SyncGuard } = {},
): Promise<boolean> {
  const d = await db()
  const changed = await d
    .update(socialAccounts)
    .set({ status, statusDetail: opts.detail ?? null, lastErrorCode: opts.errorCode ?? null, ...(status === "disconnected" ? { disconnectedAt: new Date() } : {}) })
    .where(opts.guard ? liveAccountWhere(acct.id, opts.guard) : eq(socialAccounts.id, acct.id))
    .returning({ id: socialAccounts.id })
  if (!changed.length) return false
  if (acct.status === status) return true
  await publish(channels.brand(acct.brandId), "social.status", { accountId: acct.id, status })
  if (status === "needs_reauth" || status === "error" || status === "revoked") {
    await notify(
      { kind: "brand", id: acct.brandId },
      {
        key: `social:${acct.id}:${status}`,
        template: "social.status",
        vars: { provider: providerName[acct.provider as keyof typeof providerName] ?? "Social", detail: opts.notifyDetail ?? opts.detail ?? undefined },
        href: "/studio/social?tab=connections",
      },
    )
  }
  return true
}
