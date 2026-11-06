"use client"

import { useSyncExternalStore } from "react"

const subscribe = () => () => {}
const isApple = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

/** "⌘" on Apple devices, "Ctrl" elsewhere (and on the server), for shortcut hints. */
export function useModKey() {
  return useSyncExternalStore(
    subscribe,
    () => (isApple() ? "⌘" : "Ctrl"),
    () => "Ctrl",
  )
}
