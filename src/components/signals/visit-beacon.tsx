"use client"

import { useEffect } from "react"
import { usePathname } from "next/navigation"

/**
 * Counts a marketplace page view for admin Traffic by country: once per page, after it has been
 * visible for 1 s, so prefetches, background tabs and quick bounces don't count. Renders nothing.
 */
export function VisitBeacon() {
  const pathname = usePathname()
  useEffect(() => {
    let sent = false
    let timer: number | null = null
    const send = () => {
      sent = true
      try {
        if (typeof navigator.sendBeacon === "function" && navigator.sendBeacon("/api/visit", new Blob(["{}"], { type: "text/plain" }))) return
      } catch {
        /* fall through to fetch */
      }
      void fetch("/api/visit", { method: "POST", body: "{}", keepalive: true, credentials: "same-origin", headers: { "Content-Type": "text/plain" } }).catch(() => {})
    }
    const arm = () => {
      if (sent || timer !== null || document.visibilityState !== "visible") return
      timer = window.setTimeout(() => {
        timer = null
        if (!sent && document.visibilityState === "visible") send()
      }, 1000)
    }
    const onVisibility = () => {
      if (document.visibilityState === "visible") arm()
      else if (timer !== null) {
        window.clearTimeout(timer)
        timer = null
      }
    }
    arm()
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      document.removeEventListener("visibilitychange", onVisibility)
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [pathname])
  return null
}
