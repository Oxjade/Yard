"use client"

import { useCallback, useMemo, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { MagnifyingGlassMinusIcon as SearchX, SlidersHorizontalIcon as SlidersHorizontal, XIcon as X } from "@phosphor-icons/react"
import { AnimatePresence, motion, useInView } from "motion/react"
import { BrandCard } from "@/components/market/brand-card"
import { CatalogSearch } from "@/components/market/catalog/catalog-search"
import { Chip, ChipRadioGroup } from "@/components/market/catalog/chip"
import { PhoneSheet } from "@/components/market/catalog/phone-sheet"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { countries } from "@/config/markets"
import { aestheticLabels, categoryBySlug, searchBrands, type BrandSort } from "@/lib/data"
import { duration, ease, spring } from "@/lib/motion"
import { cn } from "@/lib/utils"
import { EmptyCard } from "@/components/market/editorial/empty-card"
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
 * (layoutId), and the row is announced as one choice (a radio group), as on /stories and /drops.
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
  disabledValues = [],
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
  /** Options shown but not available right now (kept in place so the row never reflows). */
  disabledValues?: T[]
}) {
  const all = (includeAll ? [{ value: undefined, label: allLabel }, ...options] : options) as { value: T | undefined; label: string }[]
  return (
    <ChipRadioGroup label={label} className={cn("flex gap-2", layout === "rail" ? "rail -mx-4 overflow-x-auto px-4 pb-1 lg:mx-0 lg:px-0" : "flex-wrap")}>
      {all.map((o) => (
        <Chip key={o.value ?? "all"} selected={value === o.value} onClick={() => onChange(o.value)} layoutId={`${id}-pill`} radio disabled={o.value !== undefined && disabledValues.includes(o.value)}>
          {o.label}
        </Chip>
      ))}
    </ChipRadioGroup>
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

/**
 * Unfiltered, the directory shows the featured arrangement; picking a sort switches to the
 * full list, and "Featured" goes back. Once the list is narrowed there is no featured order,
 * so the choice falls back to trending and Featured is not offered.
 */
type SortChoice = BrandSort | "featured"

function sortChoices(narrowing: boolean): Option<SortChoice>[] {
  return narrowing ? sortOptions : [{ value: "featured", label: "Featured" }, ...sortOptions]
}

/** Search or a filter narrows the list; with nothing narrowed, sort alone shows every brand. */
const isNarrowing = (f: BrandFilters) => !!(f.q.trim() || f.category || f.aesthetic || f.country)
const sortOf = (f: BrandFilters): SortChoice => f.sort ?? (isNarrowing(f) ? "trending" : "featured")

/** How the results heading says the order: "14 brands, newest first". */
const sortPhrase: Record<BrandSort, string> = {
  trending: "by trend",
  newest: "newest first",
  followers: "most followed first",
  emerging: "fastest growing first",
}

function SortSelect({ value, narrowing, onChange }: { value: SortChoice; narrowing: boolean; onChange: (v: SortChoice) => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as SortChoice)}>
      <SelectTrigger aria-label="Sort brands" className={triggerClass}>
        <span className="text-ink-3">Sort</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end" position="popper">
        {sortChoices(narrowing).map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/* ---------- Phone filter sheet ---------- */

/** What the phone sheet's Clear filters empties: the panel filters, not the search or the sort. */
const NO_PANEL_FILTERS = { category: undefined, aesthetic: undefined, country: undefined } satisfies Partial<BrandFilters>

const resultsFor = (f: BrandFilters) => searchBrands({ q: f.q, category: f.category, aesthetic: f.aesthetic, country: f.country, sort: f.sort })

/**
 * The phone sheet, on the shop's PhoneSheet (drag the handle down, tap outside or press Escape
 * to close). Like the shop's, it edits a draft: "Show N brands" applies it, closing discards it,
 * and the count is the real result of the draft.
 */
function FilterSheet({
  open,
  onOpenChange,
  draft,
  onDraftChange,
  onApply,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  draft: BrandFilters
  onDraftChange: (patch: Partial<BrandFilters>) => void
  onApply: () => void
}) {
  const active = filterCount(draft)
  const count = useMemo(() => resultsFor(draft).length, [draft])
  const narrowing = isNarrowing(draft)
  const sort = sortOf(draft)
  return (
    <PhoneSheet
      open={open}
      onOpenChange={onOpenChange}
      closeLabel="Close filters"
      title={
        <>
          <span>Filter and sort</span>
          {active ? <span className="font-sans text-sm normal-case text-ink-2 tabular">{active} active</span> : null}
        </>
      }
      footerClassName="grid grid-cols-[auto_1fr] gap-2"
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={() => onDraftChange(NO_PANEL_FILTERS)} disabled={active === 0}>
            Clear filters
          </Button>
          {/* Acid only while it can apply; a held footer is the quiet secondary, as on /shop. */}
          <Button variant={count === 0 ? "secondary" : "primary"} size="lg" onClick={onApply} disabled={count === 0} className="tabular">
            {count === 0 ? "No brands match" : `Show ${count} ${count === 1 ? "brand" : "brands"}`}
          </Button>
        </>
      }
    >
      <div className="grid gap-7">
        <fieldset>
          <legend className="mb-3 flex w-full items-baseline justify-between gap-3 text-sm text-ink-2">
            Sort by
            {narrowing ? <span className="text-xs text-ink-3">Featured is for the full directory</span> : null}
          </legend>
          {/* Featured stays in the row while filters are on (disabled), so the chips below never jump. */}
          <ChoiceChips
            id="sheet-sort"
            label="Sort by"
            options={sortChoices(false)}
            value={sort}
            onChange={(v) => onDraftChange({ sort: !v || v === "featured" ? undefined : v })}
            includeAll={false}
            disabledValues={narrowing ? ["featured"] : []}
          />
        </fieldset>
        <fieldset>
          <legend className="mb-3 text-sm text-ink-2">Category</legend>
          <ChoiceChips id="sheet-category" label="Category" options={categoryOptions} value={draft.category} onChange={(v) => onDraftChange({ category: v })} />
        </fieldset>
        <fieldset>
          <legend className="mb-3 text-sm text-ink-2">Aesthetic</legend>
          <ChoiceChips id="sheet-aesthetic" label="Aesthetic" options={aestheticOptions} value={draft.aesthetic} onChange={(v) => onDraftChange({ aesthetic: v })} />
        </fieldset>
        <fieldset>
          <legend className="mb-3 text-sm text-ink-2">Location</legend>
          <ChoiceChips id="sheet-country" label="Location" options={countryOptions} value={draft.country} onChange={(v) => onDraftChange({ country: v })} allLabel="Anywhere" />
        </fieldset>
      </div>
    </PhoneSheet>
  )
}

/* ---------- The directory ---------- */

function DirectoryView({ filters, onChange, children }: { filters: BrandFilters; onChange?: (next: BrandFilters) => void; children: React.ReactNode }) {
  const [sheetOpen, setSheetOpen] = useState(false)
  const [draft, setDraft] = useState<BrandFilters>(filters)
  const rootRef = useRef<HTMLDivElement>(null)
  const inView = useInView(rootRef, { margin: "0px 0px -35% 0px" })

  const filtering = isFiltering(filters)
  const results = useMemo(() => resultsFor(filters), [filters])

  const set = (next: Partial<BrandFilters>) => onChange?.({ ...filters, ...next })
  // The search field settles typing for a moment before it commits, so the URL isn't rewritten per keystroke.
  // Brands match on name, city, tagline and description; without catalogue state it offers no
  // completions (they count pieces, which wouldn't fit a list of brands).
  const commitQuery = useCallback((q: string) => onChange?.({ ...filters, q }), [filters, onChange])
  const clear = () => onChange?.(emptyFilters)

  function openSheet() {
    setDraft(filters)
    setSheetOpen(true)
  }

  const applied = [
    filters.q.trim() ? { key: "q", label: `“${filters.q.trim()}”`, remove: () => commitQuery("") } : null,
    filters.category ? { key: "category", label: categoryBySlug.get(filters.category)!.name, remove: () => set({ category: undefined }) } : null,
    filters.aesthetic ? { key: "aesthetic", label: aestheticLabels[filters.aesthetic], remove: () => set({ aesthetic: undefined }) } : null,
    filters.country ? { key: "country", label: countries[filters.country].name, remove: () => set({ country: undefined }) } : null,
  ].filter((x): x is { key: string; label: string; remove: () => void } => !!x)

  const extraFilters = filterCount(filters)
  const narrowing = isNarrowing(filters)
  const sort = sortOf(filters)
  const setSort = (v: SortChoice) => set({ sort: v === "featured" ? undefined : v })
  const q = filters.q.trim()
  const emptyReason =
    q && !extraFilters
      ? `No brand or city matches “${q}”. Try a brand name or a city.`
      : q
        ? `Nothing matches “${q}” with these filters. Try removing one.`
        : "No brand fits that combination yet. Try removing a filter."

  return (
    <div ref={rootRef}>
      {/* Toolbar */}
      <div className="mt-10 grid gap-4 md:mt-12">
        <div className="flex items-center gap-3">
          <CatalogSearch value={filters.q} onCommit={commitQuery} label="Search brands" placeholder="Search brands or cities" className="min-w-0 flex-1 lg:max-w-md" />
          <div className="ml-auto hidden items-center gap-3 lg:flex">
            <CountrySelect value={filters.country} onChange={(v) => set({ country: v })} />
            <SortSelect value={sort} narrowing={narrowing} onChange={setSort} />
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
              {results.length ? (
                <>
                  {results.length} {results.length === 1 ? "brand" : "brands"}
                  <span className="text-ink-3">, {sortPhrase[filters.sort ?? "trending"]}</span>
                </>
              ) : (
                "No brands"
              )}
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
                        className="inline-flex h-10 max-w-full items-center gap-1.5 rounded-full border border-purple/45 bg-purple/15 pr-2.5 pl-3 text-[0.8125rem] text-ink transition-colors duration-150 outline-none hover:border-violet hover:bg-purple/25 focus-visible:ring-2 focus-visible:ring-violet sm:h-8 sm:pr-2"
                      >
                        <span className="truncate">{a.label}</span>
                        <X className="size-3.5 shrink-0 text-ink-2" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <button type="button" onClick={clear} className="h-10 rounded-md px-2 text-[0.8125rem] text-violet underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-violet sm:h-8">
                {applied.length ? "Clear all" : "Back to featured"}
              </button>
            </div>
          </div>

          {results.length ? (
            <motion.div
              key={`${filters.q}-${filters.category}-${filters.aesthetic}-${filters.country}-${filters.sort}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: duration.page, ease: ease.out }}
              className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
            >
              {results.map((b) => (
                <BrandCard key={b.id} brand={b} showProducts stat={filters.sort === "emerging" ? "growth" : filters.sort === "newest" ? "joined" : "followers"} />
              ))}
            </motion.div>
          ) : (
            <EmptyCard
              className="mt-8"
              icon={<SearchX />}
              title={q && !extraFilters ? "No brands match that search" : "No brands match these filters"}
              reason={emptyReason}
              action={
                <Button variant="primary" onClick={clear}>
                  {q && !extraFilters ? "Clear search" : "Clear filters"}
                </Button>
              }
            />
          )}
        </section>
      ) : null}

      {/* Phone: the shop's floating glass pill opens the filter sheet. It stays mounted while the
          sheet is open (under its overlay) so closing the sheet returns focus to it. */}
      <AnimatePresence>
        {(inView || sheetOpen) && onChange ? (
          <motion.div
            className="pointer-events-none fixed inset-x-0 bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+4.75rem)] z-30 flex justify-center lg:hidden"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={spring.lift}
          >
            <button
              type="button"
              onClick={openSheet}
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

      <FilterSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        draft={draft}
        onDraftChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
        onApply={() => {
          onChange?.(draft)
          setSheetOpen(false)
        }}
      />
    </div>
  )
}

/** The brand directory, driven by the URL (?q, category, aesthetic, country, sort). Render inside <Suspense>. */
export function BrandDirectory({ children }: { children: React.ReactNode }) {
  const params = useSearchParams()
  const filters = useMemo(() => parseFilters(new URLSearchParams(params.toString())), [params])

  // Filter rows on /brands, /stories and /drops replace the history entry, as the shop's filters
  // do: Back leaves the page rather than stepping through every combination that was tried.
  const onChange = useCallback((next: BrandFilters) => {
    window.history.replaceState(null, "", `${window.location.pathname}${toSearch(next)}`)
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
