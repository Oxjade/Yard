"use client"

import { useSyncExternalStore } from "react"

/** A media query, false until hydrated (server HTML assumes a wide, fine-pointer screen). */
export function useMedia(query: string) {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query)
      m.addEventListener("change", cb)
      return () => m.removeEventListener("change", cb)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}

export const useBelowLg = () => useMedia("(max-width: 1023.98px)")
export const useCoarse = () => useMedia("(pointer: coarse)")
