"use client"

import { resetApiCache } from "@/lib/api/use-api"
import { useNotifications, type Audience } from "@/lib/stores/notifications"
import { getServerSessionState, recipientFor, refreshServerSession, type SessionSurface } from "./use-server-session"

const audienceOf: Record<SessionSurface, Audience> = { market: "customer", studio: "merchant", admin: "admin" }
const surfaces: SessionSurface[] = ["market", "studio", "admin"]

/** This tab's half: refresh the session store, drop the API cache, purge srv: items of other identities. */
async function applyIdentityChange(surface: SessionSurface) {
  await refreshServerSession()
  resetApiCache()
  const recipient = recipientFor(surface, getServerSessionState())
  useNotifications.getState().purgeServerItems(audienceOf[surface], recipient)
  // The old Studio onboarding draft (contact and payout details) that earlier builds kept in this
  // browser; it lives on the server now (studio/onboarding/store.ts clears it too).
  try {
    window.localStorage.removeItem("nocturne-studio-onboarding")
  } catch {
    /* storage blocked: nothing was kept there either */
  }
}

/**
 * Other tabs of this browser share the cookies, so an identity change here is one there too.
 * They hear about it on this channel (only the surface name travels) and refresh at once,
 * instead of showing the old account until their next focus revalidation.
 */
let channel: BroadcastChannel | null = null
function identityChannel() {
  if (channel || typeof window === "undefined" || typeof BroadcastChannel === "undefined") return channel
  try {
    channel = new BroadcastChannel("yard-identity")
    channel.onmessage = (e: MessageEvent<{ surface?: unknown }>) => {
      const surface = e.data?.surface
      if (typeof surface === "string" && (surfaces as string[]).includes(surface)) void applyIdentityChange(surface as SessionSurface)
    }
  } catch {
    channel = null
  }
  return channel
}
identityChannel()

/**
 * Runs after every sign-in, sign-out and account switch (§2.3): refresh the session store, drop
 * the API cache (aborting in-flight requests), and purge srv: notifications that don't belong to
 * the new identity; then tell this browser's other tabs to do the same. The realtime provider
 * reopens its stream because the identity key changed.
 */
export async function afterIdentityChange(surface: SessionSurface) {
  await applyIdentityChange(surface)
  try {
    identityChannel()?.postMessage({ surface })
  } catch {
    /* a closed channel: other tabs catch up on focus */
  }
}
