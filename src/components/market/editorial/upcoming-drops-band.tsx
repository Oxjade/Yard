"use client"

import Link from "next/link"
import { Countdown, DropStatus } from "@/components/market/countdown"
import { DropCard } from "@/components/market/drop-card"
import { Rail } from "@/components/market/rail"
import { SponsoredTag } from "@/components/market/sponsored-tag"
import { brandById } from "@/lib/data/brands"
import { dropAccessLabel } from "@/lib/drops"
import type { Drop } from "@/lib/data/types"
import { DropPrimaryAction } from "./drop-actions"
import { useUpcomingDrops } from "./use-drop-phase"

/**
 * Discover's drops band, the page's one large purple surface: the next release as the lead
 * card, the rest in a rail. Both are picked on the demo clock, so a drop that releases while
 * the demo runs leaves "Upcoming drops" instead of heading it as "Entries closed" or "Ended";
 * before mount they are what the server rendered.
 */
export function UpcomingDropsBand({ drops }: { drops: Drop[] }) {
  const [next, ...rest] = useUpcomingDrops(drops)
  const nextBrand = next ? brandById.get(next.brandId) : undefined

  return (
    <section aria-labelledby="drops-title" className="relative mt-4 overflow-hidden bg-purple">
      <div className="mx-auto grid max-w-page gap-10 px-4 py-14 md:px-8 md:py-20 lg:grid-cols-[minmax(0,420px)_1fr]">
        <div className="flex flex-col">
          <h2 id="drops-title" className="font-display text-display-lg text-ink">Upcoming drops</h2>
          <p className="mt-3 max-w-sm text-[0.9375rem] leading-relaxed text-ink/80">
            Limited releases on a schedule. Set a reminder and we&apos;ll tell you the moment one goes live.
          </p>
          {next && nextBrand ? (
            <div className="mt-10 rounded-2xl border border-white/15 bg-obsidian/25 p-5 backdrop-blur-sm">
              <div className="flex flex-wrap items-center gap-2">
                <DropStatus drop={next} />
                {next.sponsored ? <SponsoredTag /> : null}
              </div>
              <p className="mt-4 text-sm text-ink/80">{nextBrand.name}</p>
              <Link href={`/drops/${next.slug}`} className="mt-1 block font-display text-display-sm text-ink">{next.name}</Link>
              <Countdown drop={next} size="lg" className="mt-6 text-ink" />
              <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-ink/70">{dropAccessLabel[next.access]}</p>
                {/* Glass: the hero's Preview the drop is this view's one acid action. */}
                <DropPrimaryAction drop={next} variant="glass" size="sm" />
              </div>
            </div>
          ) : (
            <p className="mt-10 rounded-2xl border border-white/15 bg-obsidian/25 p-5 text-sm leading-relaxed text-ink/80">
              No release is scheduled right now. Past drops keep their pages on the drops calendar.
            </p>
          )}
        </div>
        <div className="min-w-0 lg:pt-16">
          {rest.length ? (
            <Rail label="Upcoming drops" itemClassName="sm:w-[46vw] md:w-[34vw] lg:w-[48%]">
              {rest.map((d) => (
                <DropCard key={d.id} drop={d} />
              ))}
            </Rail>
          ) : null}
          <Link href="/drops" className="mt-6 inline-flex text-sm text-ink underline-offset-4 hover:underline">See the full drop calendar</Link>
        </div>
      </div>
    </section>
  )
}
