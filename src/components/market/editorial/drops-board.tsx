"use client"

import Link from "next/link"
import { CalendarClock, Zap } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SectionHeader } from "@/components/market/section-header"
import type { Drop } from "@/lib/data/types"
import { DropArchive } from "./drop-archive"
import { isSponsoredDrop } from "./drop-facts"
import { LiveDropCard } from "./live-drop-card"
import { ReleaseCalendar } from "./release-calendar"
import { useDropPhases } from "./use-drop-phase"

/**
 * Live now, the upcoming calendar and the archive. Grouping follows the demo clock once
 * mounted (a drop that opens while the page is up moves into Live now); before that it uses
 * the phase the demo loads with, which is also what the server renders.
 */
export function DropsBoard({ drops }: { drops: Drop[] }) {
  const { phases, now, anchor } = useDropPhases(drops)
  const live = drops.filter((d) => phases.get(d.id) === "live")
  const upcoming = drops.filter((d) => phases.get(d.id) === "upcoming").sort((a, b) => a.releaseOffsetHours - b.releaseOffsetHours)
  const past = drops
    .filter((d) => phases.get(d.id) === "sold-out" || phases.get(d.id) === "ended")
    .sort((a, b) => b.releaseOffsetHours - a.releaseOffsetHours)

  return (
    <>
      <section id="live" aria-labelledby="live-title" className="mt-24 scroll-mt-28 md:mt-32">
        <div id="live-title">
          <SectionHeader title="Live now" description="Open right now, while stock lasts. Limits are per customer, across every piece in the drop." />
        </div>
        {live.length ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {live.map((d) => (
              <LiveDropCard key={d.id} drop={d} sponsored={isSponsoredDrop(d)} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-start gap-4 rounded-lg border border-line-soft bg-card p-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <span className="inline-flex size-14 shrink-0 items-center justify-center rounded-full border border-line">
                <Zap className="size-6 text-ink-2" />
              </span>
              <div>
                <p className="text-base text-ink">Nothing is live right now</p>
                <p className="mt-1 text-sm text-ink-2">The next release is in the calendar below. Set a reminder and we&apos;ll tell you when it opens.</p>
              </div>
            </div>
            <Button asChild variant="secondary">
              <Link href="#upcoming">See the calendar</Link>
            </Button>
          </div>
        )}
      </section>

      <section id="upcoming" aria-labelledby="upcoming-title" className="mt-24 scroll-mt-28 md:mt-32">
        <div id="upcoming-title">
          <SectionHeader title="Upcoming" description="Every scheduled release, in your time zone. Set a reminder or enter a draw before it opens." />
        </div>
        {upcoming.length ? (
          <ReleaseCalendar drops={upcoming} now={now} anchor={anchor} />
        ) : (
          <div className="flex flex-col items-start gap-4 rounded-lg border border-line-soft bg-card p-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <span className="inline-flex size-14 shrink-0 items-center justify-center rounded-full border border-line">
                <CalendarClock className="size-6 text-ink-2" />
              </span>
              <div>
                <p className="text-base text-ink">No drops scheduled</p>
                <p className="mt-1 text-sm text-ink-2">Brands announce releases here first. Follow the ones you like to hear about the next one.</p>
              </div>
            </div>
            <Button asChild variant="secondary">
              <Link href="/brands">Browse brands</Link>
            </Button>
          </div>
        )}
      </section>

      {past.length ? (
        <section id="past" aria-labelledby="past-title" className="mt-24 scroll-mt-28 md:mt-32">
          <div id="past-title">
            <SectionHeader title="Past drops" description="Sold out or ended. Each drop keeps its page, with what was in it." />
          </div>
          <DropArchive drops={past} />
        </section>
      ) : null}
    </>
  )
}
