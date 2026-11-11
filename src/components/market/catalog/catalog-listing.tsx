"use client"

import { usePageSampleDataState } from "@/components/sample/sample-data-context"
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { MagnifyingGlassMinusIcon as SearchX, SlidersHorizontalIcon as SlidersHorizontal, StorefrontIcon, XIcon as X } from "@phosphor-icons/react"
import { AnimatePresence, motion, useInView } from "motion/react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { countries } from "@/config/markets"
import { ProductCardSkeleton } from "@/components/feedback/skeletons"
import { useHydrated } from "@/hooks/use-hydrated"
import { loadPublicProductsByIds } from "@/lib/api/catalog-products"
import { api } from "@/lib/api/client"
import { errorMessage } from "@/lib/api/errors"
import { registerLiveProducts } from "@/lib/api/live-catalog"
import { categories, categoryBySlug, type ProductSort } from "@/lib/data"
import { duration, ease, spring } from "@/lib/motion"
import { useSession } from "@/lib/stores/session"
import { cn } from "@/lib/utils"
import type { CategorySlug, Product } from "@/lib/data/types"
import { CatalogGrid } from "./catalog-grid"
import { CatalogSearch } from "./catalog-search"
import {
  activeFilterCount,
  buildListingFromResults,
  catalogFacetsFromSearch,
  unknownBrandLabel,
  CATALOG_SSR_CURRENCY,
  catalogSearchKey,
  catalogSearchQuery,
  EMPTY_CATALOG_FACETS,
  emptyState,
  MAX_CATALOG_PAGES,
  panelFilterCount,
  parseCatalogParams,
  serializeCatalogParams,
  sizeChipLabel,
  sortOptions,
  type CatalogInitialPage,
  type CatalogSearchResponse,
  type CatalogScope,
  type CatalogState,
} from "./catalog-state"
import { Chip, ChipRadioGroup } from "./chip"
import { FilterControls, priceLabel, type FilterPatch } from "./filter-controls"
import { FilterSheet } from "./filter-sheet"

/** Panel filters (what the desktop panel and the phone sheet change), all cleared. */
const NO_PANEL_FILTERS = { brands: [], min: undefined, max: undefined, sizes: [], inStock: false, country: undefined } satisfies FilterPatch

/**
 * The product listing shared by /shop and /categories/[slug]. All state is in the URL
 * (q, category, sub, brands, min, max, size, stock, country, sort, page), read with
 * useSearchParams, so this must render inside <Suspense>. Search results and facets come from
 * the search API; changes are written with history.replaceState to keep the URL authoritative.
 * `initial` is the first page read on the server (CatalogListingServer), so the HTML carries
 * products; the browser skips that request while its search key still matches.
 */
