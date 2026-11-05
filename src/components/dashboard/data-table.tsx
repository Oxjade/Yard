"use client"

import { useEffect, useMemo, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { ArrowDownIcon as ArrowDown, ArrowUpIcon as ArrowUp, ArrowsDownUpIcon as ArrowUpDown, CaretLeftIcon as ChevronLeft, CaretRightIcon as ChevronRight, DotsThreeIcon as MoreHorizontal, ArrowCounterClockwiseIcon as RotateCcw, MagnifyingGlassIcon as Search } from "@phosphor-icons/react"
import { Checkbox } from "@/components/ui/checkbox"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Bone } from "@/components/feedback/skeletons"
import { spring } from "@/lib/motion"
import { cn } from "@/lib/utils"

export type Column<T> = {
  key: string
  header: string
  cell: (row: T) => React.ReactNode
  /** Value used for sorting; omit to make the column unsortable. */
  sortValue?: (row: T) => string | number
  align?: "left" | "right" | "center"
  className?: string
  /** Hide below this breakpoint to keep phones readable. */
  hideBelow?: "sm" | "md" | "lg"
}

export type RowAction<T> = {
  label: string
  icon?: React.ComponentType<{ className?: string }>
  onSelect: (row: T) => void
  destructive?: boolean
  disabled?: (row: T) => boolean
  separatorBefore?: boolean
}

export type BulkAction<T> = { label: string; onSelect: (rows: T[]) => void; destructive?: boolean }

