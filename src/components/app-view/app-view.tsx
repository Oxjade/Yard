"use client"

import { createContext, useContext } from "react"
import Link from "next/link"

/**
 * App view (`?view=app`): a page the iOS and Android apps show in a WebView, rendered by
 * src/app/app-view/layout.tsx without the marketplace chrome. Pages inside it read this to keep
 * the parameter on links to the other app-view pages.
 */
const AppViewContext = createContext(false)

export function AppViewProvider({ children }: { children: React.ReactNode }) {
  return <AppViewContext.Provider value>{children}</AppViewContext.Provider>
}

export const useAppView = () => useContext(AppViewContext)

/** The pages the apps open in a WebView (next.config.ts rewrites them with ?view=app). */
const APP_VIEW_PAGES = /^\/(legal\/[a-z-]+|support)(?=$|[?#])/

/** `href` with view=app added when it is another app-view page; anything else as it is. */
export function appViewHref(href: string) {
  if (!APP_VIEW_PAGES.test(href)) return href
  const hash = href.indexOf("#")
  const [path, fragment] = hash === -1 ? [href, ""] : [href.slice(0, hash), href.slice(hash)]
  if (/[?&]view=app(&|$)/.test(path)) return href
  return `${path}${path.includes("?") ? "&" : "?"}view=app${fragment}`
}

/** A next/link that keeps the app view on the app-view pages it links to. */
export function AppViewLink({ href, ...rest }: React.ComponentProps<typeof Link> & { href: string }) {
  const inApp = useAppView()
  return <Link href={inApp ? appViewHref(href) : href} {...rest} />
}
