"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { RssIcon as Rss } from "@phosphor-icons/react"
import { BrandsJoining } from "@/components/market/brands/brands-joining"
import { LiveBrandCard } from "@/components/market/brands/live-brand-card"
import { EmptyCard } from "@/components/market/editorial/empty-card"
import { FollowButton } from "@/components/market/follow-button"
import { ProductCard } from "@/components/market/product-card"
import { SectionHeader } from "@/components/market/section-header"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api/client"
import { toCatalogProduct, type PublicCatalogPage } from "@/lib/api/catalog-products"
import { registerLiveProducts } from "@/lib/api/live-catalog"
import { fetchPublicBrands, type PublicBrandCard } from "@/lib/api/public-brands"
import type { Product } from "@/lib/data/types"
import { useSaved } from "@/lib/stores/saved"
import { YouNav } from "./you-nav"

type Follow = { brandId: string; handle: string; name: string; city: string; country: string; followedAt: string }

const PER_BRAND = 6
const PAGE = 12
const MAX_BRANDS = 24

/**
 * Production /following: the shopper's follows from the server (GET /api/follows) and the newest
 * pieces those brands published (GET /api/catalog/products per brand), newest first, paged with
 * "Show more". Suggestions are listed brands from the server, never the sample brands. With no
 * follows, or follows that haven't posted yet, a deliberate empty state.
 */
