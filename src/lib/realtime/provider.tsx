"use client"

import { createContext, useContext } from "react"
import type { RealtimeStatus, Surface } from "@/lib/api/contracts/realtime"
import { useIdentityKey } from "@/lib/session/use-server-session"

/**
 * The realtime provider (§4.3), mounted once per surface layout. F1 writes the signatures and a
 * no-op body; F2 replaces it in wave 2 with the identity-keyed EventSource (one per tab per
 * surface), replay, the polling fallback and the server notification bridge. Until then there is
 * no stream: status stays "idle" and nothing pretends to be live.
 */
type RealtimeContextValue = { surface: Surface; status: RealtimeStatus; identityKey: string | null }

const RealtimeContext = createContext<RealtimeContextValue | null>(null)

export function RealtimeProvider({ surface, children }: { surface: Surface; children: React.ReactNode }) {
  const identityKey = useIdentityKey(surface)
  return <RealtimeContext.Provider value={{ surface, status: "idle", identityKey }}>{children}</RealtimeContext.Provider>
}

export function useRealtimeContext() {
  return useContext(RealtimeContext)
}
