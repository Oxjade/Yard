import Image from "next/image"
import Link from "next/link"
import { connection } from "next/server"
import { Button } from "@/components/ui/button"
import { dropImageSrc, isApiImage, type PublicDropDto } from "@/lib/api/drops"
import { listPublicDrops } from "@/server/drops/service"
import { FollowButton } from "./follow-button"
import { HeroCurtain } from "./hero-curtain"
import "./hero-motion.css"

const delay = (ms: number) => ({ "--delay": `${ms}ms` }) as React.CSSProperties
const heroClass = "relative isolate min-h-[640px] overflow-hidden md:h-[min(100svh,960px)]"

/**
 * Discover's hero in production (the demo keeps DiscoverHero with its sample drop): the drop
 * that is live now, else the next one to release, read from the database at request time.
 * With no drop scheduled it is a welcome with no drop in it, never a sample one, over the
 * founding brands' photos sliding past (HeroCurtain).
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
  return drop ? <DropHero drop={drop} /> : <WelcomeHero />
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
      <div className="mx-auto flex h-full max-w-page flex-col justify-end px-4 pt-32 pb-10 md:px-8 md:pb-14">
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

function WelcomeHero() {
  return (
    <section aria-labelledby="hero-title" className={`${heroClass} curtain-host bg-obsidian`}>
      <div className="mx-auto flex h-full max-w-page flex-col justify-end px-4 pt-32 pb-10 md:px-8 md:pb-14">
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
