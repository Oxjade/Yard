"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowRightIcon, MagnifyingGlassIcon as Search, MapPinAreaIcon, RankingIcon, XIcon as X } from "@phosphor-icons/react"
import { AnimatePresence, motion } from "motion/react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { chooseArea } from "@/components/around/around-store"
import { canTakeFocus, useFocusReturn } from "@/components/ui/dialog"
import { browseLinks } from "@/config/site"
import { CHART_SLUGS, chartLabels } from "@/lib/api/contracts/charts"
import { api } from "@/lib/api/client"
import { useApi } from "@/lib/api/use-api"
import { usePageSampleData } from "@/components/sample/sample-data-context"
import { errorMessage } from "@/lib/api/errors"
import { fold, searchAreas } from "@/lib/around/gazetteer"
import { categories } from "@/lib/data"
import { currencies, type CurrencyCode } from "@/config/markets"
import { create } from "zustand"
import { useSession } from "@/lib/stores/session"
import { BrandMark } from "./brand-mark"
import { Price } from "./price"

export const useSearchOverlay = create<{ open: boolean; setOpen: (o: boolean) => void }>((set) => ({ open: false, setOpen: (open) => set({ open }) }))

const isCurrency = (c: string): c is CurrencyCode => c in currencies
/** Demo: searches the sample catalogue answers. Production derives its own from live categories (see liveTries). */
const sampleSuggestions = ["hoodie", "silver", "sneakers", "ceramics", "fragrance", "kente"]
type CategoryCounts = { categories: { slug: string; name: string; productCount: number }[] }
const CATEGORIES_KEY = "/api/catalog/categories"
const getCategoryCounts = () => api<CategoryCounts>(CATEGORIES_KEY, { cache: "default" })
/** Production "Try" chips: the categories that hold public pieces (most first), so every chip finds something. */
const liveTries = (data: CategoryCounts | undefined) =>
  (data?.categories ?? [])
    .filter((c) => c.productCount > 0)
    .sort((a, b) => b.productCount - a.productCount)
    .slice(0, 6)
    .map((c) => c.name.toLowerCase())
type SearchResponse = {
  items: { productId: string; brandId: string; brandName: string; slug: string | null; title: string; image: string | null; display: { amount: number; currency: string } }[]
  brands: { brandId: string; handle: string; name: string; city: string; country: string }[]
}

/** Boards whose name matches the query ("trend" → Trending); "chart" or "charts" lists them all. */
function matchCharts(term: string) {
  const q = fold(term)
  if (!q) return []
  if ("charts".startsWith(q) && q.length >= 4) return CHART_SLUGS.map((slug) => ({ slug, label: chartLabels[slug] }))
  return CHART_SLUGS.filter((slug) => fold(chartLabels[slug]).split(" ").some((w) => w.startsWith(q)) || fold(chartLabels[slug]).startsWith(q)).map((slug) => ({ slug, label: chartLabels[slug] }))
}

/** Where focus goes when whatever opened the overlay has gone: the visible search control (header capsule or the home bar's Explore). */
const searchOpener = () =>
  Array.from(document.querySelectorAll<HTMLElement>('header button[aria-label="Search brands and products"], nav[aria-label="Primary"] button[aria-haspopup="dialog"]')).find(canTakeFocus)

/**
 * Search (⌘K, the header capsule, or Explore in the phone home bar). Empty, it opens on Browse:
 * Charts, Around, Drops, Brands, Shop and Categories as 40px chips (§7.3), then a few searches to
 * try. Typing searches brands, products and categories, plus Cities (the Around gazetteer, which
 * never leaves the device) and Charts (board names). Closing returns focus to what opened it.
 */
