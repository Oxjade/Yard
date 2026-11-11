import Image from "next/image"
import Link from "next/link"
import { connection } from "next/server"
import { Button } from "@/components/ui/button"
import { dropImageSrc, isApiImage, type PublicDropDto } from "@/lib/api/drops"
import { featuredFoundingBrandForHome, type FeaturedFoundingBrand } from "@/server/catalog/founding"
import { listPublicDrops } from "@/server/drops/service"
import { countries, type CountryCode } from "@/config/markets"
import { FollowButton } from "./follow-button"
import { FoundingBadge } from "./founding-badge"
import { HeroCurtain } from "./hero-curtain"
import "./hero-motion.css"

const delay = (ms: number) => ({ "--delay": `${ms}ms` }) as React.CSSProperties
// A flex column so the copy sits at the bottom on phones too, where the hero has only a minimum
// height (h-full needs a definite height): any spare height goes above the headline, over the photo.
const heroClass = "relative isolate flex min-h-[640px] flex-col overflow-hidden md:h-[min(100svh,960px)]"
const innerClass = "mx-auto flex w-full max-w-page flex-1 flex-col justify-end px-4 pt-32 pb-8 md:px-8 md:pb-14"

/**
 * Discover's hero in production (the demo keeps DiscoverHero with its sample drop), read from the
 * database at request time, first match wins:
 *  1. the drop that is live now, else the next one to release (DropHero);
 *  2. else a listed founding brand, one a day by UTC date when there are several (BrandHero);
 *  3. else a welcome with no drop or brand in it, never a sample one, over the founding brands'
 *     photos sliding past (HeroCurtain).
 * Each read is memoised server-side (drops per request, the brand 60 s and dropped on any
 * catalogue write), so a newly published storefront shows within a minute.
 */
export async function LiveDiscoverHero() {
  // Request time, outside the try: the prerender's bail-out must reach Next, not the catch below.
  await connection()
  let drop: PublicDropDto | null = null
  try {
    const found = (await listPublicDrops({ phase: "live", limit: 1 })).items[0] ?? (await listPublicDrops({ phase: "upcoming", limit: 1 })).items[0]
    drop = found ? (found as unknown as PublicDropDto) : null
  } catch {
    drop = null
  }
  if (drop) return <DropHero drop={drop} />
  let brand: FeaturedFoundingBrand | null = null
  try {
    brand = await featuredFoundingBrandForHome()
  } catch {
    brand = null
  }
  return brand ? <BrandHero brand={brand} /> : <WelcomeHero />
}

/** The fallback while the hero streams in: the hero's frame, empty. */
export function HeroFrame() {
  return <section aria-hidden className={`${heroClass} bg-obsidian`} />
}

function DropHero({ drop }: { drop: PublicDropDto }) {
  const src = dropImageSrc(drop.image)
  const live = drop.phase === "live"
  const shoppable = live && drop.access !== "draw"
  return (
    <section aria-labelledby="hero-title" className={heroClass}>
      <div className="hero-settle absolute inset-0 -z-10">
        <Image src={src} alt={drop.name} fill preload unoptimized={isApiImage(src)} sizes="100vw" className="object-cover object-[60%_30%]" />
      </div>
      <div className="absolute inset-0 -z-10 bg-gradient-to-t from-obsidian via-obsidian/30 to-obsidian/40" aria-hidden />
      <div className="scrim-l absolute inset-0 -z-10 md:w-2/3" aria-hidden />
      <div className={innerClass}>
        <div className="max-w-3xl min-w-0">
          <div style={delay(150)} className="hero-lift flex min-w-0 items-center gap-3">
            {drop.brand.handle && drop.brand.name ? <Link href={`/brands/${drop.brand.handle}`} className="truncate text-sm text-ink hover:text-violet">{drop.brand.name}</Link> : null}
            <span className="shrink-0 text-sm text-ink-2">{live ? "Live now" : "Next drop"}</span>
          </div>
          <h1 id="hero-title" className="mt-5 font-display text-display-2xl break-words text-ink">
            <span className="block overflow-hidden pb-[0.04em]">
              <span className="hero-line block" style={{ "--line": 0 } as React.CSSProperties}>{drop.name}</span>
            </span>
          </h1>
          {drop.description ? <p style={delay(600)} className="hero-lift mt-6 line-clamp-3 max-w-md text-pretty text-base leading-relaxed text-ink/85 md:text-lg">{drop.description}</p> : null}
          <div style={delay(720)} className="hero-lift mt-8 flex flex-wrap items-center gap-3">
            <Button asChild variant="primary" size="lg">
              <Link href={`/drops/${drop.slug}`}>{shoppable ? "Shop the drop" : live ? "See the drop" : "Preview the drop"}</Link>
            </Button>
            {drop.brand.name ? <FollowButton brandId={drop.brand.id} brandName={drop.brand.name} size="lg" variant="glass" /> : null}
          </div>
        </div>
      </div>
    </section>
  )
}

