"use client"

import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"

/**
 * Whether this document has already shown a route. The first route of a document load is never
 * animated: it is the server HTML, and it must be visible from the first paint whatever the
 * browser does with animations. An entrance that starts at opacity 0 holds its first keyframe
 * until the page produces frames, and an Android WebView that loads while hidden (the apps fade
 * it in once it has loaded) left the whole page body at opacity 0: the header and home bar
 * showed, the content didn't. Module state, so it lasts for the document and resets on reload.
 */
let shownFirstRoute = false

/**
 * A light route transition on client navigation: content fades in (and, on dashboards, rises
 * 4px) in ~220ms, replayed because the template remounts. The first route of a document load,
 * the server-rendered one, renders without it (on the server and in the hydrating render alike,
 * so they agree), so a page never depends on an animation, on JavaScript or on the page being on
 * screen to be visible. Shells stay put, so navigation feels immediate. Reduced motion: instant.
 */
export function RouteTransition({ children, rise = false }: { children: React.ReactNode; rise?: boolean }) {
  // Latched at mount: a re-render never replays it, a remount on navigation (the template) does.
  const [animate] = useState(() => shownFirstRoute)
  useEffect(() => {
    shownFirstRoute = true
  }, [])
  return <div className={cn(animate && "animate-in fade-in-0 duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)]", animate && rise && "slide-in-from-bottom-1")}>{children}</div>
}