export function SearchOverlay() {
  const router = useRouter()
  const open = useSearchOverlay((s) => s.open)
  const setOpen = useSearchOverlay((s) => s.setOpen)
  const [q, setQ] = useState("")
  const sampleData = usePageSampleData()
  const { data: categoryCounts } = useApi(open && !sampleData ? CATEGORIES_KEY : null, getCategoryCounts, { revalidateOnFocus: false })
  const suggestions = sampleData ? sampleSuggestions : liveTries(categoryCounts)
  const currency = useSession((s) => s.currency)
  const [remote, setRemote] = useState<{ term: string; data: SearchResponse } | null>(null)
  const [remoteError, setRemoteError] = useState<{ term: string; message: string } | null>(null)
  const [retry, setRetry] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const focus = useFocusReturn(searchOpener)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setOpen(!useSearchOverlay.getState().open)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [setOpen])

  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) return
    const controller = new AbortController()
    const timeout = window.setTimeout(() => {
      void api<SearchResponse>("/api/search", { query: { q: term, currency, limit: 6 }, signal: controller.signal })
        .then((data) => {
          setRemote({ term, data })
          setRemoteError(null)
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) setRemoteError({ term, message: errorMessage(error, "Search couldn't be loaded.") })
        })
    }, 180)
    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [q, currency, retry])

  const results = useMemo(() => {
    const term = q.trim()
    if (term.length < 2) return null
    const data = remote?.term === term ? remote.data : null
    return {
      products: data?.items ?? [],
      brands: data?.brands ?? [],
      categories: categories.filter((c) => c.name.toLowerCase().includes(term.toLowerCase())).slice(0, 3),
      cities: searchAreas(term, 4),
      charts: matchCharts(term).slice(0, 7),
    }
  }, [q, remote])

  const close = () => setOpen(false)
  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!q.trim()) return
    close()
    router.push(`/shop?q=${encodeURIComponent(q.trim())}`)
  }

  const term = q.trim()
  const loading = term.length >= 2 && remote?.term !== term && remoteError?.term !== term
  const error = remoteError?.term === term ? remoteError.message : null
  const empty = results && !loading && !error && !results.products.length && !results.brands.length && !results.categories.length && !results.cities.length && !results.charts.length
  const chip = "inline-flex h-10 items-center gap-1.5 rounded-full border border-white/10 px-4 text-sm text-ink transition-colors hover:border-white/25 hover:bg-white/6 focus-visible:outline-2 focus-visible:outline-violet"

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <AnimatePresence>
        {open ? (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[8px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            </DialogPrimitive.Overlay>
            <DialogPrimitive.Content
              asChild
              forceMount
              aria-describedby={undefined}
              onOpenAutoFocus={(e) => {
                e.preventDefault()
                inputRef.current?.focus()
              }}
              onCloseAutoFocus={focus.onCloseAutoFocus}
              // The phone home bar stays above the scrim while this is open (§7.2), with Explore in
              // its pressed state: a tap on Explore closes the overlay through its own toggle, so
              // that press doesn't also count as a tap outside (which would close, then reopen).
              onPointerDownOutside={(e) => {
                if (e.target instanceof Element && e.target.closest("[data-search-toggle]")) e.preventDefault()
              }}
            >
              {/* Below lg it ends clear of the home bar and its raised pin, which sit above the scrim. */}
              <motion.div
                className="glass-strong glass-sheen fixed inset-x-2 top-2 z-50 mx-auto flex max-h-[calc(100dvh-var(--tabbar-top)-2.25rem)] max-w-2xl flex-col overflow-hidden rounded-2xl outline-none sm:top-16 sm:max-h-[calc(100dvh-var(--tabbar-top)-5.75rem)] lg:max-h-[calc(100dvh-5rem)]"
                initial={{ opacity: 0, y: -12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.98 }}
                transition={{ type: "spring", stiffness: 500, damping: 38 }}
              >
                {focus.probe}
                <DialogPrimitive.Title className="sr-only">Search</DialogPrimitive.Title>
                <form onSubmit={submit} className="flex shrink-0 items-center gap-3 border-b border-white/8 px-4">
                  <Search className="size-5 shrink-0 text-ink-2" />
                  <input
                    ref={inputRef}
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Brands, products, cities"
                    className="h-14 min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-3"
                    aria-label="Search"
                  />
                  <DialogPrimitive.Close className="-mr-1 inline-flex size-10 shrink-0 items-center justify-center rounded-full text-ink-2 hover:bg-white/8 hover:text-ink" aria-label="Close search">
                    <X className="size-4" />
                  </DialogPrimitive.Close>
                </form>

                <div className="max-h-[70dvh] min-h-0 flex-1 overflow-y-auto p-4">
                  {!results ? (
                    <div className="grid gap-5">
                      <nav aria-labelledby="search-browse">
                        <p id="search-browse" className="text-xs text-ink-3">
                          Browse
                        </p>
                        <ul className="mt-2 flex flex-wrap gap-2">
                          {browseLinks.map((l) => (
                            <li key={l.href}>
                              <Link href={l.href} onClick={close} className={chip}>
                                {l.label}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </nav>
                      {suggestions.length ? (
                      <div>
                        <p className="text-xs text-ink-3">Try</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {suggestions.map((s) => (
                            <button key={s} type="button" onClick={() => setQ(s)} className="h-10 rounded-full border border-white/10 px-3.5 text-sm text-ink-2 transition hover:border-white/25 hover:text-ink sm:h-8 sm:px-3">
                              {s}
                            </button>
                          ))}
                        </div>
                      </div>
                      ) : null}
                    </div>
                  ) : empty ? (
                    <p className="py-8 text-center text-sm text-ink-2">Nothing matches “{q}”. Try a brand name, a city or a material.</p>
                  ) : (
                    <div className="grid gap-5">
                      {/* Cities, charts and categories match on the device, so they stay while brands and products load or fail. */}
                      {loading ? (
                        <p role="status" className="text-sm text-ink-2">
                          Searching the marketplace…
                        </p>
                      ) : error ? (
                        <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-danger">
                          <span className="min-w-0">{error}</span>
                          <button type="button" onClick={() => {
                              setRemoteError(null)
                              setRetry((n) => n + 1)
                            }} className="inline-flex h-10 items-center rounded-md px-2 text-sm text-ink hover:bg-white/6 sm:h-8">
                            Retry
                          </button>
                        </div>
                      ) : null}
                      {results.brands.length ? (
                        <div>
                          <p className="mb-2 text-xs text-ink-3">Brands</p>
                          <ul className="grid gap-1">
                            {results.brands.map((b) => (
                              <li key={b.brandId}>
                                <Link href={`/brands/${b.handle}`} onClick={close} className="flex items-center gap-3 rounded-lg p-2 hover:bg-white/6">
                                  <BrandMark brand={{ name: b.name, mark: { text: b.name.slice(0, 2).toUpperCase(), style: "condensed" } }} size="sm" />
                                  <span className="text-sm text-ink">{b.name}</span>
                                  <span className="text-xs text-ink-2">{b.city}</span>
                                </Link>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {results.products.length ? (
                        <div>
                          <p className="mb-2 text-xs text-ink-3">Products</p>
                          <ul className="grid gap-1 sm:grid-cols-2">
                            {results.products.map((p) => (
                              <li key={p.productId}>
                                <Link href={p.slug ? `/products/${p.slug}` : `/shop?q=${encodeURIComponent(q.trim())}`} onClick={close} className="flex items-center gap-3 rounded-lg p-2 hover:bg-white/6">
                                  <span className="relative size-12 shrink-0 overflow-hidden rounded-md bg-surface">
                                    {p.image ? <Image src={p.image} alt="" fill sizes="48px" className="object-cover" /> : null}
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm text-ink">{p.title}</span>
                                    <span className="block truncate text-xs text-ink-2">{p.brandName}</span>
                                  </span>
                                  {isCurrency(p.display.currency) ? <Price amount={p.display.amount} currency={p.display.currency} className="text-xs" /> : null}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {results.cities.length ? (
                        <div>
                          <p className="mb-2 text-xs text-ink-3">Cities</p>
                          <ul className="grid gap-1">
                            {results.cities.map((c) => (
                              <li key={c.slug}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    close()
                                    chooseArea(c.slug, (href) => router.push(href))
                                  }}
                                  className="flex min-h-10 w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-white/6"
                                >
                                  <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-white/10">
                                    <MapPinAreaIcon className="size-4 text-ink-2" aria-hidden />
                                  </span>
                                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{c.label}</span>
                                  <span className="shrink-0 text-xs text-ink-2">Brands near here on Around</span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {results.charts.length ? (
                        <div>
                          <p className="mb-2 text-xs text-ink-3">Charts</p>
                          <ul className="flex flex-wrap gap-2">
                            {results.charts.map((c) => (
                              <li key={c.slug}>
                                <Link href={`/charts?chart=${c.slug}`} onClick={close} className={chip}>
                                  <RankingIcon className="size-4 text-ink-2" aria-hidden />
                                  {c.label}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {results.categories.length ? (
                        <div>
                          <p className="mb-2 text-xs text-ink-3">Categories</p>
                          <div className="flex flex-wrap gap-2">
                            {results.categories.map((c) => (
                              <Link key={c.slug} href={`/categories/${c.slug}`} onClick={close} className={chip}>
                                {c.name}
                              </Link>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      <button type="submit" onClick={submit} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md border border-white/10 text-sm text-ink-2 hover:bg-white/6 hover:text-ink">
                        See all products for “{q}” <ArrowRightIcon className="size-3.5" aria-hidden />
                      </button>
                    </div>
                  )}
                </div>
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        ) : null}
      </AnimatePresence>
    </DialogPrimitive.Root>
  )
}