export function LiveFollowingFeed() {
  const following = useSaved((s) => s.following)
  const [follows, setFollows] = useState<Follow[] | null>(null)
  const [pieces, setPieces] = useState<Product[] | null>(null)
  const [suggested, setSuggested] = useState<PublicBrandCard[] | null>(null)
  const [error, setError] = useState(false)
  const [limit, setLimit] = useState(PAGE)
  const [attempt, setAttempt] = useState(0)
  const key = following.join(",")

  useEffect(() => {
    let live = true
    ;(async () => {
      const { items } = await api<{ items: Follow[] }>("/api/follows")
      if (!live) return
      setFollows(items)
      const pages = await Promise.all(
        items.slice(0, MAX_BRANDS).map((f) => api<PublicCatalogPage>("/api/catalog/products", { query: { brand: f.brandId, sort: "new", limit: String(PER_BRAND) } }).catch(() => null)),
      )
      if (!live) return
      const products = pages.flatMap((p) => (p ? p.products.map(toCatalogProduct) : []))
      registerLiveProducts(products)
      products.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      setPieces(products)
    })().catch(() => {
      if (live) setError(true)
    })
    return () => {
      live = false
    }
  }, [key, attempt])

  useEffect(() => {
    const ctrl = new AbortController()
    fetchPublicBrands({ sort: "new", limit: 8 }, { signal: ctrl.signal })
      .then((p) => setSuggested(p.brands))
      .catch(() => {
        if (!ctrl.signal.aborted) setSuggested([])
      })
    return () => ctrl.abort()
  }, [])

  const followedIds = new Set([...(follows ?? []).map((f) => f.brandId), ...following])
  const suggestions = (suggested ?? []).filter((b) => !followedIds.has(b.id)).slice(0, 4)

  const header = (
    <header>
      <p className="text-sm text-violet">Your World</p>
      <h1 className="mt-2 font-display text-display-lg text-ink">Following</h1>
      <p className="mt-4 max-w-xl text-pretty text-[0.9375rem] leading-relaxed text-ink-2">
        {follows?.length
          ? `New pieces from the ${follows.length === 1 ? "brand" : `${follows.length} brands`} you follow, newest first.`
          : "Updates from the brands you follow, in the order they happen."}
      </p>
    </header>
  )

  const suggestionsBlock =
    suggested === null ? null : suggestions.length ? (
      <section aria-labelledby="start-title" className="mt-24 md:mt-32">
        <div id="start-title">
          <SectionHeader title={follows?.length ? "More brands on Yard" : "Brands to start with"} description="Independent studios with their own storefront on Yard." href="/brands" action="All brands" />
        </div>
        <ul className="rail -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 *:w-[78vw] *:shrink-0 *:snap-start sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-0 sm:*:w-auto lg:grid-cols-4">
          {suggestions.map((b) => (
            <li key={b.id} className="flex min-w-0 flex-col gap-2">
              <LiveBrandCard brand={b} />
              <FollowButton brandId={b.id} brandName={b.name} className="w-full" />
            </li>
          ))}
        </ul>
      </section>
    ) : !follows?.length && suggested.length === 0 ? (
      <BrandsJoining compact className="mt-12" />
    ) : null

  if (error) {
    return (
      <>
        {header}
        <YouNav className="mt-8" />
        <EmptyCard
          className="mt-12"
          icon={<Rss />}
          title="Your feed couldn't be loaded"
          reason="Check your connection and try again."
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setError(false)
                setAttempt((n) => n + 1)
              }}
            >
              Retry
            </Button>
          }
        />
      </>
    )
  }

  if (follows === null) {
    return (
      <>
        {header}
        <YouNav className="mt-8" />
        <div className="mt-12 grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-4 md:grid-cols-4" aria-busy aria-label="Loading your feed">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="aspect-[4/5] animate-pulse rounded-lg bg-surface" />
          ))}
        </div>
      </>
    )
  }

  if (!follows.length) {
    return (
      <>
        {header}
        <YouNav className="mt-8" />
        <EmptyCard
          className="mt-12"
          icon={<Rss />}
          title="You're not following any brands yet"
          reason="Follow a few and their new pieces land here, newest first."
          action={
            <Button asChild variant="primary">
              <Link href="/brands">Browse brands</Link>
            </Button>
          }
        />
        {suggestionsBlock}
      </>
    )
  }

  const shown = (pieces ?? []).slice(0, limit)
  return (
    <>
      {header}
      <YouNav className="mt-8" />
      <div className="mt-10 grid grid-cols-[minmax(0,1fr)] gap-12 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-14 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          {pieces === null ? (
            <div className="grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-4 md:grid-cols-3" aria-busy aria-label="Loading new pieces">
              {Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="aspect-[4/5] animate-pulse rounded-lg bg-surface" />
              ))}
            </div>
          ) : shown.length ? (
            <>
              <h2 className="sr-only">New pieces</h2>
              <ul className="grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-4 md:grid-cols-3">
                {shown.map((p) => (
                  <li key={p.id} className="min-w-0">
                    <ProductCard product={p} sizes="(min-width: 768px) 22vw, 50vw" />
                  </li>
                ))}
              </ul>
              {pieces.length > limit ? (
                <div className="mt-8 flex justify-center">
                  <Button variant="secondary" onClick={() => setLimit((n) => n + PAGE)}>
                    Show more
                  </Button>
                </div>
              ) : null}
            </>
          ) : (
            <EmptyCard icon={<Rss />} title="Brands you follow will post here" reason="Their new pieces appear here the day they're published." />
          )}
        </div>
        <aside aria-labelledby="you-follow-title" className="min-w-0">
          <h2 id="you-follow-title" className="mb-3 text-sm font-medium text-ink">
            You follow
          </h2>
          <ul className="flex flex-col divide-y divide-line-soft rounded-lg border border-line-soft bg-card">
            {follows.map((f) => (
              <li key={f.brandId} className="flex min-w-0 items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <Link href={`/brands/${f.handle}`} className="block truncate text-sm text-ink transition-colors hover:text-violet">
                    {f.name}
                  </Link>
                  <p className="truncate text-xs text-ink-2">{f.city}</p>
                </div>
                <FollowButton brandId={f.brandId} brandName={f.name} size="xs" />
              </li>
            ))}
          </ul>
        </aside>
      </div>
      {suggestionsBlock}
    </>
  )
}
