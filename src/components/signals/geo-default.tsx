"use client"

import { useEffect } from "react"
import { countries, type CountryCode } from "@/config/markets"
import { useSession } from "@/lib/stores/session"

const ASKED = "yard.geo.asked"

/**
 * Starts delivery and currency from the visitor's own country (once per browser session) while
 * they haven't picked one themselves. Renders nothing; a failed lookup keeps the current choice.
 */
export function GeoDefault() {
  useEffect(() => {
    if (useSession.getState().shipToChosen) return
    try {
      if (sessionStorage.getItem(ASKED)) return
      sessionStorage.setItem(ASKED, "1")
    } catch {
      /* storage blocked: ask anyway */
    }
    const ctrl = new AbortController()
    fetch("/api/geo", { headers: { "X-Yard-Client": "1" }, credentials: "same-origin", signal: ctrl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<{ country: string | null }>) : null))
      .then((d) => {
        const code = d?.country
        if (code && code in countries) useSession.getState().detectShipTo(code as CountryCode)
      })
      .catch(() => {})
    return () => ctrl.abort()
  }, [])
  return null
}
