import { Bone } from "@/components/feedback/skeletons"
import { cn } from "@/lib/utils"
import { StatRow } from "./page-head"

/**
 * Route-level loading state for the Control Center index pages, shaped like the page that
 * replaces it: the title block, four headline cards, and a panel with its tabs and table, at
 * the same sizes, so nothing moves when the content arrives. No numbers until they're known.
 */
export function AdminIndexSkeleton({ label, tabs = 4, rows = 8, panels = 1, railOnPage = false }: { label: string; tabs?: number; rows?: number; panels?: number; /** The section tabs sit on the page above the panel (Finance), not inside it. */ railOnPage?: boolean }) {
  return (
    <div role="status" aria-label={label} className="@container grid gap-3">
      <div className="px-1 pt-1 pb-2">
        <Bone className="h-6 w-24 rounded-[5px]" />
        <Bone className="mt-4 h-8 w-48 md:h-9" />
        <Bone className="mt-3 h-3.5 w-full max-w-xl" />
        <Bone className="mt-4 h-3 w-2/3 max-w-2xl" />
        <Bone className="mt-2 h-3 w-1/2 max-w-xl" />
      </div>
      <StatRow label="Loading figures">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="admin-panel rounded-[20px] p-4 md:p-5">
            <div className="flex items-center justify-between">
              <Bone className="h-3 w-28" />
              <Bone className="size-7 rounded-full" />
            </div>
            <Bone className="mt-5 h-9 w-24 md:h-10" />
            <Bone className="mt-3 h-3 w-36" />
          </div>
        ))}
      </StatRow>
      {railOnPage ? (
        <div className="flex gap-1.5 overflow-hidden px-1 pt-3">
          {Array.from({ length: tabs }, (_, i) => (
            <Bone key={i} className={cn("h-10 shrink-0 rounded-full sm:h-8", i === 0 ? "w-32" : "w-24")} />
          ))}
        </div>
      ) : null}
      {Array.from({ length: panels }, (_, p) => (
        <div key={p} className="admin-panel rounded-[20px]">
          <div className="px-4 pt-4 pb-3 md:px-5">
            <Bone className="h-4 w-32" />
            <Bone className="mt-2 h-3 w-72 max-w-full" />
            {tabs && !railOnPage ? (
              <div className="mt-4 flex gap-1.5">
                {Array.from({ length: tabs }, (_, i) => (
                  <Bone key={i} className={cn("h-10 rounded-full sm:h-7", i === 0 ? "w-32" : "w-24")} />
                ))}
              </div>
            ) : null}
          </div>
          <div className="border-t border-[var(--admin-hairline)] p-3 sm:p-4 md:p-5">
            <Bone className="h-9 w-full max-w-xs" />
            <div className="mt-3 overflow-hidden rounded-lg border border-line-soft">
              <div className="flex gap-4 border-b border-line-soft bg-[#111111] px-4 py-3">
                {Array.from({ length: 5 }, (_, i) => (
                  <Bone key={i} className={cn("h-3 flex-1", i > 1 && "hidden md:block")} />
                ))}
              </div>
              {Array.from({ length: rows }, (_, r) => (
                <div key={r} className="flex items-center gap-4 border-b border-line-soft px-4 py-3.5 last:border-0">
                  <Bone className="size-8 shrink-0 rounded-md" />
                  <Bone className="h-3.5 max-w-44 flex-1" />
                  {Array.from({ length: 3 }, (_, c) => (
                    <Bone key={c} className={cn("h-3.5 flex-1", c > 0 && "hidden md:block")} />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
