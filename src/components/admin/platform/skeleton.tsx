import { Bone } from "@/components/feedback/skeletons"
import { AdminIndexSkeleton } from "@/components/admin/marketplace/page-skeleton"
import { cn } from "@/lib/utils"

/**
 * Route-level loading for the platform screens (Advertising, Health, Notifications). The head
 * and the four metric cards are the Control Center's own AdminIndexSkeleton, so every admin
 * section arrives the same way; what follows is shaped like each screen's own panels, at
 * their real sizes, so nothing moves when the content lands. Never a spinner, never a 0.
 * Security has a tabbed table like the other sections and uses AdminIndexSkeleton as it is.
 */

/** Head and metric cards from AdminIndexSkeleton, then the screen's own panels. */
export function PlatformSkeleton({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="@container grid grid-cols-[minmax(0,1fr)] gap-3">
      <AdminIndexSkeleton label={label} panels={0} />
      <div aria-hidden className="grid grid-cols-[minmax(0,1fr)] gap-3">
        {children}
      </div>
    </div>
  )
}

/** For a screen with no metric row (Notifications): the same head bone, then its panels. */
export function HeadOnlySkeleton({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-label={label} className="@container grid grid-cols-[minmax(0,1fr)] gap-3">
      <div className="px-1 pt-1 pb-2">
        <Bone className="h-6 w-24 rounded-[5px]" />
        <Bone className="mt-4 h-8 w-48 md:h-9" />
        <Bone className="mt-3 h-3.5 w-full max-w-xl" />
        <Bone className="mt-4 h-3 w-2/3 max-w-2xl" />
      </div>
      {children}
    </div>
  )
}

function PanelHead({ action = false }: { action?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3 md:px-5">
      <div className="min-w-0 flex-1">
        <Bone className="h-3.5 w-36" />
        <Bone className="mt-2 h-3 w-full max-w-72" />
      </div>
      {action ? <Bone className="h-6 w-20 shrink-0 rounded-[5px]" /> : null}
    </div>
  )
}

