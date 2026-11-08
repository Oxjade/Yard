import Image from "next/image"
import Link from "next/link"
import { BrandCard } from "@/components/market/brand-card"
import { BrandMark } from "@/components/market/brand-mark"
import { FollowButton } from "@/components/market/follow-button"
import { Rail } from "@/components/market/rail"
import { SectionHeader } from "@/components/market/section-header"
import { Button } from "@/components/ui/button"
import { countries } from "@/config/markets"
import { site } from "@/config/site"
import { withSponsoredSlots } from "@/lib/data/ads"
import { brandById, brands, emergingBrands, recentlyJoinedBrands, sponsoredBrands, trendingBrands } from "@/lib/data"
import type { Brand } from "@/lib/data/types"

/**
 * Editors' picks for the directory: a lead with a note, then two more. Chosen by people and
 * never for sale; a brand with an active sponsored campaign is not eligible, so paid and
 * editorial placements never overlap.
 */
const leadPick = {
  id: "b_oyin_atelier",
  headline: "Aso-oke at the seams",
  note: "Oyinkansola Bello cut patterns in London, then came home to build a Lagos studio around the weavers of Iseyin. Twelve pieces a season, each finished by hand.",
}
const morePicks = ["b_halfmoon_archive", "b_signal_bloom"]

function editorsPicks() {
  const paid = new Set(sponsoredBrands().map((b) => b.id))
  const eligible = (id: string) => !paid.has(id) && brandById.has(id)
  return {
    lead: eligible(leadPick.id) ? { ...leadPick, brand: brandById.get(leadPick.id)! } : null,
    picks: morePicks.filter(eligible).map((id) => brandById.get(id)!),
  }
}

/** The lead editorial tile: one brand, large, with a note from the editors. */
function FeaturedLead({ brand, headline, note }: { brand: Brand; headline: string; note: string }) {
  const href = `/brands/${brand.handle}`
  return (
    <article className="group/lead relative isolate flex min-h-[520px] flex-col justify-end overflow-hidden rounded-lg bg-card p-5 sm:min-h-[600px] md:p-8 lg:h-full">
      <Image
        src={brand.cover.src}
        alt={brand.cover.alt}
        fill
        preload
        sizes="(min-width: 1024px) 50vw, 100vw"
        className="-z-10 object-cover transition-transform duration-[900ms] ease-out-quint group-hover/lead:scale-[1.03]"
      />
      <span aria-hidden className="scrim-l absolute inset-0 -z-10" />
      <span aria-hidden className="scrim-b absolute inset-0 -z-10" />
      <Link href={href} className="absolute inset-0 z-0" aria-label={`Visit ${brand.name}`} tabIndex={-1} />

      <div className="pointer-events-none relative z-10">
        {/* An eyebrow, as on the curated collection header: paid slots carry a tag, editorial ones don't need one. */}
        <p className="text-sm text-ink/80">Editors’ pick</p>
        <div className="mt-4 flex items-center gap-3">
          <BrandMark brand={brand} size="md" />
          <div className="min-w-0">
            <p className="truncate text-base text-ink">{brand.name}</p>
            <p className="truncate text-xs text-ink/75">{brand.city}, {countries[brand.country].name}</p>
          </div>
        </div>
        <h3 className="mt-6 max-w-xl font-display text-display-md text-balance text-ink">{headline}</h3>
        <p className="mt-3 max-w-md text-pretty text-[0.9375rem] leading-relaxed text-ink/85">{note}</p>
        <div className="pointer-events-auto mt-7 flex flex-wrap items-center gap-3">
          <Button asChild variant="primary" size="lg">
            <Link href={href}>Visit the storefront</Link>
          </Button>
          <FollowButton brandId={brand.id} brandName={brand.name} size="lg" variant="glass" />
        </div>
      </div>
    </article>
  )
}

const railClasses =
  "rail -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 *:w-[78vw] *:shrink-0 *:snap-start sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-0 sm:*:w-auto lg:grid-cols-4"

/** The directory's default view: featured, trending, emerging, new, then every brand A to Z. */
export function BrandSections() {
  const { lead, picks } = editorsPicks()
  // Sponsored brands sit in fixed slots between editorial picks and are always labelled.
  const featured = withSponsoredSlots(picks, sponsoredBrands(), [1, 3])
  const trending = trendingBrands(8)
  const emerging = emergingBrands(4)
  // With a small catalogue the newest brands are often the fastest growing; skip repeats.
  const recent = recentlyJoinedBrands(brands.length).filter((b) => !emerging.some((e) => e.id === b.id)).slice(0, 4)
  const az = [...brands].sort((a, b) => a.name.localeCompare(b.name))

  return (
    <>
      <section aria-labelledby="featured-title" className="mt-14 md:mt-16">
        <div id="featured-title">
          <SectionHeader title="Featured brands" description="Picked by our editors. Sponsored slots are marked, and paying never buys an editors’ pick." />
        </div>
        <div className="grid gap-4 lg:grid-cols-4 lg:grid-rows-2">
          {lead ? (
            <div className="lg:col-span-2 lg:row-span-2">
              <FeaturedLead brand={lead.brand} headline={lead.headline} note={lead.note} />
            </div>
          ) : null}
          <div className="rail -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 *:w-[78vw] *:shrink-0 *:snap-start sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-0 sm:*:w-auto lg:col-span-2 lg:row-span-2">
            {featured.map(({ item, sponsored }) => (
              <BrandCard key={item.id} brand={item} sponsored={sponsored} />
            ))}
          </div>
        </div>
      </section>

      <section aria-labelledby="trending-title" className="mt-24 md:mt-32">
        <div id="trending-title">
          <SectionHeader title="Trending brands" description="Ranked by follower momentum over the last 30 days, not by size." href="/brands?sort=trending" />
        </div>
        <Rail label="Trending brands" itemClassName="sm:w-[44vw] md:w-[34vw] lg:w-[23.5%]">
          {trending.map((b, i) => (
            <div key={b.id} className="relative h-full">
              <BrandCard brand={b} stat="followers" showProducts className="h-full" />
              <span aria-hidden className="pointer-events-none absolute top-3 right-3 font-display text-display-sm text-ink tabular text-shadow-lg text-shadow-obsidian/70">
                {String(i + 1).padStart(2, "0")}
              </span>
            </div>
          ))}
        </Rail>
      </section>

      <section aria-labelledby="emerging-title" className="mt-24 md:mt-32">
        <div id="emerging-title">
          <SectionHeader title="Emerging brands" description="Under 30,000 followers and growing fastest this month. Nobody can pay to be here." href="/brands?sort=emerging" />
        </div>
        <div className={railClasses}>
          {emerging.map((b) => (
            <BrandCard key={b.id} brand={b} stat="growth" showProducts />
          ))}
        </div>
      </section>

      <section aria-labelledby="new-title" className="mt-24 md:mt-32">
        <div id="new-title">
          <SectionHeader title="New on the platform" description="More recent arrivals, newest first." href="/brands?sort=newest" />
        </div>
        <div className={railClasses}>
          {recent.map((b) => (
            <BrandCard key={b.id} brand={b} stat="joined" />
          ))}
        </div>
      </section>

      <section aria-labelledby="az-title" className="mt-24 md:mt-32">
        <div id="az-title">
          <SectionHeader title="All brands" description={`Every studio on ${site.name}, A to Z.`} />
        </div>
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
          {az.map((b) => (
            <li key={b.id} className="border-b border-line-soft py-1">
              <BrandCard brand={b} variant="row" />
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}
