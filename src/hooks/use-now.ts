"use client"

import { useEffect, useState } from "react"

/**
 * Demo clock. Drops store their release time as an offset from the moment the demo
 * first loads in this tab, so countdowns stay meaningful whenever the prototype is
 * opened. The backend stores absolute UTC instants instead.
 */
let anchor: number | null = null

export function getDemoAnchor() {
  if (anchor === null) {
    try {
      const stored = sessionStorage.getItem("nocturne-demo-anchor")
      anchor = stored ? Number(stored) : Date.now()
      if (!stored) sessionStorage.setItem("nocturne-demo-anchor", String(anchor))
    } catch {
      anchor = Date.now()
    }
  }
  return anchor
}

/** Current time, ticking every `intervalMs`. `null` until mounted (never rendered on the server). */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    getDemoAnchor()
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}