/** A panel of list rows (failed jobs, webhook failures, notifications), each with its action. */
export function PanelBone({ rows = 4, className, action = false }: { rows?: number; className?: string; action?: boolean }) {
  return (
    <div className={cn("admin-panel rounded-[20px]", className)}>
      <PanelHead action={action} />
      <ul className="admin-divide border-t border-[var(--admin-hairline)]">
        {Array.from({ length: rows }, (_, i) => (
          <li key={i} className="flex items-start gap-3 px-4 py-3.5 md:px-5">
            <div className="grid flex-1 gap-2">
              <Bone className="h-3.5 w-1/3" />
              <Bone className="h-3 w-2/3" />
              <Bone className="h-3 w-1/2" />
            </div>
            <Bone className="h-10 w-20 sm:h-8" />
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Health's services: tiles one, two, then three across, as the page lays them out. */
export function ServicesBone({ tiles = 6 }: { tiles?: number }) {
  return (
    <div className="admin-panel rounded-[20px]">
      <PanelHead />
      <div className="grid gap-2 px-4 pb-4 @xl:grid-cols-2 @5xl:grid-cols-3 md:px-5 md:pb-5">
        {Array.from({ length: tiles }, (_, i) => (
          <div key={i} className="admin-inset p-3.5">
            <div className="flex items-center justify-between gap-2">
              <Bone className="h-3.5 w-28" />
              <Bone className="h-5 w-20 rounded-[5px]" />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {[0, 1, 2].map((c) => (
                <div key={c}>
                  <Bone className="h-2.5 w-10" />
                  <Bone className="mt-1.5 h-5 w-14" />
                </div>
              ))}
            </div>
            <Bone className="mt-3 h-1 w-full rounded-full" />
            <Bone className="mt-1.5 h-2.5 w-24" />
          </div>
        ))}
      </div>
    </div>
  )
}

/** Health's trend: two switches, four figures and the chart. */
export function TrendBone() {
  return (
    <div className="admin-panel rounded-[20px]">
      <PanelHead action />
      <div className="px-4 pb-4 md:px-5 md:pb-5">
        <div className="flex flex-col gap-3 @3xl:flex-row @3xl:justify-between">
          <Bone className="h-10 w-56 rounded-full sm:h-8" />
          <Bone className="h-10 w-64 rounded-full sm:h-8" />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 @3xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="admin-inset px-3 py-2.5">
              <Bone className="h-2.5 w-16" />
              <Bone className="mt-2 h-6 w-20" />
            </div>
          ))}
        </div>
        <Bone className="mt-4 h-[260px] w-full rounded-lg" />
      </div>
    </div>
  )
}

/** Advertising's review queue: the creative, its facts, and the checks with the decision. */
export function QueueBone() {
  return (
    <div className="admin-panel rounded-[20px]">
      <PanelHead action />
      <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-4 border-t border-[var(--admin-hairline)] p-4 sm:grid-cols-[148px_minmax(0,1fr)] sm:gap-x-4 md:px-5 @5xl:grid-cols-[176px_minmax(0,1fr)_320px] @5xl:gap-x-6">
        <Bone className="aspect-[4/5] w-full rounded-lg" />
        <div className="grid content-start gap-3">
          <Bone className="h-3 w-24" />
          <Bone className="h-5 w-48 max-w-full" />
          <Bone className="mt-2 hidden h-12 w-full sm:block" />
        </div>
        <Bone className="col-span-2 h-56 w-full rounded-[10px] sm:col-span-1 sm:col-start-2 @5xl:col-start-3 @5xl:row-start-1" />
      </div>
    </div>
  )
}

/** A panel with section tabs, the table toolbar and table rows (Advertising's campaigns). */
export function TablePanelBone({ tabs = 3, rows = 6 }: { tabs?: number; rows?: number }) {
  return (
    <div className="admin-panel rounded-[20px]">
      <PanelHead />
      <div className="flex gap-1.5 px-4 pb-3 md:px-5">
        {Array.from({ length: tabs }, (_, i) => (
          <Bone key={i} className={cn("h-10 rounded-full sm:h-7", i === 0 ? "w-28" : "w-24")} />
        ))}
      </div>
      <div className="px-4 pb-4 md:px-5 md:pb-5">
        <div className="flex gap-2">
          <Bone className="h-9 w-full max-w-xs" />
          <Bone className="h-10 w-24 md:h-9 md:w-44" />
        </div>
        <div className="mt-3 overflow-hidden rounded-lg border border-line-soft">
          <div className="flex gap-4 border-b border-line-soft bg-[#111111] px-4 py-3">
            {Array.from({ length: 5 }, (_, i) => (
              <Bone key={i} className={cn("h-3 flex-1", i > 1 && "hidden md:block")} />
            ))}
          </div>
          {Array.from({ length: rows }, (_, r) => (
            <div key={r} className="flex items-center gap-4 border-b border-line-soft px-4 py-3 last:border-0">
              <div className="grid flex-1 gap-1.5">
                <Bone className="h-3.5 w-40 max-w-full" />
                <Bone className="h-2.5 w-24" />
              </div>
              {Array.from({ length: 3 }, (_, c) => (
                <Bone key={c} className={cn("h-3.5 flex-1", c > 0 ? "hidden md:block" : "hidden sm:block")} />
              ))}
              <Bone className="size-8 shrink-0 rounded-md" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** The notifications inbox: its switch and type menu, then rows with an icon and two lines. */
export function InboxBone({ rows = 7 }: { rows?: number }) {
  return (
    <div className="admin-panel rounded-[20px]">
      <PanelHead action />
      <div className="flex items-center justify-between gap-2 px-4 pb-3 md:px-5">
        <Bone className="h-10 w-40 rounded-full sm:h-8" />
        <Bone className="h-10 w-32 sm:h-8" />
      </div>
      <ul className="grid gap-0.5 border-t border-[var(--admin-hairline)] px-2 py-2 md:px-3">
        {Array.from({ length: rows }, (_, i) => (
          <li key={i} className="flex items-start gap-3 px-3 py-3">
            <Bone className="size-8 shrink-0 rounded-full" />
            <div className="grid flex-1 gap-2">
              <Bone className="h-3.5 w-1/2" />
              <Bone className="h-3 w-3/4" />
              <Bone className="h-2.5 w-24" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
