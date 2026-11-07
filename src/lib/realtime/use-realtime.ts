"use client"

import { useEffect, useRef } from "react"
import type { RealtimeMeta, RealtimePayload, RealtimeEventType, RealtimeStatus } from "@/lib/api/contracts/realtime"
import { useRealtimeContext } from "./provider"

/** idle | connecting | open | retrying | polling | offline for the nearest RealtimeProvider's surface. */
export function useRealtimeStatus(): RealtimeStatus {
  return useRealtimeContext()?.status ?? "idle"
}

/**
 * Subscribes to one event type on the surface's stream. The handler is held in a ref, so it never
 * resubscribes. `meta.partial` is true for replayed or polled events: their payload is the
 * redacted stored form (ids and status only for message events, §4.1), so refetch the affected
 * thread or list through the scoped API instead of reading the payload.
 */
export function useRealtimeEvent<K extends RealtimeEventType>(type: K, handler: (payload: RealtimePayload<K>, meta: RealtimeMeta) => void) {
  const ref = useRef(handler)
  useEffect(() => {
    ref.current = handler
  })
  const ctx = useRealtimeContext()
  const on = ctx?.on
  useEffect(() => {
    if (!on) return
    return on(type, (payload, meta) => ref.current(payload as RealtimePayload<K>, meta))
  }, [on, type])
}

/** The same for an event type outside the contract's union (a cluster's new event before it lands there). */
export function useRealtimeEventName(type: string, handler: (payload: unknown, meta: RealtimeMeta) => void) {
  const ref = useRef(handler)
  useEffect(() => {
    ref.current = handler
  })
  const on = useRealtimeContext()?.on
  useEffect(() => {
    if (!on) return
    return on(type, (payload, meta) => ref.current(payload, meta))
  }, [on, type])
}
