"use client"

import { useLayoutEffect } from "react"
import { useHydrated } from "@/hooks/use-hydrated"
import { applyStoredSidebar, SIDEBAR_STORAGE_KEY } from "./use-sidebar"

const code = `(function(){try{if(localStorage.getItem(${JSON.stringify(SIDEBAR_STORAGE_KEY)})==="collapsed")document.documentElement.dataset.sidebar="collapsed"}catch(e){}})()`

/**
 * Applies the saved collapsed-sidebar preference before the first paint, so Studio and Admin
 * never flash the expanded panel (see use-sidebar.ts). Rendered in the root layout's <head>.
 *
 * The inline script exists only in the server HTML, where the parser runs it before anything
 * paints; hydration adopts it and then drops it. A document React renders in the browser
 * instead (the error shell a 404 is served in during development) never creates it: React
 * can't run a script it creates and warns about one. There, the layout effect below applies
 * the preference before that document paints, so a client-side link from it into Studio or
 * Admin finds the attribute already on <html> and the rail starts collapsed instead of
 * animating closed. Where the script ran, the effect finds the attribute and does nothing.
 *
 * next/script's beforeInteractive isn't an option: in the App Router it runs after the page's
 * scripts load, past the first paint, and is a client-rendered script tag too.
 */
export function SidebarPrePaint() {
  const hydrated = useHydrated()
  useLayoutEffect(() => applyStoredSidebar(), [])
  return hydrated ? null : <script dangerouslySetInnerHTML={{ __html: code }} />
}
