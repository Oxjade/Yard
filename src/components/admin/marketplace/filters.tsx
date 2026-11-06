"use client"

import { useState } from "react"
import { FunnelSimpleIcon } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

export type FilterOption = { value: string; label: string }
export type Filter = {
  key: string
  label: string
  value: string
  onChange: (v: string) => void
  /** The "everything" option, listed first and kept apart from the rest. */
  all: FilterOption
  options?: FilterOption[]
  groups?: { label: string; options: FilterOption[] }[]
  /** Trigger width from tablet up. */
  width?: string
}

function FilterSelect({ f, id, className }: { f: Filter; id?: string; className?: string }) {
  return (
    <Select value={f.value} onValueChange={f.onChange}>
      <SelectTrigger id={id} aria-label={id ? undefined : f.label} className={cn("h-9 rounded-md border-line bg-surface text-[13px] data-[size=default]:h-9 dark:bg-surface", f.value !== f.all.value && "border-violet/50", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" align="end">
        <SelectItem value={f.all.value}>{f.all.label}</SelectItem>
        <SelectSeparator />
        {f.options?.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
        {f.groups?.map((g, i) => (
          <SelectGroup key={g.label}>
            {i > 0 ? <SelectSeparator /> : null}
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

/**
 * Table filters: menus beside the search from tablet up; on phones one "Filters" button
 * (with how many are set) that opens them as a bottom sheet, so the toolbar stays one row
 * and every choice gets a full-width, thumb-sized control.
 */
export function Filters({ filters, results, noun, onClear }: { filters: Filter[]; results: number; noun: string; onClear: () => void }) {
  const [open, setOpen] = useState(false)
  const active = filters.filter((f) => f.value !== f.all.value).length
  return (
    <>
      <div className="hidden flex-wrap items-center gap-2 md:flex">
        {filters.map((f) => (
          <FilterSelect key={f.key} f={f} className={f.width ?? "w-[168px]"} />
        ))}
        {active ? (
          <Button type="button" variant="ghost" size="sm" className="h-9" onClick={onClear}>
            Clear filters
          </Button>
        ) : null}
      </div>
      {/* The button is the sheet's trigger, so closing it (Escape, outside, "Show N") hands focus back here. */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button type="button" variant="secondary" className="h-10 md:hidden">
            <FunnelSimpleIcon weight={active ? "fill" : "regular"} className={active ? "text-violet" : undefined} />
            Filters
            {active ? <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-purple px-1.5 text-[11px] tabular">{active}</span> : null}
          </Button>
        </SheetTrigger>
        <SheetContent side="bottom" className="gap-0 rounded-t-2xl border-white/10 bg-[#0c0c0c] pb-[env(safe-area-inset-bottom)]">
          <SheetHeader className="px-4 pt-4 pb-2">
            <SheetTitle className="font-label text-[15px] text-ink">Filter {noun}</SheetTitle>
            <SheetDescription className="text-[12px] text-ink-2">Changes apply straight away.</SheetDescription>
          </SheetHeader>
          <div className="grid gap-4 px-4 py-3">
            {filters.map((f) => (
              <div key={f.key} className="grid gap-1.5">
                <Label htmlFor={`filter-${f.key}`} className="text-[13px]">{f.label}</Label>
                <FilterSelect f={f} id={`filter-${f.key}`} className="h-11 w-full data-[size=default]:h-11" />
              </div>
            ))}
          </div>
          <SheetFooter className="flex-row gap-2 border-t border-white/[0.07] px-4 py-3">
            <Button type="button" variant="ghost" className="h-11 flex-1" onClick={onClear} disabled={!active}>
              Clear
            </Button>
            <Button type="button" variant="secondary" className="h-11 flex-[2]" onClick={() => setOpen(false)}>
              Show {results} {results === 1 ? noun.replace(/s$/, "") : noun}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  )
}
