import type { Metadata } from "next"
import { DropCard } from "@/components/market/drop-card"
import { SectionHeader } from "@/components/market/section-header"
import { DropsBoard } from "@/components/market/editorial/drops-board"
import { accessName, accessRule, featuredDropIds, isSponsoredDrop } from "@/components/market/editorial/drop-facts"
import { FeaturedDrop } from "@/components/market/editorial/featured-drop"
import { withSponsoredSlots } from "@/lib/data/ads"
import { drops, liveDrops, upcomingDrops } from "@/lib/data"
import type { Drop } from "@/lib/data/types"

export const metadata: Metadata = {
  title: "Drops",
  description: "Limited releases from independent brands: what's live now, the upcoming calendar and past drops.",
}

export default function DropsPage() {
  const upcoming = upcomingDrops()
  // The feature slot: the organic next release, with the paid "drops-feature" booking in its
  // designated position (slot 0). A booked drop that is also next simply carries the label.
  const organicNext: Drop | undefined = upcoming[0] ?? liveDrops()[0]
  const booked = upcoming.filter((d) => featuredDropIds.has(d.id) && d.id !== organicNext?.id).slice(0, 1)
  const slots = withSponsoredSlots(organicNext ? [organicNext] : [], booked, [0])
  const [lead, second] = slots

  return (
    <div className="mx-auto max-w-page px-4 pt-28 md:px-8 md:pt-32">
      <header className="max-w-2xl">
        <h1 className="font-display text-display-lg text-ink">Drops</h1>
        <p className="mt-4 max-w-xl text-pretty text-[0.9375rem] leading-relaxed text-ink-2">
          Limited releases from independent brands, on a schedule. Small runs, clear rules, and a reminder when each one opens.
        </p>
      </header>

      {lead ? (
        <div className="mt-10 md:mt-12">
          <FeaturedDrop drop={lead.item} sponsored={lead.sponsored || isSponsoredDrop(lead.item)} />
          {second ? <DropCard drop={second.item} layout="wide" className="mt-4" /> : null}
        </div>
      ) : null}

      <DropsBoard drops={drops} />

      <section aria-labelledby="how-title" className="mt-24 md:mt-32">
        <div id="how-title">
          <SectionHeader title="How drops work" description="Three release types. The rules are on every drop before it opens, and they don't change once it's scheduled." />
        </div>
        <dl className="grid gap-px overflow-hidden rounded-lg border border-line-soft bg-line-soft md:grid-cols-3">
          {(Object.keys(accessName) as Drop["access"][]).map((a) => (
            <div key={a} className="bg-obsidian p-5 md:p-6">
              <dt className="font-display text-display-sm text-ink">{accessName[a]}</dt>
              <dd className="mt-3 text-sm leading-relaxed text-ink-2">{accessRule[a]}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  )
}
