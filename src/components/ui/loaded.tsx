"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"

/**
 * Skeleton → content. Returns the `content-in` class (a 260ms fade, globals.css) for the content's
 * root, but only when a skeleton was actually on screen first: content that is ready on the first
 * render (server HTML, cached data) appears without a fade. Pass the same condition that chooses
 * the skeleton.
 *
 *   const reveal = useContentReveal(!loading)
 *   if (loading) return <ListSkeleton />
 *   return <section className={cn("…", reveal)}>…</section>
 */
export function useContentReveal(ready: boolean): string | undefined {
  const [hadSkeleton, setHadSkeleton] = useState(!ready)
  // Adjusting state while rendering (React's documented pattern): remembers that a skeleton showed.
  if (!ready && !hadSkeleton) setHadSkeleton(true)
  return ready && hadSkeleton ? "content-in" : undefined
}

/** The same as a component: the skeleton while loading, then the content in a fading wrapper. */
export function Loaded({ ready, fallback, className, children }: { ready: boolean; fallback: React.ReactNode; className?: string; children: React.ReactNode }) {
  const reveal = useContentReveal(ready)
  if (!ready) return <>{fallback}</>
  return <div className={cn(reveal, className)}>{children}</div>
}