const hide = { sm: "hidden sm:table-cell", md: "hidden md:table-cell", lg: "hidden lg:table-cell" }

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
}) {
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState(initialSort ?? null)
  const [page, setPage] = useState(0)
  const [size, setSize] = useState(initialPageSize)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = q && search ? rows.filter((r) => search.text(r).toLowerCase().includes(q)) : rows
    if (sort) {
      const col = columns.find((c) => c.key === sort.key)
      if (col?.sortValue) {
        const sv = col.sortValue
        list = [...list].sort((a, b) => {
          const x = sv(a)
          const y = sv(b)
          const r = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))
          return sort.dir === "asc" ? r : -r
        })
      }
    }
    return list
  }, [rows, query, sort, columns, search])

  const pages = Math.max(1, Math.ceil(filtered.length / size))
  useEffect(() => {
    if (page > pages - 1) setPage(pages - 1)
  }, [page, pages])
  const pageRows = filtered.slice(page * size, page * size + size)
  const selectedRows = rows.filter((r) => selected.has(getId(r)))
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
  const cellPad = density === "dense" ? "py-2.5" : "py-3"
  const hasSelect = !!bulkActions?.length

  return (
    <div className="grid gap-3">
      {search || toolbar ? (
        <div className="flex flex-wrap items-center gap-2">
          {search ? (
            <label className="relative min-w-56 flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
              <input
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
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={spring.snappy} className="flex flex-wrap items-center gap-2 rounded-lg border border-purple/60 bg-purple/12 px-3 py-2 text-sm">
            <span className="text-ink tabular">{selectedRows.length} selected</span>
            <span className="mx-1 h-4 w-px bg-white/15" aria-hidden />
            {bulkActions!.map((a) => (
              <button
                key={a.label}
                type="button"
                onClick={() => {
                  a.onSelect(selectedRows)
                  setSelected(new Set())
                }}
                className={cn("h-7 rounded-md px-2.5 text-[12.5px] transition-colors", a.destructive ? "text-danger hover:bg-danger/12" : "text-ink hover:bg-white/8")}
              >
                {a.label}
              </button>
            ))}
            <button type="button" onClick={() => setSelected(new Set())} className="ml-auto h-7 rounded-md px-2.5 text-[12.5px] text-ink-2 hover:text-ink">
              Clear
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="overflow-hidden rounded-lg border border-line-soft bg-card">
        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full text-left text-sm" style={{ minWidth }} aria-label={label}>
            <thead className="sticky top-0 z-10 bg-[#111111] text-xs text-ink-3 shadow-[0_1px_0_var(--color-line-soft)]">
              <tr>
                {hasSelect ? (
                  <th scope="col" className="w-10 px-4 py-2.5">
                    <Checkbox checked={allOnPage ? true : someOnPage ? "indeterminate" : false} onCheckedChange={togglePage} aria-label="Select all on this page" disabled={loading || !pageRows.length} />
                  </th>
                ) : null}
                {columns.map((c, i) => {
                  const active = sort?.key === c.key
                  const Icon = !c.sortValue ? null : active ? (sort!.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown
                  return (
                    <th
                      key={c.key}
                      scope="col"
                      aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined}
                      className={cn("px-3 py-2.5 font-normal whitespace-nowrap", i === 0 && !hasSelect && "pl-4 md:pl-5", c.align === "right" && "text-right", c.align === "center" && "text-center", c.hideBelow && hide[c.hideBelow], c.className)}
                    >
                      {c.sortValue ? (
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
                {rowActions?.length ? <th scope="col" className="w-12 px-4 py-2.5"><span className="sr-only">Actions</span></th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {loading ? (
                Array.from({ length: Math.min(size, 8) }, (_, r) => (
                  <tr key={`sk-${r}`}>
                    {hasSelect ? <td className="px-4 py-3.5"><Bone className="size-4" /></td> : null}
                    {columns.map((c, i) => (
                      <td key={c.key} className={cn("px-3 py-3.5", i === 0 && !hasSelect && "pl-4 md:pl-5", c.hideBelow && hide[c.hideBelow])}>
                        <Bone className={cn("h-3.5", i === 0 ? "w-32" : "w-20", c.align === "right" && "ml-auto")} />
                      </td>
                    ))}
                    {rowActions?.length ? <td className="px-4 py-3.5" /> : null}
                  </tr>
                ))
              ) : error ? (
                <tr>
                  <td colSpan={columns.length + (hasSelect ? 1 : 0) + (rowActions?.length ? 1 : 0)} className="px-6 py-14 text-center">
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
                  <td colSpan={columns.length + (hasSelect ? 1 : 0) + (rowActions?.length ? 1 : 0)} className="px-6 py-14 text-center">
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
                pageRows.map((row) => {
                  const id = getId(row)
                  const isSel = selected.has(id)
                  return (
                    <tr key={id} data-state={isSel ? "selected" : undefined} className={cn("transition-colors duration-150 hover:bg-white/[0.025]", isSel && "bg-purple/10 hover:bg-purple/14")}>
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
                          />
                        </td>
                      ) : null}
                      {columns.map((c, i) => (
                        <td key={c.key} className={cn("px-3", cellPad, i === 0 && !hasSelect && "pl-4 md:pl-5", c.align === "right" && "text-right tabular", c.align === "center" && "text-center", c.hideBelow && hide[c.hideBelow], c.className)}>
                          {c.cell(row)}
                        </td>
                      ))}
                      {rowActions?.length ? (
                        <td className={cn("px-4 text-right", cellPad)}>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button type="button" aria-label="Row actions" className="inline-flex size-8 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-white/6 hover:text-ink data-[state=open]:bg-white/8 data-[state=open]:text-ink">
                                <MoreHorizontal className="size-4" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="min-w-44">
                              {rowActions.map((a) => (
                                <div key={a.label}>
                                  {a.separatorBefore ? <DropdownMenuSeparator /> : null}
                                  <DropdownMenuItem onSelect={() => a.onSelect(row)} disabled={a.disabled?.(row)} variant={a.destructive ? "destructive" : "default"} className="gap-2">
                                    {a.icon ? <a.icon className="size-4" /> : null}
                                    {a.label}
                                  </DropdownMenuItem>
                                </div>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
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
            {loading ? "Loading…" : filtered.length ? `${page * size + 1}–${Math.min(filtered.length, page * size + size)} of ${filtered.length}` : "0 results"}
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
            <span className="tabular">Page {page + 1} of {pages}</span>
            <div className="flex gap-1">
              <button type="button" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0 || loading} aria-label="Previous page" className="inline-flex size-7 items-center justify-center rounded-md border border-line text-ink transition-colors hover:bg-white/5 disabled:opacity-30">
                <ChevronLeft className="size-3.5" />
              </button>
              <button type="button" onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1 || loading} aria-label="Next page" className="inline-flex size-7 items-center justify-center rounded-md border border-line text-ink transition-colors hover:bg-white/5 disabled:opacity-30">
                <ChevronRight className="size-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
