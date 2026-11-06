import Image from "next/image"
import Link from "next/link"
import { DropStatus } from "@/components/market/countdown"
import { brandById } from "@/lib/data/brands"
import { dropWindow } from "@/lib/drops"
import type { Drop } from "@/lib/data/types"
import { agoText, releasedAgo, runText } from "./drop-facts"

/**
 * Sold-out and ended drops as a compact archive. Each keeps its page, so nothing is lost.
 *
 * DropsBoard groups on the demo clock once mounted, so it passes that clock (`now`, `anchor`)
 * and "Released …" is measured from the drop's real release on it: a drop that ended during
 * this visit reads its true age, not the age it had when the demo loaded. Before mount (and on
 * the server) both are null and the line uses the phase the demo loads with.
 */
export function DropArchive({ drops, now = null, anchor = null }: { drops: Drop[]; now?: number | null; anchor?: number | null }) {
  return (
    <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {drops.map((drop) => {
        const brand = brandById.get(drop.brandId)!
        const href = `/drops/${drop.slug}`
        const released = now !== null && anchor !== null ? agoText(now - dropWindow(drop, anchor).release) : releasedAgo(drop)
        return (
          <li key={drop.id} className="group/past relative flex items-center gap-4 rounded-lg border border-line-soft bg-card p-3 pr-4 transition-colors hover:border-line">
            <div className="relative aspect-square w-16 shrink-0 overflow-hidden rounded-md bg-surface sm:w-20">
              <Image src={drop.image.src} alt="" fill sizes="80px" className="object-cover grayscale-[0.75] transition-[filter] duration-500 group-hover/past:grayscale-0" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-ink-2">{brand.name}</p>
              <h3 className="mt-0.5 truncate text-sm font-medium text-ink">
                <Link href={href} className="after:absolute after:inset-0 after:rounded-lg">
                  {drop.name}
                </Link>
              </h3>
              {/* Two short facts on their own lines, so neither is cut off on a phone. */}
              <p className="mt-1 text-xs leading-snug text-ink-3">
                <span className="block">{runText(drop)}</span>
                {released ? <span className="block">Released {released}</span> : null}
              </p>
            </div>
            <DropStatus drop={drop} className="shrink-0" />
          </li>
        )
      })}
    </ul>
  )
}