export function CatalogListing({ category, initial }: { category?: CategorySlug; initial?: CatalogInitialPage }) {
  const scope: CatalogScope = useMemo(() => ({ category }), [category])
  const pathname = usePathname()
  const params = useSearchParams()
  const state = useMemo(() => parseCatalogParams(params, scope), [params, scope])
  const sampleData = usePageSampleDataState()
  const hydrated = useHydrated()
  const shopperCurrency = useSession((s) => s.currency)
  const currency = hydrated ? shopperCurrency : CATALOG_SSR_CURRENCY
  const requestQuery = useMemo(() => catalogSearchQuery(state, currency), [state, currency])
  const searchKey = useMemo(() => catalogSearchKey(requestQuery), [requestQuery])
  const [catalogProducts, setCatalogProducts] = useState<Product[]>(() => initial?.products ?? [])
  const [searchResponse, setSearchResponse] = useState<CatalogSearchResponse | null>(() => initial?.response ?? null)
  const [resultKey, setResultKey] = useState(() => initial?.key ?? "")
  const [loadedPages, setLoadedPages] = useState(() => (initial ? 1 : 0))
  const [nextCursor, setNextCursor] = useState<string | null>(() => initial?.response.nextCursor ?? null)
  const [requestError, setRequestError] = useState<{ key: string; message: string } | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [loadedNote, setLoadedNote] = useState("")

  useEffect(() => {
    // Quick add from the grid can then show a server-rendered piece in the bag without another fetch.
    if (initial) registerLiveProducts(initial.products)
  }, [initial])

  useEffect(() => {
    const sameQuery = resultKey === searchKey
    if (sameQuery && (loadedPages >= state.page || !nextCursor)) return
    const cursor = sameQuery ? nextCursor ?? undefined : undefined
    const controller = new AbortController()
    void api<CatalogSearchResponse>("/api/search", { query: { ...requestQuery, cursor }, signal: controller.signal })
      .then(async (result) => {
        const products = await loadPublicProductsByIds(result.items.map((item) => item.productId), controller.signal)
        if (controller.signal.aborted) return
        registerLiveProducts(products)
        setCatalogProducts((current) => sameQuery ? [...current, ...products] : products)
        setSearchResponse(result)
        setResultKey(searchKey)
        setLoadedPages((current) => sameQuery ? current + 1 : 1)
        setNextCursor(result.nextCursor)
        if (sameQuery) setLoadedNote(`${products.length} more ${products.length === 1 ? "piece" : "pieces"} loaded. Showing ${catalogProducts.length + products.length} of ${result.total}.`)
        setRequestError(null)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setRequestError({ key: searchKey, message: errorMessage(error, "The shop results couldn't be loaded.") })
      })
    return () => controller.abort()
  }, [catalogProducts.length, loadedPages, nextCursor, reloadKey, requestQuery, resultKey, searchKey, state.page])

  const hasCurrentResults = resultKey === searchKey
  const catalogError = requestError?.key === searchKey ? requestError.message : null
  const requestLoading = !catalogError && (!hasCurrentResults || (loadedPages < state.page && nextCursor !== null))
  const currentResponse = hasCurrentResults ? searchResponse : null
  const listing = useMemo(
    () => buildListingFromResults(hasCurrentResults ? catalogProducts : [], currentResponse?.total ?? 0, currentResponse?.brandCount ?? 0, currentResponse?.nextCursor != null),
    [catalogProducts, currentResponse, hasCurrentResults],
  )
  const facets = useMemo(
    () => currentResponse ? catalogFacetsFromSearch(currentResponse.facets, state, sampleData) : EMPTY_CATALOG_FACETS,
    [currentResponse, state, sampleData],
  )

  const idBase = useId()

  const [revealFrom, setRevealFrom] = useState(Infinity)
  const [changed, setChanged] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [draft, setDraft] = useState<CatalogState>(state)
  const rootRef = useRef<HTMLDivElement>(null)
  const inView = useInView(rootRef, { margin: "0px 0px -35% 0px" })

  const navigate = useCallback(
    (next: CatalogState) => {
      const qs = serializeCatalogParams(next, scope)
      window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname)
    },
    [pathname, scope],
  )

  const resultsRef = useRef<HTMLDivElement>(null)

  /** Any change to what is listed starts again from page 1, with the results top in view. */
  const apply = useCallback(
    (next: CatalogState) => {
      setRevealFrom(Infinity)
      setChanged(true)
      setLoadedNote("")
      navigate({ ...next, page: 1 })
      const top = resultsRef.current?.getBoundingClientRect().top ?? 0
      if (top < 0) {
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
        window.scrollTo({ top: window.scrollY + top - 96, behavior: reduce ? "auto" : "smooth" })
      }
    },
    [navigate],
  )

  const patch = (p: FilterPatch) => apply({ ...state, ...p })
  const onSearch = useCallback((q: string) => apply({ ...parseCatalogParams(new URLSearchParams(window.location.search), scope), q }), [apply, scope])
  const clearAll = () => apply({ ...emptyState(scope), sort: state.sort })
  const clearPanel = () => patch(NO_PANEL_FILTERS)

  // "Load more" appends below the button's old place; keyboard focus moves to the first new card.
  const gridRef = useRef<HTMLDivElement>(null)
  const [focusFrom, setFocusFrom] = useState<number | null>(null)
  useEffect(() => {
    if (focusFrom === null) return
    const link = gridRef.current?.querySelector<HTMLElement>(`[data-index="${focusFrom}"] a[href]`)
    if (link) {
      link.focus({ preventScroll: true })
      setFocusFrom(null)
    }
  }, [focusFrom, listing.cardCount])

  function loadMore() {
    const after = listing.shown + listing.nextCount
    setRevealFrom(listing.cardCount)
    setFocusFrom(listing.cardCount)
    setLoadedNote(`${listing.nextCount} more ${listing.nextCount === 1 ? "piece" : "pieces"} loaded. Showing ${after} of ${listing.total}.`)
    navigate({ ...state, page: state.page + 1 })
  }

  /** Desktop: the panel has ~35 tab stops, so a skip link jumps straight to the results. */
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null)
  function skipToResults(e: React.MouseEvent) {
    e.preventDefault()
    resultsHeadingRef.current?.focus()
  }

  function openSheet() {
    setDraft(state)
    setSheetOpen(true)
  }

  const cat = category ? categoryBySlug.get(category)! : undefined
  const activeCount = activeFilterCount(state, scope)
  const panelCount = panelFilterCount(state)
  const signature = serializeCatalogParams({ ...state, page: 1 }, scope)
  const availableCategories = new Set(currentResponse?.facets.categories.map((facet) => facet.value) ?? categories.map((item) => item.slug))

  /* ---------- active-filter chips ---------- */
  // Each chip carries the change that removes it; the click handler applies it.
  const chips: { key: string; label: string; without: FilterPatch }[] = []
  if (state.q) chips.push({ key: "q", label: `“${state.q}”`, without: { q: "" } })
  if (state.category && !scope.category) chips.push({ key: "category", label: categoryBySlug.get(state.category)!.name, without: { category: undefined, sub: undefined } })
  if (state.sub) chips.push({ key: "sub", label: state.sub, without: { sub: undefined } })
  for (const h of state.brands) chips.push({ key: `b-${h}`, label: facets.brandFacet.find(({ brand }) => brand.handle === h)?.brand.name ?? catalogProducts.find((p) => p.brandSummary?.handle === h)?.brandSummary?.name ?? unknownBrandLabel(h), without: { brands: state.brands.filter((x) => x !== h) } })
  if (state.min !== undefined || state.max !== undefined) chips.push({ key: "price", label: priceLabel(state.min, state.max, currency), without: { min: undefined, max: undefined } })
  for (const s of state.sizes) chips.push({ key: `s-${s}`, label: sizeChipLabel(s), without: { sizes: state.sizes.filter((x) => x !== s) } })
  if (state.inStock) chips.push({ key: "stock", label: "In stock", without: { inStock: false } })
  if (state.country) chips.push({ key: "country", label: `Brands from ${countries[state.country].name}`, without: { country: undefined } })

  const shown = listing.shown
  const progress = listing.total ? shown / listing.total : 0
  const empty = !requestLoading && !catalogError && hasCurrentResults && listing.total === 0 ? emptyAdvice(state, scope, activeCount, panelCount, cat?.name) : null
  // An empty shelf with nothing to filter: no filter panel, no "0 pieces" toolbar, no sort.
  const bareShelf = empty?.action === "joining"

  return (
    <div ref={rootRef}>
      {/* Search and the category (or subcategory) chips */}
      <div className="flex flex-col gap-5">
        <CatalogSearch
          value={state.q}
          onCommit={onSearch}
          state={state}
          currency={currency}
          label={cat ? `Search ${cat.name}` : "Search the shop"}
          placeholder={cat ? `Search ${cat.name.toLowerCase()}` : "Search pieces, brands and materials"}
          className="md:max-w-xl"
        />
        {/* One choice at a time: a radio group (one tab stop, arrow keys move the choice). The
            vertical padding keeps focus rings clear of the rail's scroll clipping on phones. */}
        <ChipRadioGroup
          label={cat ? `${cat.name} subcategories` : "Categories"}
          className="rail -mx-4 -my-1 flex scroll-px-4 gap-2 overflow-x-auto px-4 py-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0"
        >
          {cat ? (
            <>
              <Chip radio selected={!state.sub} layoutId="catalog-sub" onClick={() => state.sub && patch({ sub: undefined })}>
                All {cat.name.toLowerCase()}
              </Chip>
              {cat.subcategories.map((s) => (
                <Chip key={s} radio selected={state.sub === s} layoutId="catalog-sub" onClick={() => state.sub !== s && patch({ sub: s })}>
                  {s}
                </Chip>
              ))}
            </>
          ) : (
            <>
              <Chip radio selected={!state.category} layoutId="catalog-category" onClick={() => state.category && patch({ category: undefined, sub: undefined })}>
                All
              </Chip>
              {categories.filter((c) => availableCategories.has(c.slug)).map((c) => (
                <Chip key={c.slug} radio selected={state.category === c.slug} layoutId="catalog-category" onClick={() => state.category !== c.slug && patch({ category: c.slug, sub: undefined })}>
                  {c.name}
                </Chip>
              ))}
            </>
          )}
        </ChipRadioGroup>
      </div>

      <div className={cn("relative mt-8 border-t border-line-soft pt-6 md:mt-10", !bareShelf && "lg:grid lg:grid-cols-[232px_minmax(0,1fr)] lg:gap-10 xl:gap-14")}>
        {/* Desktop: visible on keyboard focus only, out of the grid's flow. */}
        <a
          href={`#${idBase}-results`}
          onClick={skipToResults}
          className="pointer-events-none absolute top-2 left-0 z-20 hidden h-10 items-center rounded-md bg-elevated px-3 text-sm text-ink opacity-0 ring-1 ring-line focus-visible:pointer-events-auto focus-visible:opacity-100 lg:inline-flex"
        >
          Skip to results
        </a>
        {/* Desktop filter panel */}
        <aside className={cn("hidden", !bareShelf && "lg:block")} aria-labelledby="catalog-filters-title">
          <div className="rail sticky top-24 max-h-[calc(100dvh-7rem)] overflow-y-auto pr-1 pb-8">
            <div className="mb-5 flex h-10 items-center justify-between">
              <h2 id="catalog-filters-title" className="text-sm font-medium text-ink">
                Filters
              </h2>
              {panelCount ? (
                <button type="button" onClick={clearPanel} className="-mr-1.5 min-h-9 rounded-md px-1.5 text-sm text-ink-2 transition-colors hover:text-ink">
                  Clear filters
                </button>
              ) : null}
            </div>
            <FilterControls state={state} onChange={patch} currency={currency} facets={facets} />
          </div>
        </aside>

        <section aria-labelledby={`${idBase}-results`} className="min-w-0">
          {/* Toolbar */}
          <div ref={resultsRef} className={cn("flex scroll-mt-28 items-center justify-between gap-3", bareShelf && "sr-only")}>
            <h2 ref={resultsHeadingRef} id={`${idBase}-results`} tabIndex={-1} className="scroll-mt-28 rounded-sm text-sm font-normal text-ink-2 outline-none focus-visible:ring-2 focus-visible:ring-violet focus-visible:ring-offset-4 focus-visible:ring-offset-obsidian" aria-live="polite">
              <span className="tabular text-ink">{hasCurrentResults ? listing.total : "…"}</span> {listing.total === 1 ? "piece" : "pieces"}
              {listing.total ? (
                <span className="hidden sm:inline">
                  {" "}
                  from {listing.brandCount} {listing.brandCount === 1 ? "brand" : "brands"}
                </span>
              ) : null}
            </h2>
            {/* Phones sort in the "Filter and sort" sheet, so the page has one sort control per size. */}
            <Select value={state.sort} onValueChange={(v) => patch({ sort: v as ProductSort })}>
              <SelectTrigger aria-label="Sort" className="hidden h-11 min-w-44 rounded-md border-line bg-surface px-3 text-sm transition-colors hover:border-ink-3/60 data-[size=default]:h-11 lg:flex">
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
                    transition={spring.snappy}
                    aria-label={`Remove filter ${c.label}`}
                    className="inline-flex h-9 max-w-full items-center gap-1.5 rounded-full border border-purple/45 bg-purple/15 pr-2.5 pl-3 text-[0.8125rem] text-ink transition-colors duration-150 hover:border-violet hover:bg-purple/25 active:scale-[0.97] lg:h-8"
                  >
                    <span className="truncate">{c.label}</span>
                    <X className="size-3.5 shrink-0 text-ink-2" aria-hidden />
                  </motion.button>
                ))}
              </AnimatePresence>
              {chips.length > 1 ? (
                <button type="button" onClick={clearAll} className="h-9 rounded-md px-2 text-[0.8125rem] text-violet underline-offset-4 hover:underline lg:h-8">
                  Clear all
                </button>
              ) : null}
            </div>
          ) : null}

          {/* Results */}
          <motion.div
            key={signature}
            ref={gridRef}
            className="mt-6"
            initial={changed ? { opacity: 0 } : false}
            animate={{ opacity: 1 }}
            transition={{ duration: duration.page, ease: ease.out }}
          >
            {requestLoading && !hasCurrentResults ? (
              <div role="status" aria-label="Loading pieces" aria-busy="true" className="grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-4 md:grid-cols-3">
                {Array.from({ length: 6 }, (_, i) => (
                  <ProductCardSkeleton key={i} />
                ))}
              </div>
            ) : catalogError ? (
              <div role="alert" className="rounded-md border border-line-soft px-4 py-10 text-center">
                <p className="text-sm text-ink-2">{catalogError}</p>
                <Button
                  variant="secondary"
                  className="mt-4"
                  onClick={() => {
                    setRequestError(null)
                    setReloadKey((key) => key + 1)
                  }}
                >
                  Try again
                </Button>
              </div>
            ) : listing.total ? (
              <CatalogGrid cycles={listing.cycles} revealFrom={revealFrom} />
            ) : empty ? (
              <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-line-soft bg-card px-6 py-14 text-center md:py-20">
                <span className="inline-flex size-14 items-center justify-center rounded-full border border-line">
                  {bareShelf ? <StorefrontIcon className="size-6 text-ink-2" aria-hidden /> : <SearchX className="size-6 text-ink-2" />}
                </span>
                <div>
                  <p className="text-base text-ink">{empty.title}</p>
                  <p className="mx-auto mt-1 max-w-sm text-pretty text-sm text-ink-2">{empty.reason}</p>
                </div>
                {empty.action === "shop" ? (
                  <Button asChild variant="primary">
                    <Link href={`/shop?q=${encodeURIComponent(state.q)}`}>Search the whole shop</Link>
                  </Button>
                ) : empty.action === "category" ? (
                  <Button variant="primary" onClick={() => patch({ category: scope.category, sub: undefined })}>
                    {cat ? `Search all ${cat.name.toLowerCase()}` : "Search all categories"}
                  </Button>
                ) : empty.action === "panel" ? (
                  <Button variant="primary" onClick={clearPanel}>
                    Clear filters
                  </Button>
                ) : empty.action === "search" ? (
                  <Button variant="primary" onClick={() => patch({ q: "" })}>
                    Clear search
                  </Button>
                ) : empty.action === "joining" ? (
                  <div className="flex w-full flex-col items-stretch justify-center gap-2 sm:w-auto sm:flex-row sm:items-center">
                    <Button asChild variant="primary">
                      <Link href="/drops">See upcoming drops</Link>
                    </Button>
                    <Button asChild variant="secondary">
                      <Link href="/brands">Browse brands</Link>
                    </Button>
                  </div>
                ) : (
                  <Button variant="primary" onClick={clearAll}>
                    Clear all filters
                  </Button>
                )}
              </div>
            ) : null}
          </motion.div>

          {/* Pagination */}
          {listing.total > 0 ? (
            <div className="mt-14 flex flex-col items-center gap-4 md:mt-16">
              <p className="text-sm text-ink-2 tabular">
                {listing.hasMore ? `Showing ${shown} of ${listing.total}` : listing.total > 1 ? `That's all ${listing.total} pieces` : "That's the only piece"}
              </p>
              <p className="sr-only" aria-live="polite">
                {loadedNote}
              </p>
              {listing.pages > 1 ? (
                <div className="h-0.5 w-48 overflow-hidden rounded-full bg-line" aria-hidden>
                  <motion.div className="h-full origin-left bg-violet" initial={false} animate={{ scaleX: progress }} transition={{ duration: duration.chart, ease: ease.out }} />
                </div>
              ) : null}
              {listing.hasMore && state.page >= MAX_CATALOG_PAGES ? (
                <p className="max-w-sm text-center text-pretty text-sm text-ink-2">That&apos;s as far as the shop pages. Narrow your search or add a filter to see the rest.</p>
              ) : listing.hasMore ? (
                <Button variant="secondary" size="lg" onClick={loadMore} disabled={requestLoading} className="mt-2 min-w-48">
                  Load {listing.nextCount} more
                </Button>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>

      {/* Phone: a floating glass pill opens the filter sheet. It stays mounted while the sheet is
          open (under its overlay) so closing the sheet returns focus to it. */}
      <AnimatePresence>
        {(inView && !bareShelf) || sheetOpen ? (
          <motion.div
            className="pointer-events-none fixed inset-x-0 bottom-(--tabbar-clear) z-30 flex justify-center lg:hidden"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={spring.snappy}
          >
            <button
              type="button"
              onClick={openSheet}
              aria-haspopup="dialog"
              aria-label={panelCount ? `Filter and sort, ${panelCount} active` : undefined}
              className="glass glass-sheen pointer-events-auto inline-flex h-12 items-center gap-2.5 rounded-full pr-4 pl-5 text-sm font-medium text-ink transition-transform duration-100 active:scale-[0.97]"
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
        onClear={() => setDraft((d) => ({ ...d, ...NO_PANEL_FILTERS }))}
        onApply={() => {
          apply(draft)
          setSheetOpen(false)
        }}
        currency={currency}
        initialFacets={facets}
      />
    </div>
  )
}

type EmptyAdvice = { title: string; reason: string; action: "shop" | "category" | "panel" | "search" | "all" | "joining" }

/** No search and no panel filter: an empty result is an empty shelf, not a filter that hides everything. */
const isUnfilteredEmpty = (state: CatalogState, panelCount: number) => !state.q && panelCount === 0

/**
 * What to say when nothing matches, and the one action most likely to bring pieces back:
 * filters that hide every match are cleared on their own; a search narrowed to one category
 * that matches elsewhere widens to all of them (or, on a category page, opens the whole shop);
 * otherwise the search, or everything, is cleared.
 */
function emptyAdvice(state: CatalogState, scope: CatalogScope, activeCount: number, panelCount: number, categoryName?: string): EmptyAdvice {
  // Nothing searched and no filter set, yet nothing here: the shelf itself is empty (brands are
  // still joining), so there is nothing to clear. Say so, and point at drops and brands instead.
  if (isUnfilteredEmpty(state, panelCount)) {
    const shelf = state.sub ?? (state.category ? categoryBySlug.get(state.category)?.name : undefined) ?? categoryName
    return {
      title: shelf ? `No ${shelf.toLowerCase()} pieces yet` : "No pieces yet",
      reason: "Brands are joining Yard. Their pieces appear here the day they open; follow along with upcoming drops.",
      action: "joining",
    }
  }
  if (panelCount) {
    const priced = state.min !== undefined || state.max !== undefined
    return {
      title: "Nothing matches those filters",
      reason: priced ? "Try removing one filter or widening the price range." : "Try removing one filter.",
      action: "panel",
    }
  }
  if (state.q && !panelCount) {
    const narrowed = Boolean(state.sub || (state.category && !scope.category))
    if (narrowed) {
      const narrowedTo = state.sub ?? categoryBySlug.get(state.category!)!.name
      return {
        title: `No ${narrowedTo.toLowerCase()} matches “${state.q}”`,
        reason: `Try searching ${categoryName ? `all of ${categoryName.toLowerCase()}` : "other categories"}.`,
        action: "category",
      }
    }
    if (scope.category && categoryName) {
      return {
        title: `No ${categoryName.toLowerCase()} matches “${state.q}”`,
        reason: "Try searching the whole shop.",
        action: "shop",
      }
    }
    if (activeCount === 1) return { title: `No pieces match “${state.q}”`, reason: "Try a brand name, a material or a simpler word.", action: "search" }
  }
  return { title: "Nothing matches those filters", reason: "Try removing a filter or a word from your search.", action: "all" }
}
