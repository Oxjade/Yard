"use client"

import { useRef, useSyncExternalStore } from "react"
import Link from "next/link"
import { ArrowsDownUpIcon as SortIcon, CaretLeftIcon as ChevronLeft } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useStudio } from "@/lib/stores/studio"
import { cn } from "@/lib/utils"

/**
 * Small pieces only the Studio business pages (orders, customers, analytics, settings) use.
 * Panel, Field, the field wiring and Thumb come from the catalog pieces every Studio page shares;
 * the rules live in ./model.ts.
 */

/**
 * The first cell of a DataTable on phones, where it is the only column besides the checkbox
 * and the row menu. It takes the width those leave (viewport minus the page gutters, the two
 * narrow columns and cell padding), so the table never scrolls sideways at 390px.
 */
export const phoneCell = "block w-[calc(100vw-11rem)] max-w-[18rem] md:w-auto md:max-w-none"

/** The same for tables without a checkbox column. */
export const phoneCellWide = "block w-[calc(100vw-8rem)] max-w-[20rem] md:w-auto md:max-w-none"

/** True once the Studio store has loaded what this browser saved; until then pages show skeletons. */
export function useStudioReady() {
  return useSyncExternalStore(
    (cb) => useStudio.persist.onFinishHydration(cb),
    () => useStudio.persist.hasHydrated(),
    () => false,
  )
}

/**
 * Puts focus back where it was when a dialog or sheet opened. Radix only returns focus to a
 * DialogTrigger; these dialogs open from state (row menus, page buttons), so without this
 * focus lands on <body> after Escape. Spread the result on DialogContent or SheetContent.
 * `fallback` is used when the opener has gone (a row menu item, a button the action removed).
 */
export function useFocusReturn(fallback?: () => HTMLElement | null | undefined) {
  const opener = useRef<HTMLElement | null>(null)
  // A fresh pair each render, so the close handler always sees the latest fallback.
  return {
    onOpenAutoFocus: (e: Event) => {
      // Runs before Radix moves focus into the dialog, so this is still the control that opened
      // it (unless something inside already took focus, which is not an opener).
      const el = document.activeElement
      const inside = e.target instanceof Node && el instanceof Node && e.target.contains(el)
      opener.current = el instanceof HTMLElement && el !== document.body && !inside ? el : null
    },
    onCloseAutoFocus: (e: Event) => {
      const el = opener.current?.isConnected && !opener.current.closest("[role=menu]") ? opener.current : fallback?.()
      opener.current = null
      if (!el) return
      e.preventDefault()
      el.focus({ preventScroll: true })
    },
  }
}

/** Initials in a circle; Studio never shows shoppers' photos. */
export function Initials({ name, className }: { name: string; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("")
  return (
    <span aria-hidden className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-[11px] font-medium text-ink-2", className)}>
      {initials}
    </span>
  )
}

export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex w-fit items-center gap-1 text-xs text-ink-2 hover:text-ink">
      <ChevronLeft className="size-3.5" /> {children}
    </Link>
  )
}

/** A label/value list used in side panels. */
export function DefinitionList({ items, className }: { items: { label: string; value: React.ReactNode }[]; className?: string }) {
  return (
    <dl className={cn("grid gap-2.5 text-sm", className)}>
      {items.map((it) => (
        <div key={it.label} className="grid grid-cols-[7.5rem_1fr] gap-3">
          <dt className="text-ink-2">{it.label}</dt>
          <dd className="min-w-0 text-ink">{it.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Horizontal bar used by the funnel, locations and best sellers. Width is a 0–1 share. */
export function ShareBar({ share, tone = "purple", className }: { share: number; tone?: "purple" | "muted" | "acid"; className?: string }) {
  const pct = Math.max(0, Math.min(1, share)) * 100
  return (
    <span className={cn("block h-2 w-full overflow-hidden rounded-full bg-white/[0.05]", className)} aria-hidden>
      <span
        className={cn("block h-full origin-left rounded-full transition-[width] duration-500 ease-out-quint", tone === "purple" ? "bg-purple" : tone === "acid" ? "bg-acid" : "bg-ink-3/60")}
        style={{ width: `${pct}%` }}
      />
    </span>
  )
}

/**
 * Sorting for phones, where a DataTable shows only its first column and the sortable headers
 * are hidden. The page sorts its rows by this choice; on wider screens the headers take over.
 * The 36px button has a 40px tap area.
 */
export function PhoneSort<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; className?: string }) {
  const current = options.find((o) => o.value === value)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="secondary" size="sm" className={cn("h-9 after:absolute after:inset-x-0 after:-inset-y-0.5 md:hidden", className)} aria-label={`Sort: ${current?.label ?? ""}`}>
          <SortIcon className="text-ink-3" /> {current?.label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuLabel className="text-xs text-ink-3">Sort by</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as T)}>
          {options.map((o) => (
            <DropdownMenuRadioItem key={o.value} value={o.value}>
              {o.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
