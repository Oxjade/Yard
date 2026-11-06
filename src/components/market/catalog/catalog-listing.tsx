"use client"

import { useCallback, useId, useMemo, useRef, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { MagnifyingGlassMinusIcon as SearchX, SlidersHorizontalIcon as SlidersHorizontal, XIcon as X } from "@phosphor-icons/react"
import { AnimatePresence, motion, useInView } from "motion/react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { countries } from "@/config/markets"
import { useHydrated } from "@/hooks/use-hydrated"
import { brandByHandle, categories, categoryBySlug, type ProductSort } from "@/lib/data"
import { useSession } from "@/lib/stores/session"
import type { CategorySlug } from "@/lib/data/types"
import { CatalogGrid } from "./catalog-grid"
import { CatalogSearch } from "./catalog-search"
import {
  activeFilterCount,
  buildListing,
  emptyState,
  panelFilterCount,
  parseCatalogParams,
  serializeCatalogParams,
  sizeChipLabel,
  sortOptions,
  type CatalogScope,
  type CatalogState,
} from "./catalog-state"
import { Chip } from "./chip"
import { FilterControls, priceLabel, type FilterPatch } from "./filter-controls"
import { FilterSheet } from "./filter-sheet"

/**
 * The product listing shared by /shop and /categories/[slug]. All state is in the URL
 * (q, category, sub, brands, min, max, size, stock, country, sort, page), read with
 * useSearchParams, so this must render inside <Suspense>.
 */
export function CatalogListing({ category }: { category?: CategorySlug }) {
  const scope: CatalogScope = useMemo(() => ({ category }), [category])
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const state = useMemo(() => parseCatalogParams(params, scope), [params, scope])
  const listing = useMemo(() => buildListing(state), [state])

  const idBase = useId()
  const hydrated = useHydrated()
  const shopperCurrency = useSession((s) => s.currency)
  const currency = hydrated ? shopperCurrency : "USD"

  const [revealFrom, setRevealFrom] = useState(Infinity)
  const [changed, setChanged] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [draft, setDraft] = useState<CatalogState>(state)

  const rootRef = useRef<HTMLDivElement>(null)
  const inView = useInView(rootRef, { margin: "0px 0px -35% 0px" })

  const navigate = useCallback(
    (next: CatalogState) => {
      const qs = serializeCatalogParams(next, scope)
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [router, pathname, scope],
  )

  const resultsRef = useRef<HTMLDivElement>(null)

  /** Any change to what is listed starts again from page 1, with the results top in view. */
  const apply = useCallback(
    (next: CatalogState) => {
      setRevealFrom(Infinity)
      setChanged(true)
      navigate({ ...next, page: 1 })
      const top = resultsRef.current?.getBoundingClientRect().top ?? 0
      if (top < 0) {
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
        window.scrollTo({ top: window.scrollY + top - 104, behavior: reduce ? "auto" : "smooth" })
      }
    },
    [navigate],
  )

  const patch = (p: FilterPatch) => apply({ ...state, ...p })
  const onSearch = useCallback((q: string) => apply({ ...parseCatalogParams(new URLSearchParams(window.location.search), scope), q }), [apply, scope])
  const clearAll = () => apply({ ...emptyState(scope), sort: state.sort })

  function loadMore() {
    setRevealFrom(listing.cardCount)
    navigate({ ...state, page: listing.page + 1 })
  }

  function openSheet() {
    setDraft(state)
    setSheetOpen(true)
  }

  const cat = category ? categoryBySlug.get(category)! : undefined
  const activeCount = activeFilterCount(state, scope)
  const panelCount = panelFilterCount(state)
  const signature = serializeCatalogParams({ ...state, page: 1 }, scope)

  /* ---------- active-filter chips ---------- */
  // Each chip carries the change that removes it; the click handler applies it.
  const chips: { key: string; label: string; without: FilterPatch }[] = []
  if (state.q) chips.push({ key: "q", label: `“${state.q}”`, without: { q: "" } })
  if (state.category && !scope.category) chips.push({ key: "category", label: categoryBySlug.get(state.category)!.name, without: { category: undefined, sub: undefined } })
  if (state.sub) chips.push({ key: "sub", label: state.sub, without: { sub: undefined } })
  for (const h of state.brands) chips.push({ key: `b-${h}`, label: brandByHandle.get(h)!.name, without: { brands: state.brands.filter((x) => x !== h) } })
  if (state.min !== undefined || state.max !== undefined) chips.push({ key: "price", label: priceLabel(state.min, state.max, currency), without: { min: undefined, max: undefined } })
  for (const s of state.sizes) chips.push({ key: `s-${s}`, label: sizeChipLabel(s), without: { sizes: state.sizes.filter((x) => x !== s) } })
  if (state.inStock) chips.push({ key: "stock", label: "In stock", without: { inStock: false } })
  if (state.country) chips.push({ key: "country", label: `Brands from ${countries[state.country].name}`, without: { country: undefined } })

  const shown = listing.shown
  const progress = listing.total ? shown / listing.total : 0

  return (
    <div ref={rootRef}>
      {/* Search and the category (or subcategory) chips */}
      <div className="flex flex-col gap-5">
        <CatalogSearch
          value={state.q}
          onCommit={onSearch}
          label={cat ? `Search ${cat.name}` : "Search the shop"}
          placeholder={cat ? `Search ${cat.name.toLowerCase()}` : "Search pieces, brands and materials"}
          className="md:max-w-xl"
        />
        <div role="radiogroup" aria-label={cat ? `${cat.name} subcategories` : "Categories"} className="rail -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0 md:pb-0">
          {cat ? (
            <>
              <Chip radio selected={!state.sub} layoutId="catalog-sub" onClick={() => patch({ sub: undefined })}>
                All {cat.name.toLowerCase()}
              </Chip>
              {cat.subcategories.map((s) => (
                <Chip key={s} radio selected={state.sub === s} layoutId="catalog-sub" onClick={() => patch({ sub: state.sub === s ? undefined : s })}>
                  {s}
                </Chip>
              ))}
            </>
          ) : (
            <>
              <Chip radio selected={!state.category} layoutId="catalog-category" onClick={() => patch({ category: undefined, sub: undefined })}>
                All
              </Chip>
              {categories.map((c) => (
                <Chip key={c.slug} radio selected={state.category === c.slug} layoutId="catalog-category" onClick={() => patch({ category: state.category === c.slug ? undefined : c.slug, sub: undefined })}>
                  {c.name}
                </Chip>
              ))}
            </>
          )}
        </div>
      </div>

      <div className="mt-8 border-t border-line-soft pt-6 md:mt-10 lg:grid lg:grid-cols-[232px_minmax(0,1fr)] lg:gap-10 xl:gap-14">
        {/* Desktop filter panel */}
        <aside className="hidden lg:block" aria-labelledby="catalog-filters-title">
          <div className="rail sticky top-24 max-h-[calc(100dvh-7rem)] overflow-y-auto pr-1 pb-8">
            <div className="mb-5 flex h-10 items-center justify-between">
              <h2 id="catalog-filters-title" className="text-sm font-medium text-ink">
                Filters
              </h2>
              {panelCount ? (
                <button type="button" onClick={() => patch({ brands: [], min: undefined, max: undefined, sizes: [], inStock: false, country: undefined })} className="rounded-md text-sm text-ink-2 transition-colors hover:text-ink">
                  Reset
                </button>
              ) : null}
            </div>
            <FilterControls state={state} onChange={patch} currency={currency} />
          </div>
        </aside>

        <section aria-labelledby={`${idBase}-results`} className="min-w-0">
          {/* Toolbar */}
          <div ref={resultsRef} className="flex scroll-mt-28 items-center justify-between gap-3">
            <h2 id={`${idBase}-results`} className="text-sm font-normal text-ink-2" aria-live="polite">
              <span className="tabular text-ink">{listing.total}</span> {listing.total === 1 ? "piece" : "pieces"}
              {listing.total ? (
                <span className="hidden sm:inline">
                  {" "}
                  from {listing.brandCount} {listing.brandCount === 1 ? "brand" : "brands"}
                </span>
              ) : null}
            </h2>
            <Select value={state.sort} onValueChange={(v) => patch({ sort: v as ProductSort })}>
              <SelectTrigger aria-label="Sort" className="h-11 min-w-44 rounded-md border-line bg-surface px-3 text-sm data-[size=default]:h-11">
                <span className="text-ink-3">Sort</span>
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end" position="popper">
                {sortOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Active filters */}
          {chips.length ? (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <AnimatePresence initial={false} mode="popLayout">
                {chips.map((c) => (
                  <motion.button
                    key={c.key}
                    layout
                    type="button"
                    onClick={() => patch(c.without)}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ type: "spring", stiffness: 520, damping: 38 }}
                    aria-label={`Remove filter ${c.label}`}
                    className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border border-purple/45 bg-purple/15 pr-2 pl-3 text-[0.8125rem] text-ink transition-colors hover:border-violet hover:bg-purple/25"
                  >
                    <span className="truncate">{c.label}</span>
                    <X className="size-3.5 shrink-0 text-ink-2" aria-hidden />
                  </motion.button>
                ))}
              </AnimatePresence>
              {chips.length ? (
                <button type="button" onClick={clearAll} className="h-8 rounded-md px-2 text-[0.8125rem] text-violet underline-offset-4 hover:underline">
                  Clear all
                </button>
              ) : null}
            </div>
          ) : null}

          {/* Results */}
          <motion.div key={signature} className="mt-6" initial={changed ? { opacity: 0 } : false} animate={{ opacity: 1 }} transition={{ duration: 0.28 }}>
            {listing.total ? (
              <CatalogGrid cycles={listing.cycles} revealFrom={revealFrom} />
            ) : (
              <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-line-soft bg-card px-6 py-14 text-center md:py-20">
                <span className="inline-flex size-14 items-center justify-center rounded-full border border-line">
                  <SearchX className="size-6 text-ink-2" />
                </span>
                <div>
                  <p className="text-base text-ink">Nothing matches those filters</p>
                  <p className="mx-auto mt-1 max-w-sm text-sm text-ink-2">
                    {state.q && activeCount === 1 ? `No piece matches “${state.q}”. Try a brand name, a city or a material.` : "Try removing a filter or widening the price range."}
                  </p>
                </div>
                <Button variant="primary" onClick={clearAll}>
                  Clear filters
                </Button>
              </div>
            )}
          </motion.div>

          {/* Pagination */}
          {listing.total > 0 ? (
            <div className="mt-14 flex flex-col items-center gap-4 md:mt-16">
              <p className="text-sm text-ink-2 tabular" aria-live="polite">
                {listing.hasMore ? `Showing ${shown} of ${listing.total}` : listing.total > 1 ? `That's all ${listing.total} pieces` : "That's the only piece"}
              </p>
              {listing.pages > 1 ? (
                <div className="h-0.5 w-48 overflow-hidden rounded-full bg-line" aria-hidden>
                  <motion.div className="h-full origin-left bg-violet" initial={false} animate={{ scaleX: progress }} transition={{ type: "spring", stiffness: 200, damping: 30 }} />
                </div>
              ) : null}
              {listing.hasMore ? (
                <Button variant="primary" size="lg" onClick={loadMore} className="mt-2 min-w-48">
                  Load more
                </Button>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>

      {/* Phone: a floating glass pill opens the filter sheet */}
      <AnimatePresence>
        {inView && !sheetOpen ? (
          <motion.div
            className="pointer-events-none fixed inset-x-0 bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+4.75rem)] z-30 flex justify-center lg:hidden"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
          >
            <button
              type="button"
              onClick={openSheet}
              aria-haspopup="dialog"
              className="glass glass-sheen pointer-events-auto inline-flex h-12 items-center gap-2.5 rounded-full pr-4 pl-5 text-sm font-medium text-ink transition-transform active:scale-[0.97]"
            >
              <SlidersHorizontal className="size-4" />
              Filter and sort
              {panelCount ? <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-purple px-1.5 text-[11px] tabular">{panelCount}</span> : null}
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <FilterSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        draft={draft}
        onDraftChange={(p) => setDraft((d) => ({ ...d, ...p }))}
        onClear={() => setDraft((d) => ({ ...d, brands: [], min: undefined, max: undefined, sizes: [], inStock: false, country: undefined }))}
        onApply={() => {
          apply(draft)
          setSheetOpen(false)
        }}
        currency={currency}
      />
    </div>
  )
}
