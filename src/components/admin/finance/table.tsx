"use client"

import { useEffect, useSyncExternalStore } from "react"
import { cn } from "@/lib/utils"

/*
 * Orders and Finance tables. Search, filters and pagination come from ../platform/table and the
 * reason dialog from ../platform/reason-dialog; what stays here is what those pieces don't
 * have yet: rows that open a detail, a selected row, a totals row and row tones (AdminTable),
 * the index panel with its toolbar (TablePanel), and URL-linked views.
 */

export type Column<T> = {
  key: string
  header: string
  cell: (row: T) => React.ReactNode
  className?: string
  align?: "left" | "right"
  /** The column that names the row; it carries the keyboard-focusable button that opens the detail. */
  primary?: boolean
}

export type MobileRow = { title: React.ReactNode; meta?: React.ReactNode; lead?: React.ReactNode; trail?: React.ReactNode; footer?: React.ReactNode }

/**
 * A dense Control Center table from tablet width up, and a stacked list on phones. Records
 * are never edited inline: rows open a detail, and the only controls in a row are the
 * decisions that record allows.
 */
export function AdminTable<T>({
  rows,
  columns,
  rowKey,
  onOpen,
  openLabel,
  mobileRow,
  rowClassName,
  minWidth = 880,
  caption,
  selectedKey,
  foot,
}: {
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string
  onOpen?: (row: T) => void
  openLabel?: (row: T) => string
  mobileRow: (row: T) => MobileRow
  rowClassName?: (row: T) => string | false | undefined
  minWidth?: number
  caption: string
  selectedKey?: string | null
  /** A totals row: one cell per column, keyed by column key. */
  foot?: Partial<Record<string, React.ReactNode>>
}) {
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-[13px]" style={{ minWidth }}>
          <caption className="sr-only">{caption}</caption>
          <thead className="border-b border-line-soft bg-surface/60 text-[11px] text-ink-3">
            <tr>
              {columns.map((c, i) => (
                <th key={c.key} scope="col" className={cn("px-3 py-2.5 font-normal whitespace-nowrap", i === 0 && "pl-4", i === columns.length - 1 && "pr-4", c.align === "right" && "text-right", c.className)}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {rows.map((row) => {
              const k = rowKey(row)
              return (
                <tr
                  key={k}
                  data-row={k}
                  onClick={onOpen ? () => onOpen(row) : undefined}
                  className={cn("transition-colors", onOpen && "cursor-pointer hover:bg-white/[0.025]", selectedKey === k && "bg-purple/[0.07]", rowClassName?.(row))}
                >
                  {columns.map((c, i) => (
                    <td key={c.key} className={cn("px-3 py-2.5 align-middle", i === 0 && "pl-4", i === columns.length - 1 && "pr-4", c.align === "right" && "text-right tabular", c.className)}>
                      {c.primary && onOpen ? (
                        <button type="button" aria-label={openLabel?.(row)} className="max-w-full text-left outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-violet">
                          {c.cell(row)}
                        </button>
                      ) : (
                        c.cell(row)
                      )}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
          {foot ? (
            <tfoot className="border-t border-line bg-surface/60">
              <tr>
                {columns.map((c, i) => (
                  <td key={c.key} className={cn("px-3 py-2.5 font-medium text-ink", i === 0 && "pl-4", i === columns.length - 1 && "pr-4", c.align === "right" && "text-right tabular")}>
                    {foot[c.key] ?? null}
                  </td>
                ))}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      <ul className="divide-y divide-line-soft md:hidden" aria-label={caption}>
        {rows.map((row) => {
          const k = rowKey(row)
          const m = mobileRow(row)
          const inner = (
            <>
              {m.lead}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-ink">{m.title}</span>
                {m.meta ? <span className="mt-0.5 block truncate text-[11px] text-ink-3">{m.meta}</span> : null}
              </span>
              {m.trail ? <span className="flex shrink-0 flex-col items-end gap-1">{m.trail}</span> : null}
            </>
          )
          return (
            <li key={k} data-row={k} className={cn(selectedKey === k && "bg-purple/[0.07]", rowClassName?.(row))}>
              {onOpen ? (
                <button type="button" onClick={() => onOpen(row)} aria-label={openLabel?.(row)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors active:bg-white/[0.03]">
                  {inner}
                </button>
              ) : (
                <div className="flex items-center gap-3 px-4 py-2.5">{inner}</div>
              )}
              {m.footer ? <div className="-mt-0.5 px-4 pb-3">{m.footer}</div> : null}
            </li>
          )
        })}
        {foot ? <li className="bg-surface/60 px-4 py-2.5">{foot.mobile}</li> : null}
      </ul>
    </>
  )
}

/** The panel every index sits in: title row, toolbar (beside the title, or under it when `stacked`), then the table flush to the edges. */
export function TablePanel({ title, description, toolbar, children, id, stacked = false }: { title: string; description?: React.ReactNode; toolbar?: React.ReactNode; children: React.ReactNode; id: string; stacked?: boolean }) {
  return (
    <section aria-labelledby={id} className="overflow-hidden rounded-lg border border-line-soft bg-card">
      <div className={cn("flex flex-col gap-3 border-b border-line-soft px-4 py-3", !stacked && "lg:flex-row lg:items-center lg:justify-between")}>
        <div className="min-w-0">
          <h2 id={id} className="text-[13px] font-medium text-ink">{title}</h2>
          {description ? <p className="mt-0.5 text-[11px] text-ink-2">{description}</p> : null}
        </div>
        {toolbar ? <div className="flex flex-wrap items-center gap-2">{toolbar}</div> : null}
      </div>
      {children}
    </section>
  )
}

const subscribeToUrl = (onChange: () => void) => {
  window.addEventListener("popstate", onChange)
  return () => window.removeEventListener("popstate", onChange)
}

/**
 * A query parameter, read without useSearchParams so the page needs no Suspense boundary: the
 * prerendered HTML sees none, and the client picks it up straight after hydration.
 */
export function useSearchParam(name: string) {
  const search = useSyncExternalStore(subscribeToUrl, () => window.location.search, () => "")
  return new URLSearchParams(search).get(name)
}

/** Updates query parameters in place, without a navigation, so a reload or a shared link reopens the same view. */
export function writeParams(next: Record<string, string | null>) {
  const url = new URL(window.location.href)
  for (const [k, v] of Object.entries(next)) {
    if (v === null) url.searchParams.delete(k)
    else url.searchParams.set(k, v)
  }
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`)
}

/** Brings a linked record's row into view once it has rendered (the visible one: table or phone list). */
export function useScrollToRow(key: string | null | undefined) {
  useEffect(() => {
    if (!key) return
    const t = window.setTimeout(() => {
      const els = document.querySelectorAll<HTMLElement>(`[data-row="${CSS.escape(key)}"]`)
      const el = Array.from(els).find((e) => e.offsetParent !== null)
      el?.scrollIntoView({ block: "center", behavior: "smooth" })
    }, 150)
    return () => window.clearTimeout(t)
  }, [key])
}
