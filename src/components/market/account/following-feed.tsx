"use client"

import { useMemo, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { ArrowUpRightIcon as ArrowUpRight, RssIcon as Rss } from "@phosphor-icons/react"
import { AnimatePresence, motion } from "motion/react"
import { BrandCard } from "@/components/market/brand-card"
import { BrandMark } from "@/components/market/brand-mark"
import { Chip } from "@/components/market/catalog/chip"
import { DropCard } from "@/components/market/drop-card"
import { StoryCard } from "@/components/market/editorial/story-card"
import { ProductCard } from "@/components/market/product-card"
import { SectionHeader } from "@/components/market/section-header"
import { Button } from "@/components/ui/button"
import { brandById, recommendBrands } from "@/lib/data"
import { useSaved } from "@/lib/stores/saved"
import { useSession } from "@/lib/stores/session"
import type { Brand } from "@/lib/data/types"
import { buildFeed, type FeedItem, type FeedKind } from "./feed"
import { dayBucket, relativeDay } from "./format"
import { YouNav } from "./you-nav"

type Filter = "all" | FeedKind

const filterLabels: Record<Filter, string> = {
  all: "All updates",
  products: "New pieces",
  collection: "Collections",
  drop: "Drops",
  story: "Stories",
}

const PAGE = 10

function verb(item: FeedItem) {
  switch (item.kind) {
    case "products":
      return item.products.length === 1 ? "added a new piece" : `added ${item.products.length} new pieces`
    case "collection":
      return "published a collection"
    case "drop":
      return item.event === "announced" ? "announced a drop" : item.event === "live" ? "has a drop live now" : "released a drop"
    case "story":
      return "published a story"
  }
}

function FeedCard({ item }: { item: FeedItem }) {
  const brand = brandById.get(item.brandId)!
  return (
    <article className="rounded-lg border border-line-soft bg-card p-4 md:p-5">
      <header className="flex items-center gap-3">
        <Link href={`/brands/${brand.handle}`} aria-label={brand.name} className="shrink-0">
          <BrandMark brand={brand} size="sm" />
        </Link>
        <p className="min-w-0 flex-1 text-sm text-ink-2">
          <Link href={`/brands/${brand.handle}`} className="text-ink transition-colors hover:text-violet">{brand.name}</Link> {verb(item)}
        </p>
        <time dateTime={item.at} className="shrink-0 text-xs text-ink-3">{relativeDay(item.at)}</time>
      </header>
      <div className="mt-4">
        <FeedBody item={item} brand={brand} />
      </div>
    </article>
  )
}

function FeedBody({ item, brand }: { item: FeedItem; brand: Brand }) {
  if (item.kind === "products" && item.products.length === 1) {
    const p = item.products[0]
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-[minmax(0,240px)_minmax(0,1fr)] sm:gap-6">
        <ProductCard product={p} variant="compact" sizes="(min-width: 640px) 240px, 45vw" />
        <div className="min-w-0 sm:pt-1">
          <p className="text-xs text-violet">New in {p.subcategory.toLowerCase()}</p>
          <p className="mt-2 line-clamp-5 text-sm leading-relaxed text-ink-2 sm:line-clamp-4">{p.description}</p>
          <Link href={`/products/${p.slug}`} className="mt-4 inline-flex items-center gap-1 text-sm text-ink transition-colors hover:text-violet">
            View the piece
            <ArrowUpRight className="size-4" aria-hidden />
          </Link>
        </div>
      </div>
    )
  }
  if (item.kind === "products") {
    const shown = item.products.slice(0, 4)
    return (
      <>
        <div className="grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-4 md:grid-cols-4">
          {shown.map((p) => (
            <ProductCard key={p.id} product={p} variant="compact" sizes="(min-width: 768px) 18vw, 45vw" />
          ))}
        </div>
        {item.products.length > shown.length ? (
          <Link href={`/brands/${brand.handle}`} className="mt-4 inline-flex items-center gap-1 text-sm text-violet underline-offset-4 hover:underline">
            {item.products.length - shown.length} more from {brand.name}
          </Link>
        ) : null}
      </>
    )
  }
  if (item.kind === "collection") {
    const c = item.collection
    return (
      <Link href={`/brands/${brand.handle}/collections/${c.handle}`} className="group relative isolate flex min-h-[220px] flex-col justify-end overflow-hidden rounded-md bg-surface p-4 md:min-h-[280px] md:p-6">
        <Image src={c.image.src} alt={c.image.alt} fill sizes="(min-width: 1024px) 60vw, 100vw" className="-z-10 object-cover transition-transform duration-[900ms] ease-out-quint group-hover:scale-[1.04]" />
        <span className="scrim-b absolute inset-0 -z-10" aria-hidden />
        <h3 className="font-display text-display-sm text-ink">{c.name}</h3>
        <p className="mt-2 max-w-md text-sm text-ink/80">{c.description}</p>
        <p className="mt-3 inline-flex items-center gap-1 text-xs text-ink-2">
          {item.products.length} {item.products.length === 1 ? "piece" : "pieces"}, at {brand.name}
          <ArrowUpRight className="size-3.5" aria-hidden />
        </p>
      </Link>
    )
  }
  if (item.kind === "drop") {
    return <DropCard drop={item.drop} layout="wide" className="border-line-soft" />
  }
  return <StoryCard story={item.story} variant="lead" as="h3" />
}

