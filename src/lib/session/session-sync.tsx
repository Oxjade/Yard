"use client"

import { useEffect, useRef, useSyncExternalStore } from "react"
import { toast } from "sonner"
import { api, ApiError } from "@/lib/api/client"
import type { DemoSignInResult, ShopperProfile } from "@/lib/api/contracts/session"
import { DEMO_SHOPPER, useSession } from "@/lib/stores/session"
import { afterIdentityChange } from "./identity"
import { getServerSessionState, useServerSession } from "./use-server-session"

const STORAGE_KEY = "nocturne-session"

function useSessionHydrated() {
  return useSyncExternalStore(
    (cb) => useSession.persist.onFinishHydration(cb),
    () => useSession.persist.hasHydrated(),
    () => false,
  )
}

/** Re-reads this browser's persisted session (another tab may have signed in or out). */
async function rereadPersisted() {
  try {
    await useSession.persist.rehydrate()
  } catch {
    /* storage unavailable: keep what this tab has */
  }
}

/**
 * Reconciles the marketplace's local user (useSession, persisted in this browser) with the server
 * shopper session once both have loaded (§2.3). It reconciles identity only: the local name and
 * email are the shopper's own (Settings › Account edits them in this browser) and are taken from
 * the server only at sign-in.
 *  - server shopper, no local user → adopt the server profile (without replaying a prompt's
 *    action), unless this browser signed out (the persisted `signedOutAt`);
 *  - server shopper with another id → the server wins;
 *  - local user, no server session → restore the demo session as Ada, after re-reading the
 *    persisted state so a tab never revives a user another tab signed out. A suspended account
 *    or demo sign-in being off signs out locally with a toast.
 * Other tabs follow at once: a `storage` event on the persisted key re-reads it here.
 */
export function SessionSync() {
  const hydrated = useSessionHydrated()
  const server = useServerSession()
  const user = useSession((s) => s.user)
  const signedOutAt = useSession((s) => s.signedOutAt)
  const pending = useSession((s) => s.serverPending)
  const restoring = useRef(false)

  // Sign-in, sign-out and profile edits in another tab of this browser.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY || e.key === null) void rereadPersisted()
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])

  useEffect(() => {
    if (!hydrated || server.status !== "ready" || pending || restoring.current) return
    const remote = server.shopper
    if (remote) {
      if (user?.id === remote.id) return
      if (!user && signedOutAt) return
      useSession.setState({ user: { id: remote.id, name: remote.name, email: remote.email, provider: user?.provider ?? "email" }, signedOutAt: null })
      return
    }
    if (!user) return
    restoring.current = true
    void (async () => {
      try {
        await rereadPersisted()
        const local = useSession.getState()
        if (!local.user || local.serverPending || getServerSessionState().shopper) return
        const r = await api<DemoSignInResult>("/api/auth/demo", { body: { actor: "shopper", account: DEMO_SHOPPER } })
        await afterIdentityChange("market")
        const p = r.profile as ShopperProfile
        const now = useSession.getState().user
        if (now && now.id !== p.id) useSession.setState({ user: { id: p.id, name: p.name, email: p.email, provider: now.provider } })
      } catch (e) {
        if (e instanceof ApiError && (e.code === "suspended" || e.status === 404)) {
          useSession.setState({ user: null, signedOutAt: new Date().toISOString() })
          toast(e.code === "suspended" ? "This demo account is suspended." : "Your demo session ended. Sign in again.")
        }
        // Other failures (offline, server restarting) leave things as they are and retry on the next focus.
      } finally {
        restoring.current = false
      }
    })()
  }, [hydrated, server.status, server.shopper, user, signedOutAt, pending])

  return null
}
