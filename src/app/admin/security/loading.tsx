import { AdminIndexSkeleton, TextLines } from "@/components/admin/marketplace/page-skeleton"
import { Bone } from "@/components/feedback/skeletons"
import { cn } from "@/lib/utils"

/** The section tabs' widths on phones and from sm up (Audit log, Team, Sessions, Policy). */
const TABS = [
  ["w-[76px] sm:w-[72px]", "w-14"],
  ["w-[77px] sm:w-[73px]", "w-11"],
  ["w-[98px] sm:w-[94px]", "w-16"],
  ["w-[59px] sm:w-[55px]", "w-10"],
] as const

/**
 * The audit table's columns: where each sits, and its line and second line. Phones show the
 * action (with the actor and target under it) and the time; md adds the actor and target
 * columns, xl the reason and approver.
 */
const COLS: [col: string, top: string, sub?: string][] = [
  ["grid min-w-0 flex-1 md:w-[200px] md:flex-none", "max-w-36", "max-w-48 md:hidden"],
  ["hidden md:grid md:w-[97px]", "max-w-24", "max-w-16"],
  ["hidden min-w-0 md:grid md:flex-1", "max-w-40"],
  ["hidden min-w-0 xl:grid xl:flex-1", "max-w-44"],
  ["hidden xl:grid xl:w-[84px]", "max-w-16"],
  ["ml-auto grid w-16", "max-w-16", "max-w-14"],
]

/**
 * Security in bones, shaped like the audit tab it opens on: the title block at the page's
 * line count, the four figures, then the panel with its segmented tab rail, the read-only
 * note, the toolbar (search, then Filters and Export on phones; search, two filter menus and
 * Export from md up), the table and its pager, at the loaded page's heights.
 */
export default function Loading() {
  return (
    <AdminIndexSkeleton label="Loading security" panels={0} head={{ description: [3, 2], note: [3, 2] }}>
      <div aria-hidden className="admin-panel min-w-0 overflow-hidden rounded-[20px]">
        <div className="px-4 pt-4 pb-3 md:px-5">
          <div className="flex h-5 items-center">
            <Bone className="h-3.5 w-60 max-w-full" />
          </div>
          {/* 12px text on 16.5px lines. */}
          <TextLines lines={[2, 1]} className="mt-1 max-w-md gap-[4.5px] py-[2.25px]" bone="h-3" />
        </div>
        <div className="-mt-px px-4 pb-3 md:px-5">
          <div className="flex w-fit max-w-full gap-0.5 overflow-hidden rounded-full border border-[var(--admin-hairline)] bg-white/[0.02] p-[3px]">
            {TABS.map(([w, text], i) =>
              i === 0 ? (
                <Bone key={i} className={cn("h-10 shrink-0 rounded-full sm:h-7", w)} />
              ) : (
                <span key={i} className={cn("flex h-10 shrink-0 items-center justify-center sm:h-7", w)}>
                  <Bone className={cn("h-2.5", text)} />
                </span>
              ),
            )}
          </div>
        </div>
        <div className="grid gap-3 border-t border-[var(--admin-hairline)] px-4 pt-4 pb-4 md:px-5 md:pb-5">
          {/* The read-only note: 12px on 18px lines, two on phones. */}
          <div className="flex items-start gap-1.5">
            <span className="flex h-[18px] items-center">
              <Bone className="size-3.5 rounded-full" />
            </span>
            <TextLines lines={[2, 1]} className="max-w-md flex-1 gap-1.5 py-[3px]" bone="h-3" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Bone className="h-9 min-w-56 flex-1 sm:max-w-xs" />
            <Bone className="h-10 w-[100px] md:hidden" />
            <Bone className="hidden h-9 w-[176px] md:block" />
            <Bone className="hidden h-9 w-[220px] md:block" />
            <Bone className="h-10 w-[155px] md:ml-auto md:h-9" />
          </div>
          <div className="overflow-hidden rounded-lg border border-line-soft">
            <div className="flex h-[39px] items-center gap-4 border-b border-line-soft bg-[#111111] px-4">
              <Bone className="size-4 shrink-0" />
              {COLS.map(([col], i) => (
                <div key={i} className={col}>
                  <Bone className={cn("h-3", i === COLS.length - 1 ? "ml-auto w-10" : "w-14")} />
                </div>
              ))}
            </div>
            {Array.from({ length: 8 }, (_, r) => (
              <div key={r} className="flex h-[61.6px] items-center gap-4 border-b border-line-soft px-4 md:h-[59.25px]">
                <Bone className="size-4 shrink-0" />
                {COLS.map(([col, top, sub], i) => (
                  <div key={i} className={cn(col, "gap-2", i === COLS.length - 1 && "justify-items-end")}>
                    <Bone className={cn("h-3.5 w-full", top)} />
                    {sub ? <Bone className={cn("h-2.5 w-full", sub)} /> : null}
                  </div>
                ))}
              </div>
            ))}
            <div className="flex h-[60px] items-center justify-between gap-3 px-4 sm:h-12">
              <Bone className="h-3 w-14" />
              <div className="flex items-center gap-3">
                <Bone className="h-3 w-16" />
                <Bone className="size-10 rounded-md sm:size-7" />
                <Bone className="size-10 rounded-md sm:size-7" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </AdminIndexSkeleton>
  )
}
