"use client"

import { useCallback, useEffect, useLayoutEffect, useSyncExternalStore } from "react"

/**
 * The desktop sidebar's collapsed preference. The source of truth is the
 * `data-sidebar="collapsed"` attribute on <html>, which the pre-paint script in
 * app/layout.tsx sets from localStorage before the first paint. Every visual difference
 * between the two states is CSS (the `sidebar-collapsed:` variant); React only reads the
 * attribute for behaviour (tooltips, labels, aria-expanded).
 */

export const SIDEBAR_STORAGE_KEY = "nocturne-sidebar"
const DESKTOP_QUERY = "(min-width: 64rem)"

const read = () => document.documentElement.dataset.sidebar === "collapsed"

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-sidebar"] })
  return () => observer.disconnect()
}

function write(collapsed: boolean) {
  const root = document.documentElement
  if (collapsed) root.dataset.sidebar = "collapsed"
  else delete root.dataset.sidebar
  try {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? "collapsed" : "expanded")
  } catch {
    // Storage unavailable (private mode): the choice lasts for this page only.
  }
}

/** True while focus is in a field, so single-key and editing shortcuts stay out of the way. */
export function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT"
}

export function useSidebarCollapsed() {
  const collapsed = useSyncExternalStore(subscribe, read, () => false)

  // In development, Strict Mode's remount resets <html> to its JSX attributes and drops the
  // one the pre-paint script set. Re-apply it before paint. A no-op in production.
  useLayoutEffect(() => {
    try {
      if (localStorage.getItem(SIDEBAR_STORAGE_KEY) === "collapsed" && !read()) document.documentElement.dataset.sidebar = "collapsed"
    } catch {
      // Storage unavailable: keep the default.
    }
  }, [])

  const toggle = useCallback(() => write(!read()), [])

  // ⌘B / Ctrl+B toggles the panel on desktop (where it exists), never while typing.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== "b" || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return
      if (isTypingTarget(e.target) || !window.matchMedia(DESKTOP_QUERY).matches) return
      e.preventDefault()
      write(!read())
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  return { collapsed, toggle }
}
