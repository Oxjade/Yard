"use client"

import Link from "next/link"
import { CalendarDotsIcon as CalendarClock, LightningIcon as Zap } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { DropCard } from "@/components/market/drop-card"
import { SectionHeader } from "@/components/market/section-header"
import { withSponsoredSlots } from "@/lib/data/ads"
import type { Drop } from "@/lib/data/types"
import { DropArchive } from "./drop-archive"
import { EmptyCard } from "./empty-card"
import { featuredDropIds, isSponsoredDrop } from "./drop-facts"
import { FeaturedDrop } from "./featured-drop"
import { LiveDropCard } from "./live-drop-card"
import { ReleaseCalendar } from "./release-calendar"
import { bySoonest, useDropPhases } from "./use-drop-phase"

/**
 * The feature slot, Live now, the upcoming calendar, released draws and the archive. Grouping
 * follows the demo clock once mounted (a drop that opens while the page is up moves into Live
 * now); before that it uses the phase the demo loads with, which is also what the server renders.
 *
 * A draw that has released is not open to anyone but its winners, so it never sits under Live
 * now ("open right now, while stock lasts"): it has its own Entries closed group. The feature
 * slot leads with the next release still to come, so it never repeats a drop listed below as
 * live, closed or past.
 */
export function DropsBoard({ drops }: { drops: Drop[] }) {
  const { phases, now, anchor } = useDropPhases(drops)
  const phaseOf = (d: Drop) => phases.get(d.id)
  const live = drops.filter((d) => phaseOf(d) === "live" && d.access !== "draw")
  const upcoming = drops.filter((d) => phaseOf(d) === "upcoming").sort(bySoonest)
  const past = drops.filter((d) => phaseOf(d) === "sold-out" || phaseOf(d) === "ended").sort((a, b) => b.releaseOffsetHours - a.releaseOffsetHours)

  // The feature slot: the organic next release, with the paid "drops-feature" booking in its
  // designated position (slot 0). A booked drop that is also next simply carries the label. A
  // booking only fills the slot while its drop is still to come.
  const organicNext: Drop | undefined = upcoming[0] ?? live[0]
  const booked = upcoming.filter((d) => featuredDropIds.has(d.id) && d.id !== organicNext?.id).slice(0, 1)
  const [lead, second] = withSponsoredSlots(organicNext ? [organicNext] : [], booked, [0])
  const closed = drops.filter((d) => phaseOf(d) === "live" && d.access === "draw" && d.id !== lead?.item.id)

  return (
    <>
      {lead ? (
        <div className="mt-10 md:mt-12">
          <FeaturedDrop drop={lead.item} sponsored={lead.sponsored || isSponsoredDrop(lead.item)} />
          {second ? <DropCard drop={second.item} layout="wide" className="mt-4" /> : null}
        </div>
      ) : null}

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

      {closed.length ? (
        <section id="entries-closed" aria-labelledby="entries-closed-title" className="mt-24 scroll-mt-28 md:mt-32">
          <div id="entries-closed-title">
            <SectionHeader title="Entries closed" description="Draws that have released. Entering closed at release, and their pieces are for drawn winners only." />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {closed.map((d) => (
              <LiveDropCard key={d.id} drop={d} sponsored={isSponsoredDrop(d)} />
            ))}
          </div>
        </section>
      ) : null}

      {past.length ? (
        <section id="past" aria-labelledby="past-title" className="mt-24 scroll-mt-28 md:mt-32">
          <div id="past-title">
            <SectionHeader title="Past drops" description="Sold out or ended. Each drop keeps its page, with what was in it." />
          </div>
          <DropArchive drops={past} now={now} anchor={anchor} />
        </section>
      ) : null}
    </>
  )
}
