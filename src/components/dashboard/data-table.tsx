"use client"

import { Fragment, useEffect, useId, useRef, useState } from "react"
import { AnimatePresence, motion, useIsPresent } from "motion/react"
import { ArrowDownIcon as ArrowDown, ArrowUpIcon as ArrowUp, ArrowsDownUpIcon as ArrowUpDown, CaretLeftIcon as ChevronLeft, CaretRightIcon as ChevronRight, DotsThreeIcon as MoreHorizontal, ArrowCounterClockwiseIcon as RotateCcw, MagnifyingGlassIcon as Search } from "@phosphor-icons/react"
import { Checkbox } from "@/components/ui/checkbox"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Bone } from "@/components/feedback/skeletons"
import { DisabledReason } from "@/components/feedback/info-tip"
import { spring } from "@/lib/motion"
import { cn } from "@/lib/utils"

export type Column<T> = {
  key: string
  header: string
  /** Keep the header for screen readers but don't show it (an actions or thumbnail column). Such a column isn't sortable from its header. */
  srOnly?: boolean
  cell: (row: T) => React.ReactNode
  /** Value used for sorting; omit to make the column unsortable. */
  sortValue?: (row: T) => string | number
  align?: "left" | "right" | "center"
  className?: string
  /** Hide below this viewport breakpoint to keep phones readable. */
  hideBelow?: "sm" | "md" | "lg" | "xl"
  /**
   * Hide while the table itself is narrower than this container size (a container query on the
   * table's own width: 2xl 672px, 3xl 768px, 4xl 896px, 5xl 1024px, 6xl 1152px). Studio and Admin
   * tables sit beside the sidebar, so a wide-only column folds by the room the table actually has,
   * not by the viewport. Use it instead of `hideBelow`, not with it.
   */
  hideBelowContainer?: "2xl" | "3xl" | "4xl" | "5xl" | "6xl"
}

export type RowAction<T> = {
  label: string
  icon?: React.ComponentType<{ className?: string }>
  onSelect: (row: T) => void
  destructive?: boolean
  disabled?: (row: T) => boolean
  /**
   * Why the item is greyed out for this row, shown as a second line under its label. Only read
   * while `disabled` is true. With a reason the item stays reachable by keyboard (announced as
   * unavailable, with the reason) but does nothing when chosen.
   */
  disabledReason?: (row: T) => string | undefined
  /** Leave the item out of this row's menu: for actions that don't apply to the row at all, rather than can't happen yet. */
  hidden?: (row: T) => boolean
  separatorBefore?: boolean
}

export type BulkAction<T> = {
  label: string
  /**
   * Runs on the selected rows it applies to (see `appliesTo`) that the current search shows.
   * Once it settles, those rows leave the selection; selected rows it left out (hidden by the
   * search, or ones it doesn't apply to) stay selected, and the bar closes when none are left.
   * Return `false`, or a promise that resolves to `false`, to keep every row selected, e.g. when
   * the confirm dialog it opened was cancelled. A rejected promise keeps them too.
   */
  onSelect: (rows: T[]) => void | boolean | Promise<void | boolean>
  destructive?: boolean
  /** Which selected rows this action can change. The bar shows how many, and passes only those. */
  appliesTo?: (row: T) => boolean
  /** Why the action is unavailable when it applies to none of the selected rows. */
  disabledReason?: string
}

/**
 * The selection bar's first usable control while the bar stays (rows are still selected after an
 * action), else null. For a dialog a bulk action opened: its focus return can land back in the bar
 * when the button that opened it went away or turned disabled.
 */
export function bulkBarControl(scope: ParentNode | null = document) {
  const bar = scope?.querySelector<HTMLElement>("[data-bulk-bar]:not([data-leaving])")
  return bar?.querySelector<HTMLElement>('button:not(:disabled):not([aria-disabled="true"])') ?? bar?.querySelector<HTMLElement>('[tabindex="0"]') ?? null
}

const hide = { sm: "hidden sm:table-cell", md: "hidden md:table-cell", lg: "hidden lg:table-cell", xl: "hidden xl:table-cell" }
const fold = { "2xl": "hidden @2xl/dt:table-cell", "3xl": "hidden @3xl/dt:table-cell", "4xl": "hidden @4xl/dt:table-cell", "5xl": "hidden @5xl/dt:table-cell", "6xl": "hidden @6xl/dt:table-cell" }
const hideClass = <T,>(c: Column<T>) => (c.hideBelowContainer ? fold[c.hideBelowContainer] : c.hideBelow ? hide[c.hideBelow] : undefined)

