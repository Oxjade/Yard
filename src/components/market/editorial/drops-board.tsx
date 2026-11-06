"use client"

import Link from "next/link"
import { CalendarDotsIcon as CalendarClock, LightningIcon as Zap } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { SectionHeader } from "@/components/market/section-header"
import type { Drop } from "@/lib/data/types"
import { DropArchive } from "./drop-archive"
import { EmptyCard } from "./empty-card"
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
          <EmptyCard
            layout="inline"
            icon={<Zap />}
            title="Nothing is live right now"
            reason={upcoming.length ? "The next release is in the calendar below; set a reminder and you'll get an alert when it opens." : "No release is scheduled yet; past drops keep their pages below."}
            action={
              upcoming.length ? (
                <Button asChild variant="secondary">
                  <Link href="#upcoming">See the calendar</Link>
                </Button>
              ) : undefined
            }
          />
        )}
      </section>

      <section id="upcoming" aria-labelledby="upcoming-title" className="mt-24 scroll-mt-28 md:mt-32">
        <div id="upcoming-title">
          <SectionHeader title="Upcoming" description="Every scheduled release, in your time zone. Set a reminder or enter a draw before it opens." />
        </div>
        {upcoming.length ? (
          <ReleaseCalendar drops={upcoming} now={now} anchor={anchor} />
        ) : (
          <EmptyCard
            layout="inline"
            icon={<CalendarClock />}
            title="No drops scheduled"
            reason="Brands announce releases here first; follow the ones you like and their next drop shows up in Following."
            action={
              <Button asChild variant="secondary">
                <Link href="/brands">Browse brands</Link>
              </Button>
            }
          />
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
