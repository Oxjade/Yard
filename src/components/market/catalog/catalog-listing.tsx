"use client"

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { MagnifyingGlassMinusIcon as SearchX, SlidersHorizontalIcon as SlidersHorizontal, XIcon as X } from "@phosphor-icons/react"
import { AnimatePresence, motion, useInView } from "motion/react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { countries } from "@/config/markets"
import { ProductCardSkeleton } from "@/components/feedback/skeletons"
import { useHydrated } from "@/hooks/use-hydrated"
import { loadPublicCatalog } from "@/lib/api/catalog-products"
import { registerLiveProducts } from "@/lib/api/live-catalog"
import { brandByHandle, categories, categoryBySlug, searchProducts, type ProductSort } from "@/lib/data"
import { duration, ease, spring } from "@/lib/motion"
import { useSession } from "@/lib/stores/session"
import type { CategorySlug, Product } from "@/lib/data/types"
import { CatalogGrid } from "./catalog-grid"
import { CatalogSearch } from "./catalog-search"
import {
  activeFilterCount,
  buildListing,
  emptyState,
  filterProducts,
  panelFilterCount,
  parseCatalogParams,
  serializeCatalogParams,
  sizeChipLabel,
  sortOptions,
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
 * useSearchParams, so this must render inside <Suspense>. The catalogue is filtered in the
 * browser, so changes are written with history.replaceState (which Next keeps in sync with
 * useSearchParams) rather than a router navigation: no server round trip per click.
 */
export function CatalogListing({ category, initialProducts, initialComplete = false }: { category?: CategorySlug; initialProducts?: Product[]; initialComplete?: boolean }) {
  const scope: CatalogScope = useMemo(() => ({ category }), [category])
  const pathname = usePathname()
  const params = useSearchParams()
  // The server renders the first page (initialProducts), so the HTML has products; the rest of the
  // catalogue loads in the browser unless that page was already all of it.
  const [catalogProducts, setCatalogProducts] = useState<Product[]>(() => initialProducts ?? [])
  const [catalogLoaded, setCatalogLoaded] = useState(!!initialProducts)
  /** The whole catalogue is in (counts and facets are final). */
  const [catalogComplete, setCatalogComplete] = useState(!!initialProducts && initialComplete)
  const [catalogError, setCatalogError] = useState(false)
  /** The browser's load has finished (or wasn't needed), so an empty result is final. */
  const [catalogSettled, setCatalogSettled] = useState(!!initialProducts && initialComplete)
  const [reloadKey, setReloadKey] = useState(0)
  const knownBrandHandles = useMemo(() => [...new Set(catalogProducts.flatMap((p) => (p.brandSummary ? [p.brandSummary.handle] : [])))], [catalogProducts])
  const state = useMemo(() => parseCatalogParams(params, scope, knownBrandHandles), [params, scope, knownBrandHandles])
  const listing = useMemo(() => buildListing(state, catalogProducts), [state, catalogProducts])

  useEffect(() => {
    if (initialProducts) registerLiveProducts(initialProducts)
  }, [initialProducts])

  useEffect(() => {
    if (catalogComplete) return
    let active = true
    loadPublicCatalog()
      .then((products) => {
        if (!active) return
        // Quick add from the grid can then show a live-only piece in the bag without another fetch.
        registerLiveProducts(products)
        setCatalogProducts(products)
        setCatalogComplete(true)
      })
      .catch(() => {
        // With the server's first page on screen, keep showing it rather than an error.
        if (active && !initialProducts) setCatalogError(true)
      })
      .finally(() => {
        if (!active) return
        setCatalogLoaded(true)
        setCatalogSettled(true)
      })
    return () => {
      active = false
    }
    // catalogComplete only stops a reload once everything is in; reloadKey retries.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey])

  const idBase = useId()
  const hydrated = useHydrated()
  const shopperCurrency = useSession((s) => s.currency)
  const currency = hydrated ? shopperCurrency : "USD"

  const [revealFrom, setRevealFrom] = useState(Infinity)
  const [changed, setChanged] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [draft, setDraft] = useState<CatalogState>(state)
  // Said once per "Load more" press. The results heading is the live region for filter changes,
  // so the count is never announced twice.
  const [loadedNote, setLoadedNote] = useState("")

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
  const onSearch = useCallback((q: string) => apply({ ...parseCatalogParams(new URLSearchParams(window.location.search), scope, knownBrandHandles), q }), [apply, knownBrandHandles, scope])
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
    navigate({ ...state, page: listing.page + 1 })
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

  /* ---------- active-filter chips ---------- */
  // Each chip carries the change that removes it; the click handler applies it.
  const chips: { key: string; label: string; without: FilterPatch }[] = []
  if (state.q) chips.push({ key: "q", label: `“${state.q}”`, without: { q: "" } })
  if (state.category && !scope.category) chips.push({ key: "category", label: categoryBySlug.get(state.category)!.name, without: { category: undefined, sub: undefined } })
  if (state.sub) chips.push({ key: "sub", label: state.sub, without: { sub: undefined } })
  for (const h of state.brands) chips.push({ key: `b-${h}`, label: brandByHandle.get(h)?.name ?? catalogProducts.find((p) => p.brandSummary?.handle === h)?.brandSummary?.name ?? h, without: { brands: state.brands.filter((x) => x !== h) } })
  if (state.min !== undefined || state.max !== undefined) chips.push({ key: "price", label: priceLabel(state.min, state.max, currency), without: { min: undefined, max: undefined } })
  for (const s of state.sizes) chips.push({ key: `s-${s}`, label: sizeChipLabel(s), without: { sizes: state.sizes.filter((x) => x !== s) } })
  if (state.inStock) chips.push({ key: "stock", label: "In stock", without: { inStock: false } })
  if (state.country) chips.push({ key: "country", label: `Brands from ${countries[state.country].name}`, without: { country: undefined } })

  const shown = listing.shown
  const progress = listing.total ? shown / listing.total : 0
  const empty = catalogLoaded && catalogSettled && listing.total === 0 ? emptyAdvice(state, scope, activeCount, panelCount, cat?.name, catalogProducts) : null

  return (
    <div ref={rootRef}>
      {/* Search and the category (or subcategory) chips */}
      <div className="flex flex-col gap-5">
        <CatalogSearch
          value={state.q}
          onCommit={onSearch}
          state={state}
          products={catalogProducts}
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
              {categories.map((c) => (
                <Chip key={c.slug} radio selected={state.category === c.slug} layoutId="catalog-category" onClick={() => state.category !== c.slug && patch({ category: c.slug, sub: undefined })}>
                  {c.name}
                </Chip>
              ))}
            </>
          )}
        </ChipRadioGroup>
      </div>

      <div className="relative mt-8 border-t border-line-soft pt-6 md:mt-10 lg:grid lg:grid-cols-[232px_minmax(0,1fr)] lg:gap-10 xl:gap-14">
        {/* Desktop: visible on keyboard focus only, out of the grid's flow. */}
        <a
          href={`#${idBase}-results`}
          onClick={skipToResults}
          className="pointer-events-none absolute top-2 left-0 z-20 hidden h-10 items-center rounded-md bg-elevated px-3 text-sm text-ink opacity-0 ring-1 ring-line focus-visible:pointer-events-auto focus-visible:opacity-100 lg:inline-flex"
        >
          Skip to results
        </a>
        {/* Desktop filter panel */}
        <aside className="hidden lg:block" aria-labelledby="catalog-filters-title">
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
            <FilterControls state={state} onChange={patch} currency={currency} products={catalogProducts} />
          </div>
        </aside>

        <section aria-labelledby={`${idBase}-results`} className="min-w-0">
          {/* Toolbar */}
          <div ref={resultsRef} className="flex scroll-mt-28 items-center justify-between gap-3">
            <h2 ref={resultsHeadingRef} id={`${idBase}-results`} tabIndex={-1} className="scroll-mt-28 rounded-sm text-sm font-normal text-ink-2 outline-none focus-visible:ring-2 focus-visible:ring-violet focus-visible:ring-offset-4 focus-visible:ring-offset-obsidian" aria-live="polite">
              <span className="tabular text-ink">{catalogComplete ? listing.total : "…"}</span> {listing.total === 1 ? "piece" : "pieces"}
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
            {!catalogLoaded || (!listing.total && !catalogSettled) ? (
              <div role="status" aria-label="Loading pieces" aria-busy="true" className="grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-4 md:grid-cols-3">
                {Array.from({ length: 6 }, (_, i) => (
                  <ProductCardSkeleton key={i} />
                ))}
              </div>
            ) : catalogError ? (
              <div role="alert" className="rounded-md border border-line-soft px-4 py-10 text-center">
                <p className="text-sm text-ink-2">The shop catalogue couldn’t be loaded.</p>
                <Button
                  variant="secondary"
                  className="mt-4"
                  onClick={() => {
                    setCatalogLoaded(false)
                    setCatalogSettled(false)
                    setCatalogError(false)
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
                  <SearchX className="size-6 text-ink-2" />
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
              {listing.hasMore ? (
                <Button variant="secondary" size="lg" onClick={loadMore} className="mt-2 min-w-48">
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
        {inView || sheetOpen ? (
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
        products={catalogProducts}
      />
    </div>
  )
}

type EmptyAdvice = { title: string; reason: string; action: "shop" | "category" | "panel" | "search" | "all" }

const pieces = (n: number) => `${n} ${n === 1 ? "piece" : "pieces"}`

/**
 * What to say when nothing matches, and the one action most likely to bring pieces back:
 * filters that hide every match are cleared on their own; a search narrowed to one category
 * that matches elsewhere widens to all of them (or, on a category page, opens the whole shop);
 * otherwise the search, or everything, is cleared.
 */
function emptyAdvice(state: CatalogState, scope: CatalogScope, activeCount: number, panelCount: number, categoryName?: string, products?: Product[]): EmptyAdvice {
  if (panelCount) {
    const without = filterProducts({ ...state, ...NO_PANEL_FILTERS }, undefined, products).length
    if (without > 0) {
      const priced = state.min !== undefined || state.max !== undefined
      return {
        title: "Nothing matches those filters",
        reason: `${pieces(without)} without them. ${priced ? "Try removing one, or widen the price range." : "Try removing one."}`,
        action: "panel",
      }
    }
  }
  if (state.q && !panelCount) {
    const narrowed = Boolean(state.sub || (state.category && !scope.category))
    if (narrowed) {
      const wider = filterProducts({ ...state, category: scope.category, sub: undefined }, undefined, products).length
      if (wider > 0) {
        const narrowedTo = state.sub ?? categoryBySlug.get(state.category!)!.name
        return {
          title: `No ${narrowedTo.toLowerCase()} matches “${state.q}”`,
          reason: `${pieces(wider)} ${wider === 1 ? "matches" : "match"} in ${categoryName ? `all of ${categoryName.toLowerCase()}` : "other categories"}.`,
          action: "category",
        }
      }
    }
    if (scope.category && categoryName) {
      const elsewhere = products ? filterProducts({ ...state, category: undefined, sub: undefined }, undefined, products).length : searchProducts({ q: state.q }).length
      if (elsewhere > 0) {
        return {
          title: `No ${categoryName.toLowerCase()} matches “${state.q}”`,
          reason: `${pieces(elsewhere)} ${elsewhere === 1 ? "matches" : "match"} elsewhere in the shop.`,
          action: "shop",
        }
      }
    }
    if (activeCount === 1) return { title: `No pieces match “${state.q}”`, reason: "Try a brand name, a material or a simpler word.", action: "search" }
  }
  return { title: "Nothing matches those filters", reason: "Try removing a filter or a word from your search.", action: "all" }
}
