"use client"

import { DropCard } from "@/components/market/drop-card"
import { Rail } from "@/components/market/rail"
import { SectionHeader } from "@/components/market/section-header"
import type { Drop } from "@/lib/data/types"
import { useUpcomingDrops } from "./use-drop-phase"

/**
 * The drop page's "More drops" rail: other releases still to come, on the demo clock, so a drop
 * that has released (or ended) while the demo ran drops out of a list headed "coming up". Live
 * drops are on /drops, with their own card. Before mount it lists what the server rendered.
 */
export function MoreDrops({ drops, excludeId }: { drops: Drop[]; excludeId: string }) {
  const others = useUpcomingDrops(drops).filter((d) => d.id !== excludeId)
  if (!others.length) return null
  return (
    <section aria-labelledby="more-drops-title" className="mt-24 md:mt-32">
      <div id="more-drops-title">
        <SectionHeader title="More drops" description="Other releases coming up. Set a reminder or enter the draw before each one opens." href="/drops" action="Full calendar" />
      </div>
      <Rail label="More drops" itemClassName="w-[80vw] sm:w-[46vw] md:w-[38vw] lg:w-[31%]">
        {others.map((d) => (
          <DropCard key={d.id} drop={d} />
        ))}
      </Rail>
    </section>
  )
}
