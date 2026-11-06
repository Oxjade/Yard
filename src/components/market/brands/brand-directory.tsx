"use client"

import { useCallback, useMemo, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { MagnifyingGlassMinusIcon as SearchX, SlidersHorizontalIcon as SlidersHorizontal, XIcon as X } from "@phosphor-icons/react"
import { AnimatePresence, motion, useInView } from "motion/react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { BrandCard } from "@/components/market/brand-card"
import { CatalogSearch } from "@/components/market/catalog/catalog-search"
import { Chip } from "@/components/market/catalog/chip"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { countries } from "@/config/markets"
import { aestheticLabels, categoryBySlug, searchBrands, type BrandSort } from "@/lib/data"
import { cn } from "@/lib/utils"
import {
  aestheticOptions,
  categoryOptions,
  countryOptions,
  emptyFilters,
  filterCount,
  isFiltering,
  parseFilters,
  sortOptions,
  toSearch,
  type BrandFilters,
} from "./brand-filters"

type Option<T extends string> = { value: T; label: string }

/* ---------- Controls ---------- */

/**
 * A single-choice row built from the shop's Chip: the purple fill slides between chips
 * (layoutId) and each chip is a pressed / not pressed toggle, as on /shop.
 */
function ChoiceChips<T extends string>({
  id,
  label,
  options,
  value,
  onChange,
  layout = "wrap",
  allLabel = "All",
  includeAll = true,
}: {
  id: string
  label: string
  options: Option<T>[]
  value: T | undefined
  onChange: (v: T | undefined) => void
  layout?: "wrap" | "rail"
  allLabel?: string
  /** Offer an "All" chip that clears the choice. */
  includeAll?: boolean
}) {
  const all = (includeAll ? [{ value: undefined, label: allLabel }, ...options] : options) as { value: T | undefined; label: string }[]
  return (
    <div role="group" aria-label={label} className={cn("flex gap-2", layout === "rail" ? "rail -mx-4 overflow-x-auto px-4 pb-1 lg:mx-0 lg:px-0" : "flex-wrap")}>
      {all.map((o) => (
        <Chip key={o.value ?? "all"} selected={value === o.value} onClick={() => onChange(o.value)} layoutId={`${id}-pill`}>
          {o.label}
        </Chip>
      ))}
    </div>
  )
}

/** The shop's Select trigger and content, so the two filtered listings share one toolbar. */
const triggerClass = "h-11 min-w-44 rounded-md border-line bg-surface px-3 text-sm data-[size=default]:h-11"

function CountrySelect({ value, onChange }: { value: BrandFilters["country"]; onChange: (v: BrandFilters["country"]) => void }) {
  return (
    <Select value={value ?? "all"} onValueChange={(v) => onChange(v === "all" ? undefined : (v as BrandFilters["country"]))}>
      <SelectTrigger aria-label="Location" className={triggerClass}>
        <span className="text-ink-3">Location</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end" position="popper">
        <SelectItem value="all">Anywhere</SelectItem>
        {countryOptions.map((c) => (
          <SelectItem key={c.value} value={c.value}>
            {c.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** Unfiltered, the directory shows the featured arrangement; picking a sort switches to the full list. */
function SortSelect({ value, onChange }: { value: BrandSort | undefined; onChange: (v: BrandSort) => void }) {
  return (
    <Select value={value ?? ""} onValueChange={(v) => onChange(v as BrandSort)}>
      <SelectTrigger aria-label="Sort brands" className={cn(triggerClass, "data-placeholder:text-ink")}>
        <span className="text-ink-3">Sort</span>
        <SelectValue placeholder="Featured" />
      </SelectTrigger>
      <SelectContent align="end" position="popper">
        {sortOptions.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/* ---------- Phone filter sheet ---------- */

/**
 * The phone sheet, in the same glass shell as the shop's FilterSheet (handle, display title
 * with the active count, max-w-lg, Show N disabled at zero). Choices apply as they are made.
 */
function FilterSheet({
  open,
  onOpenChange,
  filters,
  set,
  clear,
  count,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  filters: BrandFilters
  set: (next: Partial<BrandFilters>) => void
  clear: () => void
  count: number
}) {
  const active = filterCount(filters)
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open ? (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[6px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }} />
            </DialogPrimitive.Overlay>
            <DialogPrimitive.Content asChild forceMount aria-describedby={undefined}>
              <motion.div
                className="glass-strong glass-sheen fixed inset-x-2 bottom-2 z-50 mx-auto flex max-h-[min(88dvh,760px)] max-w-lg flex-col overflow-hidden rounded-2xl outline-none sm:bottom-3"
                initial={{ y: "105%" }}
                animate={{ y: 0 }}
                exit={{ y: "105%" }}
                transition={{ type: "spring", stiffness: 380, damping: 38, mass: 0.9 }}
              >
                <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-white/15" aria-hidden />
                <header className="flex items-center justify-between px-5 pt-3 pb-3">
                  <DialogPrimitive.Title className="flex items-baseline gap-2">
                    <span className="font-display text-display-sm">Filter and sort</span>
                    {active ? <span className="text-sm text-ink-2 tabular">{active} active</span> : null}
                  </DialogPrimitive.Title>
                  <DialogPrimitive.Close className="inline-flex size-9 items-center justify-center rounded-full text-ink-2 transition hover:bg-white/8 hover:text-ink" aria-label="Close filters">
                    <X className="size-5" />
                  </DialogPrimitive.Close>
                </header>
                <div className="grid flex-1 gap-7 overflow-y-auto overscroll-contain px-5 pt-2 pb-6">
                  <fieldset>
                    <legend className="mb-3 text-sm text-ink-2">Sort by</legend>
                    <ChoiceChips id="sheet-sort" label="Sort by" options={sortOptions} value={filters.sort ?? (isFiltering(filters) ? "trending" : undefined)} onChange={(v) => set({ sort: v ?? "trending" })} includeAll={false} />
                  </fieldset>
                  <fieldset>
                    <legend className="mb-3 text-sm text-ink-2">Category</legend>
                    <ChoiceChips id="sheet-category" label="Category" options={categoryOptions} value={filters.category} onChange={(v) => set({ category: v })} />
                  </fieldset>
                  <fieldset>
                    <legend className="mb-3 text-sm text-ink-2">Aesthetic</legend>
                    <ChoiceChips id="sheet-aesthetic" label="Aesthetic" options={aestheticOptions} value={filters.aesthetic} onChange={(v) => set({ aesthetic: v })} />
                  </fieldset>
                  <fieldset>
                    <legend className="mb-3 text-sm text-ink-2">Location</legend>
                    <ChoiceChips id="sheet-country" label="Location" options={countryOptions} value={filters.country} onChange={(v) => set({ country: v })} allLabel="Anywhere" />
                  </fieldset>
                </div>
                <footer className="grid grid-cols-[auto_1fr] gap-2 border-t border-white/8 bg-black/20 px-5 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
                  <Button variant="secondary" size="lg" onClick={clear} disabled={!isFiltering(filters)}>
                    Clear all
                  </Button>
                  <Button variant="primary" size="lg" onClick={() => onOpenChange(false)} disabled={count === 0} className="tabular">
                    {count === 0 ? "No brands match" : `Show ${count} ${count === 1 ? "brand" : "brands"}`}
                  </Button>
                </footer>
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        ) : null}
      </AnimatePresence>
    </DialogPrimitive.Root>
  )
}

/* ---------- The directory ---------- */

function DirectoryView({ filters, onChange, children }: { filters: BrandFilters; onChange?: (next: BrandFilters, mode: "push" | "replace") => void; children: React.ReactNode }) {
  const [sheetOpen, setSheetOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const inView = useInView(rootRef, { margin: "0px 0px -35% 0px" })

  const filtering = isFiltering(filters)
  const results = useMemo(
    () => searchBrands({ q: filters.q, category: filters.category, aesthetic: filters.aesthetic, country: filters.country, sort: filters.sort }),
    [filters.q, filters.category, filters.aesthetic, filters.country, filters.sort],
  )

  const set = (next: Partial<BrandFilters>) => onChange?.({ ...filters, ...next }, "push")
  // CatalogSearch settles typing for a moment before it commits, so the URL isn't rewritten per keystroke.
  const commitQuery = useCallback((q: string) => onChange?.({ ...filters, q }, "replace"), [filters, onChange])
  const clear = () => onChange?.(emptyFilters, "push")

  const applied = [
    filters.q.trim() ? { key: "q", label: `“${filters.q.trim()}”`, remove: () => commitQuery("") } : null,
    filters.category ? { key: "category", label: categoryBySlug.get(filters.category)!.name, remove: () => set({ category: undefined }) } : null,
    filters.aesthetic ? { key: "aesthetic", label: aestheticLabels[filters.aesthetic], remove: () => set({ aesthetic: undefined }) } : null,
    filters.country ? { key: "country", label: countries[filters.country].name, remove: () => set({ country: undefined }) } : null,
  ].filter((x): x is { key: string; label: string; remove: () => void } => !!x)

  const sortLabel = sortOptions.find((o) => o.value === (filters.sort ?? "trending"))!.label
  const extraFilters = filterCount(filters)

  return (
    <div ref={rootRef}>
      {/* Toolbar */}
      <div className="mt-10 grid gap-4 md:mt-12">
        <div className="flex items-center gap-3">
          <CatalogSearch value={filters.q} onCommit={commitQuery} placeholder="Search brands or cities" label="Search brands" className="min-w-0 flex-1 lg:max-w-md" />
          <div className="ml-auto hidden items-center gap-3 lg:flex">
            <CountrySelect value={filters.country} onChange={(v) => set({ country: v })} />
            <SortSelect value={filters.sort ?? (filtering ? "trending" : undefined)} onChange={(v) => set({ sort: v })} />
          </div>
        </div>
        <div className="grid gap-3 lg:grid-cols-[6.5rem_1fr] lg:items-center">
          <p className="hidden text-sm text-ink-3 lg:block">Category</p>
          <ChoiceChips id="bar-category" label="Category" options={categoryOptions} value={filters.category} onChange={(v) => set({ category: v })} layout="rail" />
        </div>
        <div className="hidden gap-3 lg:grid lg:grid-cols-[6.5rem_1fr] lg:items-center">
          <p className="text-sm text-ink-3">Aesthetic</p>
          <ChoiceChips id="bar-aesthetic" label="Aesthetic" options={aestheticOptions} value={filters.aesthetic} onChange={(v) => set({ aesthetic: v })} layout="wrap" />
        </div>
      </div>

      {/* Curated sections stay mounted and are hidden while filtering, so going back is instant. */}
      <div hidden={filtering}>{children}</div>

      {filtering ? (
        <section aria-labelledby="results-title" className="mt-10 md:mt-12">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-line-soft pb-4">
            <h2 id="results-title" className="text-base text-ink tabular" aria-live="polite">
              {results.length} {results.length === 1 ? "brand" : "brands"}
              <span className="text-ink-3">, sorted by {sortLabel.toLowerCase()}</span>
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              {applied.length ? (
                <ul className="flex flex-wrap gap-2" aria-label="Applied filters">
                  {applied.map((a) => (
                    <li key={a.key} className="max-w-full">
                      <button
                        type="button"
                        onClick={a.remove}
                        aria-label={`Remove filter ${a.label}`}
                        className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border border-purple/45 bg-purple/15 pr-2 pl-3 text-[0.8125rem] text-ink transition-colors hover:border-violet hover:bg-purple/25"
                      >
                        <span className="truncate">{a.label}</span>
                        <X className="size-3.5 shrink-0 text-ink-2" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <button type="button" onClick={clear} className="h-8 rounded-md px-2 text-[0.8125rem] text-violet underline-offset-4 hover:underline">
                {applied.length ? "Clear all" : "Back to featured"}
              </button>
            </div>
          </div>

          {results.length ? (
            <motion.div
              key={`${filters.q}-${filters.category}-${filters.aesthetic}-${filters.country}-${filters.sort}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.25 }}
              className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
            >
              {results.map((b) => (
                <BrandCard key={b.id} brand={b} showProducts stat={filters.sort === "emerging" ? "growth" : filters.sort === "newest" ? "joined" : "followers"} />
              ))}
            </motion.div>
          ) : (
            <div className="flex flex-col items-center gap-4 px-6 py-24 text-center">
              <span className="inline-flex size-14 items-center justify-center rounded-full border border-line">
                <SearchX className="size-6 text-ink-2" />
              </span>
              <div>
                <p className="text-base text-ink">No brands match these filters</p>
                <p className="mt-1 text-sm text-ink-2">
                  {filters.q.trim() ? `Nothing fits “${filters.q.trim()}” with what you've picked.` : "Nothing fits that combination yet."} Try removing a filter.
                </p>
              </div>
              <Button variant="primary" onClick={clear}>
                Clear filters
              </Button>
            </div>
          )}
        </section>
      ) : null}

      {/* Phone: the shop's floating glass pill opens the filter sheet */}
      <AnimatePresence>
        {inView && !sheetOpen && onChange ? (
          <motion.div
            className="pointer-events-none fixed inset-x-0 bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+4.75rem)] z-30 flex justify-center lg:hidden"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
          >
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              aria-haspopup="dialog"
              aria-label={`Filter and sort${extraFilters ? `, ${extraFilters} applied` : ""}`}
              className="glass glass-sheen pointer-events-auto inline-flex h-12 items-center gap-2.5 rounded-full pr-4 pl-5 text-sm font-medium text-ink transition-transform active:scale-[0.97]"
            >
              <SlidersHorizontal className="size-4" />
              Filter and sort
              {extraFilters ? <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-purple px-1.5 text-[11px] tabular">{extraFilters}</span> : null}
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <FilterSheet open={sheetOpen} onOpenChange={setSheetOpen} filters={filters} set={set} clear={clear} count={results.length} />
    </div>
  )
}

/** The brand directory, driven by the URL (?q, category, aesthetic, country, sort). Render inside <Suspense>. */
export function BrandDirectory({ children }: { children: React.ReactNode }) {
  const params = useSearchParams()
  const filters = useMemo(() => parseFilters(new URLSearchParams(params.toString())), [params])

  const onChange = useCallback((next: BrandFilters, mode: "push" | "replace") => {
    const url = `${window.location.pathname}${toSearch(next)}`
    if (mode === "push") window.history.pushState(null, "", url)
    else window.history.replaceState(null, "", url)
  }, [])

  return (
    <DirectoryView filters={filters} onChange={onChange}>
      {children}
    </DirectoryView>
  )
}

/** Shown while the URL is read: the unfiltered directory, so the static page is complete. */
export function BrandDirectoryFallback({ children }: { children: React.ReactNode }) {
  return <DirectoryView filters={emptyFilters}>{children}</DirectoryView>
}
