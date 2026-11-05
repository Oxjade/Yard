"use client"

import { useEffect, useRef } from "react"

/**
 * Opens a record named in the URL (e.g. /admin/brands?review=app_kaya) once, after mount,
 * so other Admin screens can link straight to it. Read in an effect, not during render, so
 * the prerendered page needs no Suspense boundary and never mismatches on hydration.
 */
export function useUrlRecord(param: string, onFound: (id: string) => void) {
  const handler = useRef(onFound)
  useEffect(() => {
    handler.current = onFound
  })
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get(param)
    if (id) handler.current(id)
  }, [param])

  /** Drop the parameter when the record is closed, so a reload doesn't reopen it. */
  return function clear() {
    const url = new URL(window.location.href)
    if (!url.searchParams.has(param)) return
    url.searchParams.delete(param)
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`)
  }
}
