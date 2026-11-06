"use client"

import { useCallback, useSyncExternalStore } from "react"
import { useAdmin } from "@/lib/stores/admin"

/*
 * URL-linked view state for the Control Center's index pages (status tabs, filters, the open
 * record). Read without useSearchParams, so the prerendered page needs no Suspense boundary:
 * the server HTML sees no parameters and the client picks them up straight after hydration.
 * Writes replace the history entry in place (no navigation) and notify every reader, so a
 * reload or a shared link reopens the same view.
 */

const EVENT = "nocturne:url"

function subscribe(onChange: () => void) {
  window.addEventListener("popstate", onChange)
  window.addEventListener(EVENT, onChange)
  return () => {
    window.removeEventListener("popstate", onChange)
    window.removeEventListener(EVENT, onChange)
  }
}

/** One query parameter, kept in step with writeParams and back/forward. */
export function useSearchParam(name: string) {
  const search = useSyncExternalStore(subscribe, () => window.location.search, () => "")
  return new URLSearchParams(search).get(name)
}

/** Updates query parameters in place, without a navigation. `null` removes a parameter. */
export function writeParams(next: Record<string, string | null>) {
  const url = new URL(window.location.href)
  for (const [k, v] of Object.entries(next)) {
    if (v === null) url.searchParams.delete(k)
    else url.searchParams.set(k, v)
  }
  const target = `${url.pathname}${url.search}${url.hash}`
  if (target !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(window.history.state, "", target)
  window.dispatchEvent(new Event(EVENT))
}

/**
 * Lets links inside it that point at the current page (a headline card's arrow to
 * `?tab=refunds#finance-sections`) change the view in place: the parameters are applied with
 * writeParams and the named section is scrolled into view, rather than a navigation that
 * would leave the page's own state where it was. Modified clicks (new tab, new window) and
 * links to other pages behave as usual.
 */
export function InPageLinks({ children, className }: { children: React.ReactNode; className?: string }) {
  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    const a = (e.target as HTMLElement).closest("a")
    if (!a || a.target === "_blank") return
    const url = new URL(a.href, window.location.href)
    if (url.origin !== window.location.origin || url.pathname !== window.location.pathname) return
    e.preventDefault()
    const next: Record<string, string | null> = {}
    url.searchParams.forEach((v, k) => (next[k] = v))
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`)
    writeParams(next)
    const id = url.hash.slice(1)
    if (id) document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [])
  return (
    <div className={className ? `min-w-0 ${className}` : "min-w-0"} onClickCapture={onClickCapture}>
      {children}
    </div>
  )
}

const onHydrate = (cb: () => void) => useAdmin.persist.onFinishHydration(cb)

/** True once the admin store has loaded this browser's decisions, so counts never flash a stale figure. */
export function useAdminReady() {
  return useSyncExternalStore(onHydrate, () => useAdmin.persist.hasHydrated(), () => false)
}

const PHONE = "(max-width: 639px)"
const onMedia = (cb: () => void) => {
  const m = window.matchMedia(PHONE)
  m.addEventListener("change", cb)
  return () => m.removeEventListener("change", cb)
}

/**
 * Phone width. Tables drop bulk selection there: the checkbox column costs a fifth of the
 * row, and picking many records at once is a desk task. Assumes a wide screen until hydrated.
 */
export function usePhone() {
  return useSyncExternalStore(onMedia, () => window.matchMedia(PHONE).matches, () => false)
}
