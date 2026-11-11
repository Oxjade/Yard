"use client"

import { useEffect } from "react"
import { create } from "zustand"
import { api } from "@/lib/api/client"
import type { AdminProfile, BrandProfile, DemoAuthState, SessionDto, ShopperProfile } from "@/lib/api/contracts/session"

/**
 * The client's view of the server session (§2.3): one module-level, non-persisted store shared
 * by every surface. The first subscriber anywhere (the market chrome, the Studio or Admin shell,
 * a SessionGate) triggers one GET /api/session; later ones share it. It revalidates on window
 * focus at most once a minute.
 */
export type SessionSurface = "market" | "studio" | "admin"

export type ServerSessionState = {
  status: "loading" | "ready" | "error"
  shopper: ShopperProfile | null
  brand: BrandProfile | null
  admin: AdminProfile | null
  demoAuth: DemoAuthState | null
  /** Sample-data screens are on (the demo switch). Null until /api/session answers: treat it as off. */
  sampleData: boolean | null
  fetchedAt: number
}

const store = create<ServerSessionState>(() => ({ status: "loading", shopper: null, brand: null, admin: null, demoAuth: null, sampleData: null, fetchedAt: 0 }))

let generation = 0
let started = false
let current: Promise<void> | null = null

/** Refetches GET /api/session. A newer call always wins over an older one still in flight. */
export function refreshServerSession(): Promise<void> {
  const mine = ++generation
  started = true
  const p = api<SessionDto>("/api/session")
    .then((s) => {
      if (mine === generation) store.setState({ status: "ready", shopper: s.shopper, brand: s.brand, admin: s.admin, demoAuth: s.demoAuth, sampleData: s.sampleData, fetchedAt: Date.now() })
    })
    .catch(() => {
      if (mine === generation) store.setState((st) => ({ status: st.status === "ready" ? "ready" : "error", fetchedAt: Date.now() }))
    })
  current = p
  return p
}

/** Starts the first fetch once; resolves when the store has an answer. */
export function ensureServerSession(): Promise<void> {
  if (!started) return refreshServerSession()
  return current ?? Promise.resolve()
}

let focusInstalled = false
function installFocusRevalidation() {
  if (focusInstalled || typeof window === "undefined") return
  focusInstalled = true
  window.addEventListener("focus", () => {
    if (Date.now() - store.getState().fetchedAt > 60_000) void refreshServerSession()
  })
}

export const getServerSessionState = () => store.getState()
export const subscribeServerSession = store.subscribe

/** Subscribes to the server session (whole state, or a slice). The first caller triggers the fetch. */
export function useServerSession(): ServerSessionState
export function useServerSession<T>(selector: (s: ServerSessionState) => T): T
export function useServerSession<T>(selector?: (s: ServerSessionState) => T) {
  useEffect(() => {
    installFocusRevalidation()
    void ensureServerSession()
  }, [])
  return store(selector ?? ((s) => s as unknown as T))
}

/** '<kind>:<id>' of the actor whose notifications a surface shows, or null. */
export function recipientFor(surface: SessionSurface, s: ServerSessionState): string | null {
  if (s.status !== "ready") return null
  if (surface === "market") return s.shopper ? `shopper:${s.shopper.id}` : null
  if (surface === "studio") return s.brand ? `brand:${s.brand.brand.id}` : null
  return s.admin ? `admin:${s.admin.id}` : null
}

/** "<surface>:<actorId>:<activeBrandId|->", or null when signed out (realtime and unread stores key on it, §4.3). */
export function identityKeyFor(surface: SessionSurface, s: ServerSessionState): string | null {
  if (s.status !== "ready") return null
  if (surface === "market") return s.shopper ? `market:${s.shopper.id}:-` : null
  if (surface === "studio") return s.brand ? `studio:${s.brand.userId}:${s.brand.brand.id}` : null
  return s.admin ? `admin:${s.admin.id}:-` : null
}

/** True only once /api/session says sample-data screens are on; prod links stay hidden until then (never a flash of sample links). */
export function useSampleData() {
  return useServerSession((s) => s.sampleData === true)
}

export function useIdentityKey(surface: SessionSurface) {
  return useServerSession((s) => identityKeyFor(surface, s))
}

/** The current recipient of a surface's srv: notifications (see recipientFor). */
export function useRecipient(surface: SessionSurface) {
  return useServerSession((s) => recipientFor(surface, s))
}
