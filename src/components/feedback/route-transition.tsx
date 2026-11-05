import { cn } from "@/lib/utils"

/**
 * A light route transition: content fades in (and, on dashboards, rises 4px) in ~220ms.
 * CSS-driven, so it runs on first paint without waiting for JavaScript (no invisible
 * server-rendered content) and replays on client navigation because the template
 * remounts. Shells stay put, so navigation feels immediate. Reduced motion: instant.
 */
export function RouteTransition({ children, rise = false }: { children: React.ReactNode; rise?: boolean }) {
  return <div className={cn("animate-in fade-in-0 duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)]", rise && "slide-in-from-bottom-1")}>{children}</div>
}