/** A row's menu items with hidden ones left out; a hidden item's separator moves to the next item shown. */
function visibleActions<T>(actions: RowAction<T>[], row: T) {
  const out: { a: RowAction<T>; sep: boolean }[] = []
  let sep = false
  for (const a of actions) {
    if (a.separatorBefore) sep = true
    if (a.hidden?.(row)) continue
    out.push({ a, sep: sep && out.length > 0 })
    sep = false
  }
  return out
}

/**
 * The data table used across Studio and Admin: sticky header, sortable columns with
 * indicators, search, bulk selection and actions, row action menus, pagination with page
 * size, and loading / empty / error states. A row is never one giant click target — the
 * primary cell links, actions live in the menu, selection in the checkbox.
 */
export function DataTable<T>({
  rows,
  columns,
  getId,
  search,
  rowActions,
  bulkActions,
  loading = false,
  error,
  onRetry,
  empty,
  pageSizes = [10, 25, 50],
  initialPageSize = 10,
  initialSort,
  density = "comfortable",
  toolbar,
  label,
  minWidth = 720,
  highlightedRowId,
}: {
  rows: T[]
  columns: Column<T>[]
  getId: (row: T) => string
  /** Return the text a row is searched by; enables the search box. */
  search?: { placeholder: string; text: (row: T) => string }
  rowActions?: RowAction<T>[]
  bulkActions?: BulkAction<T>[]
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  empty?: { title: string; body?: string; action?: React.ReactNode }
  pageSizes?: number[]
  initialPageSize?: number
  initialSort?: { key: string; dir: "asc" | "desc" }
  density?: "comfortable" | "dense"
  toolbar?: React.ReactNode
  label: string
  minWidth?: number
  /** A linked record to point out (e.g. the one a callout above the table names): its row is marked, and the table opens on its page once. */
  highlightedRowId?: string | null
}) {
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState(initialSort ?? null)
  const [page, setPage] = useState(0)
  const [size, setSize] = useState(initialPageSize)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [running, setRunning] = useState(false)
  const [jumpedTo, setJumpedTo] = useState<string | null>(null)
  /** Bumped when the selection changes under the bar's controls, so focus that was lost there lands somewhere useful. */
  const [handoff, setHandoff] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const selectAllRef = useRef<HTMLButtonElement>(null)
  const busy = useRef(false)
  const reasonId = useId()

  const q = query.trim().toLowerCase()
  const matches = (r: T) => !q || !search || search.text(r).toLowerCase().includes(q)
  const list = q && search ? rows.filter(matches) : rows
  let filtered = list
  if (sort) {
    const col = columns.find((c) => c.key === sort.key)
    if (col?.sortValue) {
      const sv = col.sortValue
      filtered = [...list].sort((a, b) => {
        const x = sv(a)
        const y = sv(b)
        const r = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))
        return sort.dir === "asc" ? r : -r
      })
    }
  }

  const pages = Math.max(1, Math.ceil(filtered.length / size))
  // Rows went away (a filter, a bulk action): stay on the last page that exists.
  if (page > pages - 1) setPage(pages - 1)
  // A linked record opens on its page, once per record, so it's in view without a hunt.
  if (!highlightedRowId && jumpedTo) setJumpedTo(null)
  if (highlightedRowId && highlightedRowId !== jumpedTo && !loading) {
    const at = filtered.findIndex((r) => getId(r) === highlightedRowId)
    if (at >= 0) {
      setJumpedTo(highlightedRowId)
      setPage(Math.floor(at / size))
    }
  }
  const current = Math.min(page, pages - 1)
  const pageRows = filtered.slice(current * size, current * size + size)
  const selectedRows = rows.filter((r) => selected.has(getId(r)))
  // Bulk actions apply to the selected rows the search shows; the bar says how many it leaves out.
  const actionable = q && search ? selectedRows.filter(matches) : selectedRows
  const hiddenCount = selectedRows.length - actionable.length
  const allOnPage = pageRows.length > 0 && pageRows.every((r) => selected.has(getId(r)))
  const someOnPage = pageRows.some((r) => selected.has(getId(r)))

  function toggleSort(key: string) {
    setSort((s) => (!s || s.key !== key ? { key, dir: "desc" } : s.dir === "desc" ? { key, dir: "asc" } : null))
  }
  function togglePage() {
    const next = new Set(selected)
    if (allOnPage) pageRows.forEach((r) => next.delete(getId(r)))
    else pageRows.forEach((r) => next.add(getId(r)))
    setSelected(next)
  }

  /** Where focus lands when the control that had it goes away: select-all, else the search box. */
  function landFocus() {
    const box = selectAllRef.current
    if (box?.isConnected && !box.disabled) box.focus()
    else searchRef.current?.focus()
  }
  // After the selection changed under the bar (an action ran, or Clear selection), focus that was
  // lost (on <body>, on a control that went away or turned disabled, or inside the bar as it
  // leaves) moves to the bar's first usable control while it stays, else to select-all. A dialog
  // the action opened keeps focus; it hands it back itself when it closes.
  useEffect(() => {
    if (!handoff) return
    const t = window.setTimeout(() => {
      const el = document.activeElement as HTMLElement | null
      const bar = barRef.current
      const leaving = !bar || !bar.isConnected || bar.hasAttribute("data-leaving")
      const lost = !el || el === document.body || !el.isConnected || !!el.closest("[inert]") || el.matches(":disabled") || (leaving && !!bar?.contains(el))
      if (!lost) return
      const inBar = leaving ? null : bulkBarControl(rootRef.current)
      if (inBar) return inBar.focus()
      const box = selectAllRef.current
      if (box?.isConnected && !box.disabled) box.focus()
      else searchRef.current?.focus()
    }, 0)
    return () => window.clearTimeout(t)
  }, [handoff])

  function closeBar() {
    setSelected(new Set())
    setHandoff((n) => n + 1)
  }
  /**
   * An action settled on these rows: they leave the selection. Selected rows it left out stay
   * selected (the bar said they wouldn't be included), so the bar stays for them; when none of
   * the table's rows are left selected, the selection starts clean, as Clear selection does.
   */
  function settle(done: T[]) {
    const ids = new Set(done.map(getId))
    const inTable = new Set(rows.map(getId))
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => !ids.has(id)))
      return [...next].some((id) => inTable.has(id)) ? next : new Set()
    })
    setHandoff((n) => n + 1)
  }
  function runBulk(a: BulkAction<T>, list: T[]) {
    if (busy.current) return
    const result = a.onSelect(list)
    if (result instanceof Promise) {
      busy.current = true
      setRunning(true)
      result
        .then(
          (r) => r !== false && settle(list),
          () => undefined,
        )
        .finally(() => {
          busy.current = false
          setRunning(false)
        })
    } else if (result !== false) settle(list)
  }

  /**
   * The row this menu belonged to left the table (an action moved it out of the view), so its
   * trigger is gone: land on the menu of the row now in its place instead of <body>. While the
   * trigger is still there, focus handling is left to the menu.
   */
  function onMenuClosed(e: Event, id: string, index: number) {
    const root = rootRef.current
    if (!root || root.querySelector(`[data-row-actions="${CSS.escape(id)}"]`)) return
    e.preventDefault()
    const el = document.activeElement
    if (el && el !== document.body && el.isConnected) return // a dialog it opened has focus
    const triggers = root.querySelectorAll<HTMLElement>("[data-row-actions]")
    const next = triggers[Math.min(index, triggers.length - 1)]
    if (next) next.focus()
    else landFocus()
  }

  const cellPad = density === "dense" ? "py-2.5" : "py-3"
  const hasSelect = !!bulkActions?.length
  const span = columns.length + (hasSelect ? 1 : 0) + (rowActions?.length ? 1 : 0)
  // Phones: checkboxes keep their 16px box with a 40px-square hit area.
  const boxHit = "max-sm:after:-inset-y-3"

  return (
    <div ref={rootRef} className={cn("grid gap-3", columns.some((c) => c.hideBelowContainer) && "@container/dt")}>
      {search || toolbar ? (
        <div className="flex flex-wrap items-center gap-2">
          {search ? (
            <label className="relative min-w-56 flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setPage(0)
                }}
                placeholder={search.placeholder}
                aria-label={search.placeholder}
                className="h-9 w-full rounded-md border border-line bg-surface pr-3 pl-9 text-sm text-ink outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-ink-3 hover:border-ink-2/40 focus:border-violet focus:ring-2 focus:ring-violet/25"
              />
            </label>
          ) : null}
          {toolbar}
        </div>
      ) : null}

      <AnimatePresence>
        {hasSelect && selectedRows.length ? (
          <BulkBar
            key="bulk"
            barRef={barRef}
            actions={bulkActions!}
            rows={actionable}
            total={selectedRows.length}
            hiddenCount={hiddenCount}
            running={running}
            onRun={runBulk}
            onClear={closeBar}
            onClearSearch={() => {
              setQuery("")
              searchRef.current?.focus()
            }}
          />
        ) : null}
      </AnimatePresence>

      <div className="overflow-hidden rounded-lg border border-line-soft bg-card">
        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full text-left text-sm" style={{ minWidth }} aria-label={label}>
            <thead className="sticky top-0 z-10 bg-[#111111] text-xs text-ink-3 shadow-[0_1px_0_var(--color-line-soft)]">
              <tr>
                {hasSelect ? (
                  <th scope="col" className="w-10 px-4 py-2.5">
                    <Checkbox ref={selectAllRef} data-select-all="" checked={allOnPage ? true : someOnPage ? "indeterminate" : false} onCheckedChange={togglePage} aria-label="Select all on this page" disabled={loading || !pageRows.length} className={boxHit} />
                  </th>
                ) : null}
                {columns.map((c, i) => {
                  const sortable = !!c.sortValue && !c.srOnly
                  const active = sortable && sort?.key === c.key
                  const Icon = !sortable ? null : active ? (sort!.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown
                  return (
                    <th
                      key={c.key}
                      scope="col"
                      aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined}
                      className={cn("px-3 py-2.5 font-normal whitespace-nowrap", i === 0 && !hasSelect && "pl-4 md:pl-5", c.align === "right" && "text-right", c.align === "center" && "text-center", hideClass(c), c.className)}
                    >
                      {c.srOnly ? (
                        <span className="sr-only">{c.header}</span>
                      ) : sortable ? (
                        <button type="button" onClick={() => toggleSort(c.key)} className={cn("group inline-flex items-center gap-1 rounded transition-colors hover:text-ink", active && "text-ink", c.align === "right" && "flex-row-reverse")}>
                          {c.header}
                          {Icon ? <Icon className={cn("size-3 transition-opacity", active ? "opacity-100" : "opacity-0 group-hover:opacity-70")} /> : null}
                        </button>
                      ) : (
                        c.header
                      )}
                    </th>
                  )
                })}
                {rowActions?.length ? <th scope="col" className="w-12 py-2.5 pr-2 pl-1 sm:px-4"><span className="sr-only">Actions</span></th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {loading ? (
                Array.from({ length: Math.min(size, 8) }, (_, r) => (
                  <tr key={`sk-${r}`}>
                    {hasSelect ? <td className="px-4 py-3.5"><Bone className="size-4" /></td> : null}
                    {columns.map((c, i) => (
                      <td key={c.key} className={cn("px-3 py-3.5", i === 0 && !hasSelect && "pl-4 md:pl-5", hideClass(c))}>
                        <Bone className={cn("h-3.5", i === 0 ? "w-32" : "w-20", c.align === "right" && "ml-auto")} />
                      </td>
                    ))}
                    {rowActions?.length ? <td className="px-4 py-3.5" /> : null}
                  </tr>
                ))
              ) : error ? (
                <tr>
                  <td colSpan={span} className="px-6 py-14 text-center">
                    <p className="text-sm text-ink">{error}</p>
                    {onRetry ? (
                      <button type="button" onClick={onRetry} className="mt-3 inline-flex items-center gap-1.5 text-sm text-ink-2 hover:text-ink">
                        <RotateCcw className="size-3.5" /> Try again
                      </button>
                    ) : null}
                  </td>
                </tr>
              ) : pageRows.length === 0 ? (
                <tr>
                  <td colSpan={span} className="px-6 py-14 text-center">
                    <p className="text-sm text-ink">{query ? `Nothing matches “${query}”` : empty?.title ?? "Nothing here yet"}</p>
                    {!query && empty?.body ? <p className="mx-auto mt-1 max-w-sm text-sm text-ink-2">{empty.body}</p> : null}
                    {query ? (
                      <button type="button" onClick={() => setQuery("")} className="mt-3 text-sm text-violet hover:underline">Clear search</button>
                    ) : empty?.action ? (
                      <div className="mt-4 flex justify-center">{empty.action}</div>
                    ) : null}
                  </td>
                </tr>
              ) : (
                pageRows.map((row, index) => {
                  const id = getId(row)
                  const isSel = selected.has(id)
                  const lit = highlightedRowId != null && id === highlightedRowId
                  const items = rowActions?.length ? visibleActions(rowActions, row) : []
                  return (
                    <tr
                      key={id}
                      data-state={isSel ? "selected" : undefined}
                      data-highlighted={lit ? "" : undefined}
                      className={cn("transition-colors duration-150 hover:bg-white/[0.025]", lit && "bg-purple/[0.07] shadow-[inset_2px_0_0_var(--color-violet)]", isSel && "bg-purple/10 hover:bg-purple/14")}
                    >
                      {hasSelect ? (
                        <td className={cn("px-4", cellPad)}>
                          <Checkbox
                            checked={isSel}
                            onCheckedChange={() => {
                              const next = new Set(selected)
                              if (isSel) next.delete(id)
                              else next.add(id)
                              setSelected(next)
                            }}
                            aria-label="Select row"
                            className={boxHit}
                          />
                        </td>
                      ) : null}
                      {columns.map((c, i) => (
                        <td key={c.key} className={cn("px-3", cellPad, i === 0 && !hasSelect && "pl-4 md:pl-5", c.align === "right" && "text-right tabular", c.align === "center" && "text-center", hideClass(c), c.className)}>
                          {c.cell(row)}
                        </td>
                      ))}
                      {rowActions?.length ? (
                        <td className={cn("pr-2 pl-1 text-right sm:px-4", cellPad)}>
                          {items.length ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button type="button" data-row-actions={id} aria-label="Row actions" className="inline-flex size-10 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-white/6 hover:text-ink data-[state=open]:bg-white/8 data-[state=open]:text-ink sm:size-8">
                                  <MoreHorizontal className="size-4" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className={cn("min-w-44", items.some(({ a }) => a.disabledReason && a.disabled?.(row)) && "min-w-56")} onCloseAutoFocus={(e) => onMenuClosed(e, id, index)}>
                                {items.map(({ a, sep }, k) => {
                                  const off = !!a.disabled?.(row)
                                  const reason = off ? a.disabledReason?.(row) : undefined
                                  const rid = reason ? `${reasonId}-${index}-${k}` : undefined
                                  return (
                                    <Fragment key={a.label}>
                                      {sep ? <DropdownMenuSeparator /> : null}
                                      <DropdownMenuItem
                                        onSelect={(e) => {
                                          // Unavailable with a reason: stays focusable so the reason is read, but does nothing.
                                          if (off) return e.preventDefault()
                                          a.onSelect(row)
                                        }}
                                        disabled={off && !reason}
                                        aria-disabled={reason ? true : undefined}
                                        aria-describedby={rid}
                                        variant={a.destructive && !reason ? "destructive" : "default"}
                                        className={cn("gap-2", reason && "items-start aria-disabled:cursor-not-allowed aria-disabled:focus:bg-white/[0.05]")}
                                      >
                                        {a.icon ? <a.icon className={cn("size-4", reason && "mt-0.5 opacity-50")} /> : null}
                                        {reason ? (
                                          <span className="grid min-w-0 gap-0.5">
                                            <span className="opacity-50">{a.label}</span>
                                            <span id={rid} className="max-w-60 text-[11.5px] leading-snug text-ink-3">{reason}</span>
                                          </span>
                                        ) : (
                                          a.label
                                        )}
                                      </DropdownMenuItem>
                                    </Fragment>
                                  )
                                })}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-soft px-4 py-2.5 text-xs text-ink-2">
          <span className="tabular">
            {loading ? "Loading…" : filtered.length ? `${current * size + 1}–${Math.min(filtered.length, current * size + size)} of ${filtered.length}` : "0 results"}
          </span>
          <div className="flex items-center gap-3">
            <label className="hidden items-center gap-2 sm:flex">
              Rows
              <Select
                value={String(size)}
                onValueChange={(v) => {
                  setSize(Number(v))
                  setPage(0)
                }}
              >
                <SelectTrigger size="sm" className="h-7 w-[70px] text-xs" aria-label="Rows per page">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {pageSizes.map((n) => (
                    <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <span className="tabular">Page {current + 1} of {pages}</span>
            <div className="flex gap-1">
              <button type="button" onClick={() => setPage(Math.max(0, current - 1))} disabled={current === 0 || loading} aria-label="Previous page" className="inline-flex size-10 items-center justify-center rounded-md border border-line text-ink transition-colors hover:bg-white/5 disabled:opacity-30 sm:size-7">
                <ChevronLeft className="size-3.5" />
              </button>
              <button type="button" onClick={() => setPage(Math.min(pages - 1, current + 1))} disabled={current >= pages - 1 || loading} aria-label="Next page" className="inline-flex size-10 items-center justify-center rounded-md border border-line text-ink transition-colors hover:bg-white/5 disabled:opacity-30 sm:size-7">
                <ChevronRight className="size-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * What the selection can do. Counts the selected rows the search shows, says how many it
 * hides (they're left out), and gives each action the number of rows it applies to; an action
 * that applies to none is disabled with its reason.
 */
function BulkBar<T>({
  barRef,
  actions,
  rows,
  total,
  hiddenCount,
  running,
  onRun,
  onClear,
  onClearSearch,
}: {
  barRef: React.RefObject<HTMLDivElement | null>
  actions: BulkAction<T>[]
  rows: T[]
  total: number
  hiddenCount: number
  running: boolean
  onRun: (a: BulkAction<T>, rows: T[]) => void
  onClear: () => void
  onClearSearch: () => void
}) {
  // Leaving: the bar can't be used while it animates out, and focus return skips it.
  const present = useIsPresent()
  const shown = rows.length
  const btn = "inline-flex h-10 items-center gap-1.5 rounded-md px-3 text-[12.5px] transition-[background-color,color,transform,opacity] duration-150 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40 aria-disabled:cursor-progress aria-disabled:opacity-60 sm:h-7 sm:px-2.5"
  return (
    <motion.div
      ref={barRef}
      data-bulk-bar=""
      data-leaving={present ? undefined : ""}
      inert={!present}
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={spring.snappy}
      className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-purple/60 bg-purple/12 px-3 py-2 text-sm"
    >
      {/*
        DOM order is reading order at every width, so Tab never jumps back up the bar. Phones:
        the count on the first line, the search note on the next, then the actions with Clear
        selection at the end of their line. Wider: one line, Clear selection at the far end.
      */}
      <span className="text-ink tabular max-sm:basis-full">{shown ? `${shown} selected` : `${total} selected`}</span>
      {hiddenCount ? (
        <span className="flex flex-wrap items-center gap-x-2 text-xs text-ink-2 max-sm:basis-full">
          <span>{shown ? `${hiddenCount} more ${hiddenCount === 1 ? "is" : "are"} hidden by your search and won't be included.` : `Your search hides ${total === 1 ? "the selected row" : total === 2 ? "both selected rows" : `all ${total} selected rows`}. Clear it to act on ${total === 1 ? "it" : "them"}.`}</span>
          <button type="button" onClick={onClearSearch} className="inline-flex h-10 items-center text-violet hover:underline sm:h-auto">
            Clear search
          </button>
        </span>
      ) : null}
      <span className="mx-1 hidden h-4 w-px bg-white/15 sm:block" aria-hidden />
      <span className="flex flex-wrap items-center gap-1">
        {actions.map((a) => {
          const applicable = a.appliesTo ? rows.filter(a.appliesTo) : rows
          const n = applicable.length
          const partial = n > 0 && n < shown
          const button = (
            <button
              type="button"
              disabled={n === 0}
              aria-disabled={running || undefined}
              onClick={() => onRun(a, applicable)}
              className={cn(btn, a.destructive ? "text-danger hover:bg-danger/12" : "text-ink hover:bg-white/8")}
            >
              {a.label}
              {partial ? (
                <span className="text-ink-3 tabular">
                  {n} of {shown}
                </span>
              ) : null}
            </button>
          )
          if (n > 0) return <Fragment key={a.label}>{button}</Fragment>
          const reason = shown ? (a.disabledReason ?? "None of the selected rows can take this action.") : "Clear the search to act on the selected rows."
          return (
            <DisabledReason key={a.label} reason={reason}>
              {button}
            </DisabledReason>
          )
        })}
      </span>
      <button type="button" onClick={onClear} className={cn(btn, "ml-auto text-ink-2 hover:text-ink")}>
        Clear selection
      </button>
    </motion.div>
  )
}
