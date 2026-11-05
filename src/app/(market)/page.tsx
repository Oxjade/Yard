import Image from "next/image"
import Link from "next/link"
import { BrandCard } from "@/components/market/brand-card"
import { Countdown, DropStatus } from "@/components/market/countdown"
import { DiscoverHero } from "@/components/market/discover-hero"
import { DropCard } from "@/components/market/drop-card"
import { NotifyButton } from "@/components/market/notify-button"
import { ProductCard } from "@/components/market/product-card"
import { Rail } from "@/components/market/rail"
import { RecommendedForYou } from "@/components/market/recommended"
import { SectionHeader } from "@/components/market/section-header"
import { SponsoredTag } from "@/components/market/sponsored-tag"
import { UndergroundIndex } from "@/components/market/underground-index"
import { withSponsoredSlots } from "@/lib/data/ads"
import {
  brandById,
  curatedCollections,
  emergingBrands,
  getDrop,
  productById,
  recentlyJoinedBrands,
  sponsoredBrands,
  stories,
  trendingBrands,
  trendingProducts,
  upcomingDrops,
} from "@/lib/data"
import { dropAccessLabel } from "@/lib/drops"
import { img } from "@/lib/data/media"
import type { Product } from "@/lib/data/types"

const indexNotes: Record<string, string> = {
  b_paper_riot: "Five illustrators, one risograph and a basement gallery in Braamfontein.",
  b_kumasi_thread: "Kente taken apart strip by strip and rebuilt as outerwear.",
  b_orun_studio: "Benin bronze-casting technique, entirely new forms.",
  b_afterhours_ceramics: "An architect's night shift, in matte black stoneware.",
  b_ferro_club: "Heavy silver from a 90-year-old bench in Centro Histórico.",
  b_dune_apothecary: "A chemist's answer to forty-ingredient serums: eight products, short lists.",
}

const storyKind: Record<string, string> = {
  origins: "Origins",
  "behind-the-scenes": "Behind the scenes",
  "design-process": "Design process",
  "product-launch": "Launch",
  collection: "Collection",
  collaboration: "Collaboration",
}

