"use client"

import { useSyncExternalStore } from "react"

const subscribe = () => () => {}

/** True only after hydration, so client-only values (storage, clocks) never mismatch the server HTML. */
export function useHydrated() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  )
}
