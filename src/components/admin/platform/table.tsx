"use client"

import { CaretLeftIcon as ChevronLeft, CaretRightIcon as ChevronRight, MagnifyingGlassIcon as Search, XIcon as X } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { initials } from "./format"

export type Column<T> = {
  key: string
  header: string
  cell: (row: T) => React.ReactNode
  className?: string
  align?: "left" | "right"
}

export type MobileRow = { title: React.ReactNode; meta?: React.ReactNode; lead?: React.ReactNode; trail?: React.ReactNode; below?: React.ReactNode }

/**
 * A dense, read-mostly table from tablet width up and a stacked list on phones. Records are
 * never edited inline; the only controls in a row are the decisions that row allows.
 */
export function PlatformTable<T>({
  rows,
  columns,
  rowKey,
  mobileRow,
  caption,
  minWidth = 860,
  rowClassName,
}: {
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string
  mobileRow: (row: T) => MobileRow
  caption: string
  minWidth?: number
  rowClassName?: (row: T) => string | false | undefined
}) {
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-[13px]" style={{ minWidth }}>
          <caption className="sr-only">{caption}</caption>
          <thead className="border-y border-line-soft bg-surface/60 text-[11px] text-ink-3">
            <tr>
              {columns.map((c, i) => (
                <th key={c.key} scope="col" className={cn("px-3 py-2.5 font-normal whitespace-nowrap", i === 0 && "pl-4", i === columns.length - 1 && "pr-4", c.align === "right" && "text-right", c.className)}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {rows.map((row) => (
              <tr key={rowKey(row)} className={cn("transition-colors hover:bg-white/[0.02]", rowClassName?.(row))}>
                {columns.map((c, i) => (
                  <td key={c.key} className={cn("px-3 py-2.5 align-middle", i === 0 && "pl-4", i === columns.length - 1 && "pr-4", c.align === "right" && "text-right tabular", c.className)}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-line-soft border-t border-line-soft md:hidden" aria-label={caption}>
        {rows.map((row) => {
          const m = mobileRow(row)
          return (
            <li key={rowKey(row)} className={cn("px-4 py-2.5", rowClassName?.(row))}>
              <div className="flex items-center gap-3">
                {m.lead}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] text-ink">{m.title}</div>
                  {m.meta ? <div className="mt-0.5 truncate text-[11px] text-ink-3">{m.meta}</div> : null}
                </div>
                {m.trail ? <div className="flex shrink-0 flex-col items-end gap-1">{m.trail}</div> : null}
              </div>
              {m.below ? <div className="mt-2">{m.below}</div> : null}
            </li>
          )
        })}
      </ul>
    </>
  )
}

/** Initials in a neutral tile, for admin team members. */
export function Initials({ name, className }: { name: string; className?: string }) {
  return (
    <span aria-hidden className={cn("inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-white/10 bg-elevated text-[10px] font-semibold text-ink-2", className)}>
      {initials(name) || "?"}
    </span>
  )
}

export type FilterOption = { value: string; label: string }

export function FilterSelect({ value, onChange, label, options, groups, className }: { value: string; onChange: (v: string) => void; label: string; options?: FilterOption[]; groups?: { label: string; options: FilterOption[] }[]; className?: string }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className={cn("h-8 w-full shrink-0 rounded-md border-line bg-surface text-[13px] md:w-[180px] dark:bg-surface", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" align="end">
        {options?.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
        {groups?.map((g) => (
          <SelectGroup key={g.label}>
            <SelectLabel className="text-[11px] text-ink-3">{g.label}</SelectLabel>
            {g.options.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
}

export function SearchField({ value, onChange, placeholder, label, className }: { value: string; onChange: (v: string) => void; placeholder: string; label: string; className?: string }) {
  return (
    <label className={cn("relative block w-full md:w-64", className)}>
      <span className="sr-only">{label}</span>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 w-full rounded-md border border-line bg-surface pr-8 pl-8 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-violet [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button type="button" onClick={() => onChange("")} className="absolute top-1/2 right-1.5 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded-sm text-ink-3 hover:text-ink" aria-label="Clear search">
          <X className="size-3.5" />
        </button>
      ) : null}
    </label>
  )
}

export function Pagination({ page, pageSize, total, onPage, noun }: { page: number; pageSize: number; total: number; onPage: (p: number) => void; noun: string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (total <= pageSize) return null
  const from = page * pageSize + 1
  const to = Math.min(total, (page + 1) * pageSize)
  return (
    <nav aria-label={`${noun} pages`} className="flex items-center justify-between gap-3 border-t border-line-soft px-4 py-2.5">
      <p className="text-[11px] text-ink-3 tabular">
        {from}–{to} of {total} {noun}
      </p>
      <div className="flex items-center gap-1.5">
        <Button type="button" variant="secondary" size="icon-xs" onClick={() => onPage(page - 1)} disabled={page === 0} aria-label="Previous page">
          <ChevronLeft />
        </Button>
        <span className="min-w-12 text-center text-[11px] text-ink-2 tabular">
          {page + 1} / {pages}
        </span>
        <Button type="button" variant="secondary" size="icon-xs" onClick={() => onPage(page + 1)} disabled={page >= pages - 1} aria-label="Next page">
          <ChevronRight />
        </Button>
      </div>
    </nav>
  )
}