export default function DiscoverPage() {
  const heroDrop = getDrop("drop-07-third-mainland")!
  const heroBrand = brandById.get(heroDrop.brandId)!
  const heroProducts = heroDrop.productIds.map((id) => productById.get(id)).filter(Boolean) as Product[]
  const spotlightBrand = brandById.get("b_velvet_underpass")!

  const upcoming = upcomingDrops()
  const nextDrop = upcoming[0]
  const nextDropBrand = brandById.get(nextDrop.brandId)!

  const trending = trendingProducts(9)
  const [feature, ...trendingRest] = trending
  const emerging = emergingBrands(4)
  const recent = recentlyJoinedBrands(4)
  const featured = withSponsoredSlots(
    trendingBrands(6).filter((b) => !sponsoredBrands().some((s) => s.id === b.id)).slice(0, 2),
    sponsoredBrands(),
    [1, 3],
  )
  const indexEntries = Object.entries(indexNotes).map(([id, note]) => ({ brand: brandById.get(id)!, note }))
  const [leadCollection, ...otherCollections] = curatedCollections

  return (
    <>
      <DiscoverHero
        brand={heroBrand}
        drop={heroDrop}
        image={img("fashion/campaign/5", "Lagos Static, Drop 07 campaign")}
        headline={["Third", "Mainland"]}
        products={[...heroProducts, productById.get("p_signal_beanie")!]}
        spotlight={{ brand: spotlightBrand, title: "Bags, saddle-stitched in Paris", image: spotlightBrand.cover, href: `/brands/${spotlightBrand.handle}` }}
      />

      {/* Drops band — the page's one large purple surface */}
      <section aria-labelledby="drops-title" className="relative mt-4 overflow-hidden bg-purple">
        <div className="mx-auto grid max-w-page gap-10 px-4 py-14 md:px-8 md:py-20 lg:grid-cols-[minmax(0,420px)_1fr]">
          <div className="flex flex-col">
            <h2 id="drops-title" className="font-display text-display-lg text-ink">Upcoming drops</h2>
            <p className="mt-3 max-w-sm text-[0.9375rem] leading-relaxed text-ink/80">
              Limited releases on a schedule. Set a reminder and we&apos;ll tell you the moment one goes live.
            </p>
            <div className="mt-10 rounded-2xl border border-white/15 bg-obsidian/25 p-5 backdrop-blur-sm">
              <div className="flex flex-wrap items-center gap-2">
                <DropStatus drop={nextDrop} />
                {nextDrop.sponsored ? <SponsoredTag /> : null}
              </div>
              <p className="mt-4 text-sm text-ink/80">{nextDropBrand.name}</p>
              <Link href={`/drops/${nextDrop.slug}`} className="mt-1 block font-display text-display-sm text-ink">{nextDrop.name}</Link>
              <Countdown drop={nextDrop} size="lg" className="mt-6 text-ink" />
              <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-ink/70">{dropAccessLabel[nextDrop.access]}</p>
                <NotifyButton drop={nextDrop} variant="glass" />
              </div>
            </div>
          </div>
          <div className="min-w-0 lg:pt-16">
            <Rail label="Upcoming drops" itemClassName="sm:w-[46vw] md:w-[34vw] lg:w-[48%]">
              {upcoming.slice(1).map((d) => (
                <DropCard key={d.id} drop={d} />
              ))}
            </Rail>
            <Link href="/drops" className="mt-6 inline-flex text-sm text-ink underline-offset-4 hover:underline">See the full drop calendar</Link>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-page px-4 md:px-8">
        {/* Trending */}
        <section aria-labelledby="trending-title" className="mt-24 md:mt-32">
          <div id="trending-title">
            <SectionHeader title="Trending now" description="Ranked by this week's momentum, with at most two pieces per brand." href="/shop?sort=trending" />
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-4 md:grid-cols-4 md:grid-rows-[auto_auto]">
            <div className="col-span-2 md:row-span-2">
              <ProductCard product={feature} variant="feature" priority />
            </div>
            {trendingRest.slice(0, 4).map((p) => (
              <ProductCard key={p.id} product={p} sizes="(min-width: 768px) 22vw, 50vw" />
            ))}
          </div>
          <div className="mt-8 grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-4 md:grid-cols-4">
            {trendingRest.slice(4, 8).map((p) => (
              <ProductCard key={p.id} product={p} variant="tall" />
            ))}
          </div>
        </section>

        {/* Emerging brands */}
        <section aria-labelledby="emerging-title" className="mt-24 md:mt-32">
          <div id="emerging-title">
            <SectionHeader title="Emerging brands" description="Smaller studios growing fastest this month. Placement here is earned, never bought." href="/brands?sort=emerging" />
          </div>
          <div className="rail -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 *:w-[78vw] *:shrink-0 *:snap-start sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-0 sm:*:w-auto lg:grid-cols-4">
            {emerging.map((b) => (
              <BrandCard key={b.id} brand={b} stat="growth" showProducts />
            ))}
          </div>
        </section>

        {/* Underground Index */}
        <section aria-labelledby="index-title" className="mt-24 md:mt-32">
          <div id="index-title">
            <SectionHeader title="The Underground Index" description="Independent studios our editors think you should know. Updated every week, never for sale." href="/brands" action="All brands" />
          </div>
          <UndergroundIndex entries={indexEntries} />
        </section>

        {/* Curated collections */}
        <section aria-labelledby="collections-title" className="mt-24 md:mt-32">
          <div id="collections-title">
            <SectionHeader title="Curated collections" description="Edits across brands, put together by people rather than an algorithm." />
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {[leadCollection, ...otherCollections].map((c, i) => {
              const sponsor = c.sponsoredBy ? brandById.get(c.sponsoredBy) : undefined
              return (
                <Link
                  key={c.id}
                  href={`/collections/${c.slug}`}
                  className={`group relative isolate flex min-h-[240px] flex-col justify-end overflow-hidden rounded-xl bg-card p-5 ${i === 0 ? "md:row-span-2 md:min-h-[560px]" : ""} ${sponsor ? "md:col-span-3 md:min-h-[200px] md:justify-center md:p-8" : ""}`}
                >
                  <Image src={c.image.src} alt="" fill sizes={i === 0 ? "(min-width: 768px) 33vw, 100vw" : "(min-width: 768px) 33vw, 100vw"} className="-z-10 object-cover transition-transform duration-[900ms] ease-out-quint group-hover:scale-[1.04]" />
                  <span className="scrim-b absolute inset-0 -z-10" />
                  {sponsor ? <SponsoredTag by={sponsor.name} className="absolute top-4 left-4" /> : null}
                  <h3 className={`font-display text-ink ${i === 0 ? "text-display-lg" : "text-display-sm"}`}>{c.name}</h3>
                  <p className="mt-2 max-w-sm text-sm text-ink/80">{c.description}</p>
                  <p className="mt-3 text-xs text-ink-2">{c.brandIds.length} brands</p>
                </Link>
              )
            })}
          </div>
        </section>

        {/* Recommended */}
        <div className="mt-24 md:mt-32">
          <RecommendedForYou />
        </div>

        {/* Featured brands with labelled sponsored slots */}
        <section aria-labelledby="featured-title" className="mt-24 md:mt-32">
          <div id="featured-title">
            <SectionHeader title="Featured brands" description="Editors' picks alongside sponsored slots. Paid placements are always marked." href="/brands" />
          </div>
          <div className="rail -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 *:w-[78vw] *:shrink-0 *:snap-start sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-0 sm:*:w-auto lg:grid-cols-4">
            {featured.map(({ item, sponsored }) => (
              <BrandCard key={item.id} brand={item} sponsored={sponsored} />
            ))}
          </div>
        </section>

        {/* Recently discovered */}
        <section aria-labelledby="recent-title" className="mt-24 md:mt-32">
          <div id="recent-title">
            <SectionHeader title="Recently discovered" description="The newest studios on the platform." href="/brands?sort=newest" />
          </div>
          <div className="rail -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 *:w-[78vw] *:shrink-0 *:snap-start sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-0 sm:*:w-auto lg:grid-cols-4">
            {recent.map((b) => (
              <BrandCard key={b.id} brand={b} stat="joined" />
            ))}
          </div>
        </section>

        {/* Stories */}
        <section aria-labelledby="stories-title" className="mt-24 md:mt-32">
          <div id="stories-title">
            <SectionHeader title="Brand stories" description="Origins, process and the people behind the pieces." href="/stories" />
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {stories.slice(0, 3).map((s) => {
              const b = brandById.get(s.brandId)!
              return (
                <Link key={s.id} href={`/stories/${s.slug}`} className="group">
                  <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-card">
                    <Image src={s.cover.src} alt={s.cover.alt} fill sizes="(min-width: 768px) 33vw, 100vw" className="object-cover transition-transform duration-[900ms] ease-out-quint group-hover:scale-[1.04]" />
                  </div>
                  <p className="mt-4 text-xs text-violet">{storyKind[s.kind]}</p>
                  <h3 className="mt-1 text-xl font-medium text-ink">{s.title}</h3>
                  <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-ink-2">{s.dek}</p>
                  <p className="mt-3 text-xs text-ink-3">{b.name}, {s.readMinutes} min read</p>
                </Link>
              )
            })}
          </div>
        </section>
      </div>
    </>
  )
}
