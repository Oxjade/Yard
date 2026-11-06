"use client"

import { useSyncExternalStore, type MouseEvent } from "react"

/*
 * URL-linked view state (status tabs, filters, the open record), read without
 * useSearchParams so a prerendered page needs no Suspense boundary: the server HTML sees no
 * parameters and the client picks them up straight after hydration. Writes replace the
 * history entry in place (no navigation) and notify every reader, so a reload or a shared
 * link reopens the same view.
 */

const EVENT = "nocturne:url"

/**
 * The Navigation API, where the browser has it. Its `currententrychange` fires for every
 * same-document URL change, Next's own pushState and replaceState included, so readers also
 * follow a link or router.push to the page that's open, even when Next already held that URL
 * and changes the address without re-rendering the page.
 */
const navigationApi = () => (window as Window & { navigation?: EventTarget }).navigation

function subscribe(onChange: () => void) {
  // Next writes history while it commits a route, inside React's insertion effects, where a
  // store update isn't allowed; the change is picked up straight after instead.
  const onEntry = () => queueMicrotask(onChange)
  const nav = navigationApi()
  window.addEventListener("popstate", onChange)
  window.addEventListener(EVENT, onChange)
  nav?.addEventListener("currententrychange", onEntry)
  return () => {
    window.removeEventListener("popstate", onChange)
    window.removeEventListener(EVENT, onChange)
    nav?.removeEventListener("currententrychange", onEntry)
  }
}

const readSearch = () => window.location.search
const serverSearch = () => ""

/** One query parameter, kept in step with writeParams, showInPlace, Next navigations and back/forward. */
export function useSearchParam(name: string) {
  const search = useSyncExternalStore(subscribe, readSearch, serverSearch)
  return new URLSearchParams(search).get(name)
}

/** Tells every useSearchParam reader that the URL changed. */
export function notifyUrlChange() {
  window.dispatchEvent(new Event(EVENT))
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
  notifyUrlChange()
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches

/**
 * Shows `href` in place when it points at the page already open (another tab, filter or
 * record of it) and returns true; returns false for any other page, which needs a navigation.
 *
 * By default the URL becomes exactly `href`'s path and query. With `merge` (a record picked
 * on the page it lives on), `href`'s parameters are added to the ones already there, the way
 * writeParams does, so the page's tab, filters and search are still there when the record
 * closes; only an `href` that names a different `tab` starts that tab from a clean query, so
 * one tab's filters don't leak into another. A #section is scrolled into view rather than
 * kept in the URL.
 *
 * The replace goes through Next's history integration, so usePathname and useSearchParams
 * follow it, and every useSearchParam reader is notified. A router.push to the page you're
 * on would refetch and remount it instead, losing its state.
 */
export function showInPlace(href: string, { merge = false }: { merge?: boolean } = {}) {
  const url = new URL(href, window.location.href)
  if (url.origin !== window.location.origin || url.pathname !== window.location.pathname) return false
  const current = new URLSearchParams(window.location.search)
  const tab = url.searchParams.get("tab")
  const query = merge && (tab === null || tab === current.get("tab")) ? current : new URLSearchParams()
  url.searchParams.forEach((v, k) => query.set(k, v))
  const search = query.toString()
  const target = `${url.pathname}${search ? `?${search}` : ""}`
  // `null` state: Next copies its own entry state over and syncs its router with the new URL.
  if (target !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, "", target)
  notifyUrlChange()
  const id = decodeURIComponent(url.hash.slice(1))
  if (id) document.getElementById(id)?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" })
  return true
}

/**
 * Follows a link to the page that's open the way a navigation would look (the exact URL, from
 * the top or at its #section) without remounting the page, and returns true; returns false
 * for any other page. For the shell's section links and "Go to" results: their page's URL
 * readers switch to its default view instead of keeping the tab or filter that was open.
 */
export function showPageInPlace(href: string) {
  if (!showInPlace(href)) return false
  if (!new URL(href, window.location.href).hash) window.scrollTo({ top: 0 })
  return true
}

/**
 * Click handler for a link that may point at the page that's open (a sidebar section): an
 * unmodified click shows it in place (see showPageInPlace) instead of a Next navigation that
 * would leave its URL readers on the old view. Returns true when it handled the click.
 */
export function followInPlace(e: MouseEvent<HTMLAnchorElement>, href: string) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false
  if (e.currentTarget.target && e.currentTarget.target !== "_self") return false
  const url = new URL(href, window.location.href)
  if (url.origin !== window.location.origin || url.pathname !== window.location.pathname) return false
  e.preventDefault()
  return showPageInPlace(href)
}