/**
 * A featured founding brand, in the drop hero's frame: its storefront banner full-bleed (else its
 * first product photo, else the sliding curtain), the name large, the badge, one sentence of its
 * story and the way into its storefront.
 */
function BrandHero({ brand: b }: { brand: FeaturedFoundingBrand }) {
  const place = [b.city, countries[b.country as CountryCode]?.name ?? b.country].filter(Boolean).join(", ")
  // The name's longest word must fit its line (each line is masked for the entrance, so a wider
  // word would be cut): the display face is about 0.5 em a letter, so the size never exceeds the
  // screen less the gutters, nor the 48rem column, over that word. Short names keep the shared size.
  const em = Math.max(...b.name.split(/\s+/).map((w) => w.length), 1) * 0.52
  const titleSize = { fontSize: `min(var(--text-display-2xl), calc((100vw - 2.5rem) / ${em.toFixed(2)}), ${(48 / em).toFixed(2)}rem)` }
  return (
    <section aria-labelledby="hero-title" className={`${heroClass} bg-obsidian ${b.image ? "" : "curtain-host"}`}>
      {b.image ? (
        <>
          <div className="hero-settle absolute inset-0 -z-10">
            <Image src={b.image.src} alt={b.image.alt} fill preload unoptimized={isApiImage(b.image.src)} sizes="100vw" className="object-cover object-[60%_30%]" />
          </div>
          {/* Phones: the copy covers the lower half of the photo, so the middle of the fade is darker there. */}
          <div className="absolute inset-0 -z-10 bg-gradient-to-t from-obsidian via-obsidian/70 to-obsidian/30 md:via-obsidian/45 md:to-obsidian/40" aria-hidden />
          <div className="scrim-l absolute inset-0 -z-10 md:w-2/3" aria-hidden />
        </>
      ) : null}
      <div className={innerClass}>
        <div className={`max-w-3xl min-w-0 ${b.image ? "" : "curtain-hold"}`}>
          <div style={delay(150)} className="hero-lift flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
            {b.foundingBadge ? <FoundingBadge /> : <span className="text-sm text-ink">Featured brand</span>}
            {place ? <span className="min-w-0 truncate text-sm text-ink/80">{place}</span> : null}
          </div>
          <h1 id="hero-title" style={titleSize} className="mt-5 font-display text-display-2xl break-words text-ink">
            {/* Headroom in the mask for accents over capitals (Ì, É): the line height is under 1. */}
            <span className="-mt-[0.2em] block overflow-hidden pt-[0.2em] pb-[0.04em]">
              <span className="hero-line block" style={{ "--line": 0 } as React.CSSProperties}>{b.name}</span>
            </span>
          </h1>
          {b.excerpt ? <p style={delay(600)} className="hero-lift mt-6 line-clamp-2 max-w-md text-pretty text-base leading-relaxed text-ink/85 md:text-lg">{b.excerpt}</p> : null}
          <div style={delay(720)} className="hero-lift mt-8 flex flex-wrap items-center gap-3">
            <Button asChild variant="primary" size="lg">
              <Link href={`/brands/${b.handle}`}>Shop the brand</Link>
            </Button>
            <Button asChild variant="glass" size="lg">
              <Link href="/brands">See all brands</Link>
            </Button>
          </div>
        </div>
      </div>
      {b.image ? null : <HeroCurtain />}
    </section>
  )
}

function WelcomeHero() {
  return (
    <section aria-labelledby="hero-title" className={`${heroClass} curtain-host bg-obsidian`}>
      <div className={innerClass}>
        <div className="curtain-hold max-w-[60rem]">
          <h1 id="hero-title" className="curtain-title font-display text-display-2xl text-ink">
            {["Independent brands,", "limited drops"].map((line, i) => (
              <span key={line} className="block overflow-hidden pb-[0.04em]">
                <span className="hero-line block" style={{ "--line": i } as React.CSSProperties}>{line}</span>
              </span>
            ))}
          </h1>
          <p style={delay(600)} className="hero-lift mt-6 max-w-md text-pretty text-base leading-relaxed text-ink/85 md:text-lg">
            Small runs from studios you won&apos;t find anywhere else. Follow a brand and we&apos;ll tell you when its next drop opens.
          </p>
          <div style={delay(720)} className="hero-lift mt-8 flex flex-wrap items-center gap-3">
            <Button asChild variant="primary" size="lg"><Link href="/shop">Shop the pieces</Link></Button>
            <Button asChild variant="glass" size="lg"><Link href="/drops">See the drop calendar</Link></Button>
          </div>
        </div>
      </div>
      <HeroCurtain />
    </section>
  )
}
