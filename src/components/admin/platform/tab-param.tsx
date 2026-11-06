"use client"

import { Suspense, useEffect, useRef } from "react"
import { useSearchParams } from "next/navigation"

function Sync<T extends string>({ param, values, onChange }: { param: string; values: readonly T[]; onChange: (v: T) => void }) {
  const value = useSearchParams().get(param)
  const handler = useRef(onChange)
  useEffect(() => {
    handler.current = onChange
  })
  useEffect(() => {
    if (value && (values as readonly string[]).includes(value)) handler.current(value as T)
    // `values` is a static list per page; only the URL value drives this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  return null
}

/**
 * Keeps a section's tab in step with `?tab=` in the URL, so a metric card, the command palette
 * or a shared link can open a section directly. It reads the URL inside its own Suspense
 * boundary, so the rest of the page still prerenders.
 */
export function TabParam<T extends string>(props: { param?: string; values: readonly T[]; onChange: (v: T) => void }) {
  return (
    <Suspense fallback={null}>
      <Sync param={props.param ?? "tab"} values={props.values} onChange={props.onChange} />
    </Suspense>
  )
}

/** Records the selected tab in the URL without a navigation, so a reload reopens it. */
export function writeTabParam(value: string, param = "tab") {
  const url = new URL(window.location.href)
  if (url.searchParams.get(param) === value) return
  url.searchParams.set(param, value)
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`)
}

/**
 * Click handler (capture phase) for a metric card whose arrow opens a tab of this page
 * (`?tab=…#section`): switches the tab in place and scrolls to the section, with no server
 * round trip. The href stays for open-in-new-tab, and modified clicks still follow it.
 */
export function inPageTab<T extends string>(choose: (v: T) => void, tab: T, section: string) {
  return (e: React.MouseEvent) => {
    const link = (e.target as HTMLElement).closest("a")
    if (!link || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    choose(tab)
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    document.getElementById(section)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" })
    // Keyboard users land on the tab they opened, not on a card that has scrolled away.
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`#${section} [role=tab][aria-selected=true]`)?.focus({ preventScroll: true }))
  }
}