/** The Following feed: chronological updates from followed brands, filterable by type. */
export function FollowingFeed() {
  const following = useSaved((s) => s.following)
  const interests = useSession((s) => s.interests)
  const [filter, setFilter] = useState<Filter>("all")
  const [limit, setLimit] = useState(PAGE)

  const feed = useMemo(() => buildFeed(following), [following])
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: feed.length, products: 0, collection: 0, drop: 0, story: 0 }
    for (const i of feed) c[i.kind] += 1
    return c
  }, [feed])
  const filtered = filter === "all" ? feed : feed.filter((i) => i.kind === filter)
  const shown = filtered.slice(0, limit)
  const followedBrands = following.map((id) => brandById.get(id)).filter((b): b is Brand => !!b)
  // Suggestions are worked out once per visit so a brand doesn't vanish the moment it's followed.
  const [suggested] = useState(() => recommendBrands({ interests, following }, following.length ? 3 : 4))

  const groups: { label: string; items: FeedItem[] }[] = []
  for (const item of shown) {
    const label = dayBucket(item.at)
    const last = groups.at(-1)
    if (last?.label === label) last.items.push(item)
    else groups.push({ label, items: [item] })
  }

  const header = (
    <header>
      <p className="text-sm text-violet">Your World</p>
      <h1 className="mt-2 font-display text-display-lg text-ink">Following</h1>
      <p className="mt-4 max-w-xl text-pretty text-[0.9375rem] leading-relaxed text-ink-2">
        {followedBrands.length
          ? `New pieces, collections, drops and stories from the ${followedBrands.length === 1 ? "brand" : `${followedBrands.length} brands`} you follow, newest first.`
          : "Updates from the brands you follow, in the order they happen."}
      </p>
    </header>
  )

  if (!followedBrands.length) {
    return (
      <>
        {header}
        <YouNav className="mt-8" />
        <div className="mt-12 flex flex-col items-center gap-4 rounded-lg border border-line-soft bg-card px-6 py-16 text-center">
          <span className="inline-flex size-14 items-center justify-center rounded-full border border-line">
            <Rss className="size-6 text-ink-2" />
          </span>
          <div>
            <p className="text-base text-ink">You&apos;re not following any brands yet</p>
            <p className="mt-1 max-w-md text-sm text-ink-2">Follow a few and their new pieces, collections, drops and stories land here, newest first.</p>
          </div>
          <Button asChild variant="primary">
            <Link href="/brands">Browse brands</Link>
          </Button>
        </div>
        <section aria-labelledby="start-title" className="mt-24 md:mt-32">
          <div id="start-title">
            <SectionHeader title="Brands to start with" description="Picked from your interests, with room for studios that are growing fast." href="/brands" action="All brands" />
          </div>
          <div className="rail -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 *:w-[78vw] *:shrink-0 *:snap-start sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-0 sm:*:w-auto lg:grid-cols-4">
            {suggested.map((b) => (
              <BrandCard key={b.id} brand={b} showProducts />
            ))}
          </div>
        </section>
      </>
    )
  }

  return (
    <>
      {header}
      <YouNav className="mt-8" />
      <div className="mt-10 grid gap-12 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-14 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <div role="radiogroup" aria-label="Show updates" className="rail -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
            {(Object.keys(filterLabels) as Filter[]).map((k) => (
              <Chip
                key={k}
                radio
                selected={filter === k}
                count={counts[k]}
                layoutId="feed-filter"
                onClick={() => {
                  setFilter(k)
                  setLimit(PAGE)
                }}
              >
                {filterLabels[k]}
              </Chip>
            ))}
          </div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={filter} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="mt-8">
              {shown.length === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-lg border border-line-soft bg-card px-6 py-14 text-center">
                  <p className="text-base text-ink">No {filterLabels[filter].toLowerCase()} yet</p>
                  <p className="max-w-sm text-sm text-ink-2">The brands you follow haven&apos;t posted any in the last few months.</p>
                  <Button variant="secondary" size="sm" onClick={() => setFilter("all")}>Show all updates</Button>
                </div>
              ) : (
                <div className="grid gap-10">
                  {groups.map((g) => (
                    <section key={g.label} aria-label={g.label}>
                      <h2 className="mb-4 text-sm text-ink-3">{g.label}</h2>
                      <div className="grid gap-4">
                        {g.items.map((item) => (
                          <FeedCard key={item.id} item={item} />
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              )}
              {filtered.length > shown.length ? (
                <div className="mt-8 flex justify-center">
                  <Button variant="secondary" onClick={() => setLimit((n) => n + PAGE)}>
                    Show more updates
                  </Button>
                </div>
              ) : shown.length ? (
                <p className="mt-8 text-center text-xs text-ink-3">That&apos;s everything from the last few months.</p>
              ) : null}
            </motion.div>
          </AnimatePresence>
        </div>

        <aside className="grid content-start gap-10 lg:sticky lg:top-28 lg:self-start">
          <section aria-labelledby="followed-title">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 id="followed-title" className="text-sm font-medium text-ink">You follow</h2>
              <span className="text-xs text-ink-3 tabular">{followedBrands.length}</span>
            </div>
            <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-1">
              {followedBrands.map((b) => (
                <BrandCard key={b.id} brand={b} variant="row" />
              ))}
            </div>
          </section>
          {suggested.length ? (
            <section aria-labelledby="suggested-title">
              <h2 id="suggested-title" className="mb-1 text-sm font-medium text-ink">Suggested for you</h2>
              <p className="mb-3 text-xs text-ink-2">From your interests and fast-growing studios.</p>
              <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-1">
                {suggested.map((b) => (
                  <BrandCard key={b.id} brand={b} variant="row" />
                ))}
              </div>
            </section>
          ) : null}
        </aside>
      </div>
    </>
  )
}
