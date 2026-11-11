import { Suspense } from "react"
import Image from "next/image"
import Link from "next/link"
import { BrandCard } from "@/components/market/brand-card"
import { DiscoverHero } from "@/components/market/discover-hero"
import { FoundingBrandsSection } from "@/components/market/founding-brands"
import { AroundTeaser, ChartsThisWeek } from "@/components/market/discover-modules"
import { UpcomingDropsBand } from "@/components/market/editorial/upcoming-drops-band"
import { ProductCard } from "@/components/market/product-card"
import { RecommendedForYou } from "@/components/market/recommended"
import { SectionHeader } from "@/components/market/section-header"
import { SponsoredTag } from "@/components/market/sponsored-tag"
import { UndergroundIndex } from "@/components/market/underground-index"
import { withSponsoredSlots } from "@/lib/data/ads"
import {
  brandById,
  curatedCollections,
  drops,
  emergingBrands,
  getDrop,
  productById,
  recentlyJoinedBrands,
  sponsoredBrands,
  stories,
  trendingBrands,
  trendingProducts,
} from "@/lib/data"
import { img } from "@/lib/data/media"
import type { Product } from "@/lib/data/types"
import { getEnv } from "@/server/env"

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
  // Production (no demo seed): the real founding brands take the place of the sample modules
  // (Trending now, the Underground Index and the brand rails). Demo and development keep every
  // sample module. The hero and the drops band stay for now: they belong to the drops work (task G).
  const demo = getEnv().seedDemo
  const heroDrop = getDrop("drop-07-third-mainland")!
  const heroBrand = brandById.get(heroDrop.brandId)!
  const heroProducts = heroDrop.productIds.map((id) => productById.get(id)).filter(Boolean) as Product[]
  const spotlightBrand = brandById.get("b_velvet_underpass")!

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
        products={heroProducts}
        spotlight={{ brand: spotlightBrand, title: "Bags, saddle-stitched in Paris", image: spotlightBrand.cover, href: `/brands/${spotlightBrand.handle}` }}
      />

      {/* Drops band, the page's one large purple surface. Its lead card and rail follow the demo clock. */}
      <UpcomingDropsBand drops={drops} />

      <div className="mx-auto max-w-page px-4 md:px-8">
        {/* Trending: ranked from the sample catalogue, demo and development only (production
            has no momentum ranking yet; the week's Trending board below reads the server). */}
        {demo ? (
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
        ) : null}

        {/* Founding brands: read from the database at request time, so they stream in here. */}
        <Suspense fallback={null}>
          <FoundingBrandsSection />
        </Suspense>

        {/* Emerging brands */}
        {demo ? (
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
        ) : null}

        {/* The week's Trending board and a way into Around (§7.3). Both fetch on the client: the
            page itself stays a static shell. */}
        <div className="mt-24 grid grid-cols-[minmax(0,1fr)] gap-4 md:mt-32 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          <ChartsThisWeek />
          <AroundTeaser />
        </div>

        {/* Underground Index */}
        {demo ? (
        <section aria-labelledby="index-title" className="mt-24 md:mt-32">
          <div id="index-title">
            <SectionHeader title="The Underground Index" description="Independent studios our editors think you should know. Updated every week, never for sale." href="/brands" action="All brands" />
          </div>
          <UndergroundIndex entries={indexEntries} />
        </section>
        ) : null}

        {/* Curated collections: sample edits, demo and development only (production has no /collections yet). */}
        {demo ? (
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
                  <h3 className={`font-display text-balance text-ink ${i === 0 ? "text-display-lg md:text-display-md" : "text-display-sm"}`}>{c.name}</h3>
                  <p className="mt-2 max-w-sm text-sm text-ink/80">{c.description}</p>
                  <p className="mt-3 text-xs text-ink-2">{c.brandIds.length} brands</p>
                </Link>
              )
            })}
          </div>
        </section>
        ) : null}

        {/* Recommended */}
        <div className="mt-24 md:mt-32">
          <RecommendedForYou />
        </div>

        {/* Featured brands with labelled sponsored slots */}
        {demo ? (
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
        ) : null}

        {/* Recently discovered */}
        {demo ? (
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
        ) : null}

        {/* Stories: sample stories, demo and development only (production has no /stories yet). */}
        {demo ? (
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
        ) : null}
      </div>
    </>
  )
}
