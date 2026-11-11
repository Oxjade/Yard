import Image from "next/image"
import Link from "next/link"
import { connection } from "next/server"
import { countries, type CountryCode } from "@/config/markets"
import { listFoundingBrandsForHome, type FoundingHomeBrand } from "@/server/catalog/founding"
import { FoundingBadge, OpeningSoonTag } from "./founding-badge"
import { SectionHeader } from "./section-header"

/**
 * The home page's "Founding brands": the first real brands Yard set up itself, once their
 * storefront is published. Server-rendered from the database (one memoised read, 60 s), so it
 * streams inside the page's Suspense boundary; it renders nothing until a founding brand is live.
 */
export async function FoundingBrandsSection() {
  // Request time, outside the try: the prerender's bail-out must reach Next, not the catch below.
  await connection()
  let list: FoundingHomeBrand[] = []
  try {
    list = await listFoundingBrandsForHome(8)
  } catch {
    // The home page never fails for this module: without the read, it simply isn't shown.
    return null
  }
  if (!list.length) return null
  return (
    <section aria-labelledby="founding-title" className="mt-24 md:mt-32">
      <div id="founding-title">
        <SectionHeader title="Founding brands" description="The first independent studios on Yard, set up with us from day one." />
      </div>
      <ul className="rail -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 *:w-[78vw] *:shrink-0 *:snap-start sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-0 sm:*:w-auto lg:grid-cols-4">
        {list.map((b) => (
          <li key={b.id} className="min-w-0">
            <FoundingBrandCard brand={b} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function FoundingBrandCard({ brand: b }: { brand: FoundingHomeBrand }) {
  const href = `/brands/${b.handle}`
  const place = `${b.city}, ${countries[b.country as CountryCode]?.name ?? b.country}`
  const mark = b.name.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 2).toUpperCase() || "Y"
  return (
    <article className="group/brand relative flex h-full flex-col overflow-hidden rounded-lg border border-line-soft bg-card">
      <Link href={href} className="relative block aspect-[4/3] overflow-hidden bg-surface" aria-hidden tabIndex={-1}>
        {b.coverSrc ? (
          <Image src={b.coverSrc} alt="" fill unoptimized sizes="(min-width: 1024px) 25vw, (min-width: 640px) 45vw, 78vw" className="object-cover transition-transform duration-[900ms] ease-out-quint group-hover/brand:scale-[1.04]" />
        ) : null}
        <span className="scrim-b absolute inset-0" />
        <span className="absolute bottom-3 left-3 inline-flex size-16 items-center justify-center overflow-hidden rounded-lg border border-white/12 bg-obsidian font-display text-xl text-ink">
          {b.logoSrc ? <Image src={b.logoSrc} alt="" fill unoptimized sizes="64px" className="object-cover" /> : mark}
        </span>
        {b.forSale ? null : <OpeningSoonTag className="absolute top-3 left-3" />}
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-4">
        <Link href={href} className="min-w-0 text-base font-medium text-ink transition-colors hover:text-violet">
          <span className="block truncate">{b.name}</span>
        </Link>
        <p className="-mt-1 truncate text-xs text-ink-2">{place}</p>
        {b.foundingBadge ? <FoundingBadge compact className="w-fit" /> : null}
        {b.story ? <p className="line-clamp-2 text-sm leading-relaxed break-words text-ink-2">{b.story}</p> : null}
      </div>
    </article>
  )
}
