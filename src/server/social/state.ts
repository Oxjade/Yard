import "server-only"
import { eq } from "drizzle-orm"
import { db } from "../db"
import { socialAccounts } from "../db/schema"
import { notify } from "../notify"
import { publish } from "../realtime/bus"
import { channels } from "../realtime/channels"
import { yard } from "../state"

/** In-process sync bookkeeping (on globalThis, so HMR never duplicates it). */
type SocialSlots = { syncing: Set<string>; manualAt: Map<string, number> }
export function slots(): SocialSlots {
  const s = (yard.slots ??= {})
  return (s.social ??= { syncing: new Set<string>(), manualAt: new Map<string, number>() }) as SocialSlots
}

/** "Sync now" is allowed once per 5 minutes per account (§5.1). */
export const MANUAL_SYNC_MS = 5 * 60_000

export function syncAvailableAt(accountId: string): Date | null {
  const at = slots().manualAt.get(accountId)
  return at && Date.now() - at < MANUAL_SYNC_MS ? new Date(at + MANUAL_SYNC_MS) : null
}

const label = { instagram: "Instagram", tiktok: "TikTok" } as const

export type AccountStatus = "connected" | "needs_reauth" | "error" | "revoked" | "disconnected"

/**
 * Sets an account's status (inside the caller's transaction) and, when it changed, publishes
 * social.status to the brand after commit. Failures and expiries notify the brand (template only,
 * §2.7); success never does.
 */
export async function setAccountStatus(
  acct: { id: string; brandId: string; provider: string; status: string },
  status: AccountStatus,
  opts: { detail?: string | null; errorCode?: string | null; notifyDetail?: string } = {},
) {
  const d = await db()
  await d
    .update(socialAccounts)
    .set({ status, statusDetail: opts.detail ?? null, lastErrorCode: opts.errorCode ?? null, ...(status === "disconnected" ? { disconnectedAt: new Date() } : {}) })
    .where(eq(socialAccounts.id, acct.id))
  if (acct.status === status) return
  await publish(channels.brand(acct.brandId), "social.status", { accountId: acct.id, status })
  if (status === "needs_reauth" || status === "error" || status === "revoked") {
    await notify(
      { kind: "brand", id: acct.brandId },
      {
        key: `social:${acct.id}:${status}`,
        template: "social.status",
        vars: { provider: label[acct.provider as keyof typeof label] ?? "Social", detail: opts.notifyDetail ?? opts.detail ?? undefined },
        href: "/studio/social?tab=connections",
      },
    )
  }
}
