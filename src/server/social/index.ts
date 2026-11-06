import "server-only"
import { NotImplemented } from "../http/errors"

/** Social contract (F1 draft; cluster S replaces the bodies and IMPL in wave 2). */
export const IMPL: string = "stub"

/** Refreshes tokens that expire soon (Instagram within 10 days; TikTok access within 1 h). */
export async function refreshDueTokens(): Promise<void> {
  throw new NotImplemented("social.refreshDueTokens")
}

/** Syncs accounts whose next_sync_after has passed (every 6 h). */
export async function syncDue(): Promise<void> {
  throw new NotImplemented("social.syncDue")
}

/** Admin › Content › Integrations: disconnects an account, deletes its tokens and hides its imports. */
export async function forceDisconnect(accountId: string, reason: string): Promise<void> {
  void accountId
  void reason
  throw new NotImplemented("social.forceDisconnect")
}

export const jobs = { refreshDueTokens, syncDue }
