import "server-only"
import { forceDisconnect as forceDisconnectAccount } from "./service"
import { refreshDueTokens as refreshTokens, syncDue as syncDueAccounts } from "./sync"

/**
 * Social contract (§1.8, cluster S). The scheduler re-imports this module on every tick, so these
 * bodies are picked up under HMR. Everything uses db()/withTx, so a caller's transaction carries
 * through where one is open (forceDisconnect does provider I/O first, so call it outside one).
 */
export const IMPL: string = "S-2026-11-06"

/** Refreshes tokens that expire soon (Instagram within 10 days; TikTok access within 1 h). */
export async function refreshDueTokens(): Promise<void> {
  await refreshTokens()
}

/** Syncs accounts whose next_sync_after has passed (every 6 h). */
export async function syncDue(): Promise<void> {
  await syncDueAccounts()
}

/** Admin › Content › Integrations: disconnects an account, deletes its tokens and hides its imports. */
export async function forceDisconnect(accountId: string, reason: string): Promise<void> {
  await forceDisconnectAccount(accountId, reason)
}

/** Admin "Retry sync" (M): runs a sync now, whatever the 5-minute limit. */
export { retrySync, accountsForAdmin, pausedFor } from "./service"

export const jobs = { refreshDueTokens, syncDue }
