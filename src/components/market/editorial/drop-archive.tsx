import Image from "next/image"
import Link from "next/link"
import { DropStatus } from "@/components/market/countdown"
import { brandById } from "@/lib/data/brands"
import type { Drop } from "@/lib/data/types"
import { releasedAgo, runText } from "./drop-facts"

/** Sold-out and ended drops as a compact archive. Each keeps its page, so nothing is lost. */
export function DropArchive({ drops }: { drops: Drop[] }) {
  return (
    <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {drops.map((drop) => {
        const brand = brandById.get(drop.brandId)!
        const href = `/drops/${drop.slug}`
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
              <p className="mt-1 truncate text-xs text-ink-3">
                {runText(drop)}, released {releasedAgo(drop)}
              </p>
            </div>
            <DropStatus drop={drop} className="shrink-0" />
          </li>
        )
      })}
    </ul>
  )
}
