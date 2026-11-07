"use client"

import { useId } from "react"
import { SlidersHorizontalIcon } from "@phosphor-icons/react"
import { categories } from "@/lib/data/catalog"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { activeCount, DISTANCES, emptyFilters, KIND_KEYS, kindFilterLabel, type Distance, type Filters, type KindKey } from "./filters-model"

export const DISTANCE_REASON = "Share your location or pick an area to filter by distance."

/** A pressable chip: purple only while it's on. 40 px tall on phones. */
export function Chip({ on, disabled, onClick, children, title, className }: { on: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode; title?: string; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={cn(
        "inline-flex h-10 shrink-0 items-center rounded-full border px-3.5 text-[13px] whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-violet disabled:cursor-not-allowed disabled:opacity-40 lg:h-8 lg:px-3 lg:text-xs",
        on ? "border-purple bg-purple text-ink" : "border-white/12 text-ink hover:border-white/25 hover:bg-white/[0.05]",
        className,
      )}
    >
      {children}
    </button>
  )
}

/** The quick kind chips at the top of the panel and the list. */
export function KindChips({ kinds, onToggle, className }: { kinds: KindKey[]; onToggle: (k: KindKey) => void; className?: string }) {
  return (
    // Phones scroll the row sideways; from lg it wraps, so "Drops & offers" is never clipped
    // off the 400 px panel with no sign it's there.
    <div role="group" aria-label="Kind of place" className={cn("-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] lg:flex-wrap lg:overflow-visible", className)}>
      {KIND_KEYS.map((k) => (
        <Chip key={k} on={kinds.includes(k)} onClick={() => onToggle(k)}>
          {kindFilterLabel[k]}
        </Chip>
      ))}
    </div>
  )
}

function FiltersBody({ filters, onChange, distanceEnabled }: { filters: Filters; onChange: (f: Filters) => void; distanceEnabled: boolean }) {
  const uid = useId()
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])
  return (
    <div className="grid gap-5">
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-[13px] font-medium text-ink">Kind</legend>
        <div className="flex flex-wrap gap-1.5">
          {KIND_KEYS.map((k) => (
            <Chip key={k} on={filters.kinds.includes(k)} onClick={() => onChange({ ...filters, kinds: toggle(filters.kinds, k) })}>
              {kindFilterLabel[k]}
            </Chip>
          ))}
        </div>
      </fieldset>
      {/* Distance sits right under Kind, with its reason before the chips, so a shopper never meets
          greyed-out chips without the sentence that says why. */}
      <fieldset className="grid gap-2" disabled={!distanceEnabled} aria-describedby={distanceEnabled ? undefined : `${uid}-dist`}>
        <legend className="mb-2 text-[13px] font-medium text-ink">Distance</legend>
        {distanceEnabled ? null : (
          <p id={`${uid}-dist`} className="-mt-1 text-xs text-ink-2">
            {DISTANCE_REASON}
          </p>
        )}
        <div className="flex flex-wrap gap-1.5">
          <Chip on={filters.within === null} disabled={!distanceEnabled} onClick={() => onChange({ ...filters, within: null })}>
            Any
          </Chip>
          {DISTANCES.map((d: Distance) => (
            <Chip key={d} on={filters.within === d} disabled={!distanceEnabled} onClick={() => onChange({ ...filters, within: d })}>
              Within {d} km
            </Chip>
          ))}
        </div>
      </fieldset>
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-[13px] font-medium text-ink">Category</legend>
        <div className="flex flex-wrap gap-1.5">
          {categories.map((c) => (
            <Chip key={c.slug} on={filters.cats.includes(c.slug)} onClick={() => onChange({ ...filters, cats: toggle(filters.cats, c.slug) })}>
              {c.name}
            </Chip>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3">
        <label htmlFor={`${uid}-open`} className="flex min-h-10 items-center justify-between gap-3 text-sm text-ink">
          Open now
          <Switch id={`${uid}-open`} checked={filters.openNow} onCheckedChange={(v) => onChange({ ...filters, openNow: v })} />
        </label>
        <label htmlFor={`${uid}-week`} className="flex min-h-10 items-center justify-between gap-3 text-sm text-ink">
          <span>
            This week
            <span className="block text-xs text-ink-2">Pop-ups, exhibitions and events in the next 7 days</span>
          </span>
          <Switch id={`${uid}-week`} checked={filters.thisWeek} onCheckedChange={(v) => onChange({ ...filters, thisWeek: v })} />
        </label>
      </div>
    </div>
  )
}

type ControlProps = {
  filters: Filters
  onChange: (f: Filters) => void
  distanceEnabled: boolean
  resultCount: number
  phone: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  triggerClassName?: string
}

/** Filters: a Popover on desktop, a Sheet on phones (§6.4), behind the SlidersHorizontal control. */
export function FiltersControl({ filters, onChange, distanceEnabled, resultCount, phone, open, onOpenChange, triggerClassName }: ControlProps) {
  const n = activeCount(filters)
  const trigger = (
    <button type="button" aria-label={n ? `Filters, ${n} on` : "Filters"} className={cn("glass relative inline-flex size-11 items-center justify-center rounded-full text-ink outline-none focus-visible:ring-2 focus-visible:ring-violet", triggerClassName)} onClick={phone ? () => onOpenChange(true) : undefined}>
      <SlidersHorizontalIcon className="size-5" aria-hidden />
      {n ? <span aria-hidden className="absolute -top-0.5 -right-0.5 inline-flex size-4 items-center justify-center rounded-full bg-purple text-[10px] text-ink tabular">{n}</span> : null}
    </button>
  )
  const footer = (
    <div className="flex items-center justify-between gap-3">
      <Button variant="ghost" size="sm" onClick={() => onChange(emptyFilters)} disabled={!n}>
        Clear all
      </Button>
      <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
        {resultCount === 1 ? "Show 1 place" : `Show ${resultCount} places`}
      </Button>
    </div>
  )
  if (phone) {
    return (
      <>
        {trigger}
        <Sheet open={open} onOpenChange={onOpenChange}>
          <SheetContent side="bottom" className="max-h-[88dvh] rounded-t-2xl border-white/10 bg-[var(--glass-bg-strong)] backdrop-blur-xl">
            <SheetHeader className="pr-12">
              <SheetTitle>Filters</SheetTitle>
              <SheetDescription className="text-ink-2">Narrow the map and the list.</SheetDescription>
            </SheetHeader>
            <div className="min-h-0 overflow-y-auto px-4">
              <FiltersBody filters={filters} onChange={onChange} distanceEnabled={distanceEnabled} />
            </div>
            <SheetFooter className="pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</SheetFooter>
          </SheetContent>
        </Sheet>
      </>
    )
  }
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent side="left" align="end" sideOffset={12} className="glass-strong grid w-[360px] gap-4 rounded-2xl border-white/10 p-4">
        <p className="text-sm font-medium text-ink">Filters</p>
        <div className="max-h-[min(72vh,calc(100dvh-180px))] overflow-y-auto pr-1">
          <FiltersBody filters={filters} onChange={onChange} distanceEnabled={distanceEnabled} />
        </div>
        {footer}
      </PopoverContent>
    </Popover>
  )
}
