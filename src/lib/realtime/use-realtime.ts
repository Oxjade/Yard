"use client"

import { useEffect, useRef } from "react"
import type { RealtimePayload, RealtimeEventType, RealtimeStatus } from "@/lib/api/contracts/realtime"
import { useRealtimeContext } from "./provider"

/** idle | connecting | open | retrying | polling | offline. The F1 stub has no stream: "idle". */
export function useRealtimeStatus(): RealtimeStatus {
  return useRealtimeContext()?.status ?? "idle"
}

/**
 * Subscribes to one event type on the surface's stream. The handler is held in a ref, so it never
 * resubscribes. F1 stub: registers nothing (F2 wires it to the provider's dispatcher).
 */
export function useRealtimeEvent<K extends RealtimeEventType>(type: K, handler: (payload: RealtimePayload<K>, meta: { seq?: number; partial: boolean }) => void) {
  const ref = useRef(handler)
  useEffect(() => {
    ref.current = handler
  })
  useEffect(() => {
    void type
  }, [type])
}
