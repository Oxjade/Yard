"use client"

import Image from "next/image"
import { CaretLeftIcon as ChevronLeft, CaretRightIcon as ChevronRight, ImageBrokenIcon as ImageOff, MagnifyingGlassIcon as Search, XIcon as X } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { initials } from "./format"

export type Column<T> = {
  key: string
  header: string
  cell: (row: T) => React.ReactNode
  className?: string
  align?: "left" | "right"
  /** The column that names the row; it carries the keyboard-focusable button that opens the detail. */
  primary?: boolean
}

/**
 * The Admin index table: a dense table from tablet width up, a stacked list on phones.
 * Rows open a detail view; nothing is edited inline.
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  onOpen,
  openLabel,
  mobileRow,
  minWidth = 860,
  caption,
  selectedKey,
}: {
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string
  onOpen?: (row: T) => void
  /** Accessible name for the open button, e.g. (b) => `Review ${b.brandName}`. */
  openLabel?: (row: T) => string
  mobileRow: (row: T) => { title: React.ReactNode; meta?: React.ReactNode; lead?: React.ReactNode; trail?: React.ReactNode }
  minWidth?: number
  caption: string
  selectedKey?: string | null
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
                  onClick={onOpen ? () => onOpen(row) : undefined}
                  className={cn("transition-colors", onOpen && "cursor-pointer hover:bg-white/[0.025]", selectedKey === k && "bg-purple/[0.06]")}
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
        </table>
      </div>

      <ul className="divide-y divide-line-soft md:hidden" aria-label={caption}>
        {rows.map((row) => {
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
            <li key={rowKey(row)}>
              {onOpen ? (
                <button type="button" onClick={() => onOpen(row)} aria-label={openLabel?.(row)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors active:bg-white/[0.03]">
                  {inner}
                </button>
              ) : (
                <div className="flex items-center gap-3 px-4 py-2.5">{inner}</div>
              )}
            </li>
          )
        })}
      </ul>
    </>
  )
}

/** Initials in a neutral tile: brands without an uploaded logo, and shopper accounts. */
export function Initials({ name, round = false, size = "sm" }: { name: string; round?: boolean; size?: "sm" | "lg" }) {
  return (
    <span aria-hidden className={cn("inline-flex shrink-0 items-center justify-center border border-white/10 bg-elevated font-semibold text-ink-2", round ? "rounded-full" : "rounded-md", size === "lg" ? "size-11 text-[13px]" : "size-7 text-[10px]")}>
      {initials(name) || "?"}
    </span>
  )
}

export function Thumb({ src, size = "sm" }: { src?: string; size?: "sm" | "lg" }) {
  return (
    <span className={cn("relative shrink-0 overflow-hidden rounded-md border border-white/8 bg-surface", size === "lg" ? "h-24 w-20" : "h-9 w-7")}>
      {src ? <Image src={src} alt="" fill sizes={size === "lg" ? "80px" : "28px"} className="object-cover" /> : <ImageOff className="absolute inset-0 m-auto size-3.5 text-ink-3" aria-hidden />}
    </span>
  )
}

export function SearchField({ value, onChange, placeholder, label, className }: { value: string; onChange: (v: string) => void; placeholder: string; label: string; className?: string }) {
  return (
    <label className={cn("relative block w-full md:w-72", className)}>
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
