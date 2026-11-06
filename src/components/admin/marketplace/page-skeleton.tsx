import { Bone } from "@/components/feedback/skeletons"
import { cn } from "@/lib/utils"
import { StatRow } from "./page-head"

/** How many lines a block of text runs to: [on phones, from md up]. */
type Lines = [phone: number, wide: number]

/** Bones for a paragraph, one per line, the last one shorter; lines past the wide count go from md up. */
export function TextLines({ lines: [phone, wide], className, bone }: { lines: Lines; className?: string; bone: string }) {
  const n = Math.max(phone, wide)
  return (
    <div aria-hidden className={cn("grid", className)}>
      {Array.from({ length: n }, (_, i) => (
        <Bone
          key={i}
          className={cn(
            bone,
            "w-full",
            i >= phone && "hidden md:block",
            i >= wide && "md:hidden",
            // The last line on each layout runs short, like the end of a paragraph.
            i === phone - 1 && "max-md:w-2/3",
            i === wide - 1 && "md:w-2/3",
          )}
        />
      ))}
    </div>
  )
}

/**
 * Route-level loading state for the Control Center index pages, shaped like the page that
 * replaces it: the title block, the headline cards, and a panel with its tabs and table, at
 * the same sizes, so nothing moves when the content arrives. No numbers until they're known.
 *
 * The column is held to the page width (minmax(0, 1fr)) and no bone asks for more than it
 * has, so a row of tab bones is clipped at the panel's edge on a phone, the way the real tab
 * rail scrolls, instead of widening the page.
 *
 * Platform screens with their own panels pass `panels={0}` and put those panels in
 * `children`; `stats={0}` drops the metric row for a screen that has none. A screen that
 * knows how many lines its description and note run to passes `head`, and the title block
 * is drawn line for line at the page's own line heights.
 */
export function AdminIndexSkeleton({
  label,
  tabs = 4,
  rows = 8,
  panels = 1,
  stats = 4,
  railOnPage = false,
  head,
  children,
}: {
  label: string
  tabs?: number
  rows?: number
  panels?: number
  /** How many headline cards the page has; 0 for none. */
  stats?: number
  /** The section tabs sit on the page above the panel (Finance), not inside it. */
  railOnPage?: boolean
  /** Lines of text in the page's description and note, on phones and from md up. */
  head?: { description: Lines; note?: Lines }
  /** The screen's own panels, after the head, the cards and any table panels. */
  children?: React.ReactNode
}) {
  return (
    <div role="status" aria-label={label} className="@container grid grid-cols-[minmax(0,1fr)] gap-3">
      {head ? (
        <div className="px-1 pt-1 pb-2">
          <Bone className="h-6 w-24 rounded-[5px]" />
          {/* AdminPageHead's h1 line: 1.25 × clamp(1.5rem, 2.6vw, 2rem). */}
          <div className="mt-4 flex h-[clamp(1.875rem,3.25vw,2.5rem)] items-center">
            <Bone className="h-[80%] w-48 max-w-full" />
          </div>
          {/* 13px text on 21px lines, then 12px on 19.5px lines. */}
          <TextLines lines={head.description} className="mt-2 max-w-2xl gap-[7px] py-[3.5px]" bone="h-3.5" />
          {head.note ? <TextLines lines={head.note} className="mt-3 max-w-3xl gap-[7.5px] py-[3.75px]" bone="h-3" /> : null}
        </div>
      ) : (
        <div className="px-1 pt-1 pb-2">
          <Bone className="h-6 w-24 rounded-[5px]" />
          <Bone className="mt-4 h-8 w-48 max-w-full md:h-9" />
          <Bone className="mt-3 h-3.5 w-full max-w-xl" />
          <Bone className="mt-4 h-3 w-2/3 max-w-2xl" />
          <Bone className="mt-2 h-3 w-1/2 max-w-xl" />
        </div>
      )}
      {stats > 0 ? (
        <StatRow label="Loading figures">
          {Array.from({ length: stats }, (_, i) => (
            // StatCard's rows at its sizes: the label and arrow, the numeral, the hint line.
            <div key={i} className="admin-panel rounded-[20px] p-4 md:p-5">
              <div className="flex h-7 items-center justify-between gap-3">
                <Bone className="h-3 w-full max-w-28" />
                <Bone className="size-7 shrink-0 rounded-full" />
              </div>
              <div className="mt-5 flex h-10 items-center">
                <Bone className="h-9 w-24 md:h-10" />
              </div>
              <div className="mt-2 flex h-[18px] items-center">
                <Bone className="h-3 w-full max-w-36" />
              </div>
            </div>
          ))}
        </StatRow>
      ) : null}
      {railOnPage ? (
        <div className="flex gap-1.5 overflow-hidden px-1 pt-3">
          {Array.from({ length: tabs }, (_, i) => (
            <Bone key={i} className={cn("h-10 shrink-0 rounded-full sm:h-8", i === 0 ? "w-32" : "w-24")} />
          ))}
        </div>
      ) : null}
      {Array.from({ length: panels }, (_, p) => (
        <div key={p} className="admin-panel min-w-0 rounded-[20px]">
          <div className="px-4 pt-4 pb-3 md:px-5">
            <Bone className="h-4 w-32" />
            <Bone className="mt-2 h-3 w-full max-w-72" />
            {tabs && !railOnPage ? (
              <div className="mt-4 flex gap-1.5 overflow-hidden">
                {Array.from({ length: tabs }, (_, i) => (
                  <Bone key={i} className={cn("h-10 shrink-0 rounded-full sm:h-7", i === 0 ? "w-32" : "w-24")} />
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
      {children}
    </div>
  )
}
