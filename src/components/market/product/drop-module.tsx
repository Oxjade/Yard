"use client"

import Link from "next/link"
import { ArrowUpRight } from "lucide-react"
import type { Drop, DropPhase } from "@/lib/data/types"
import { Countdown, DropStatus } from "../countdown"
import { accessRule, limitText } from "../editorial/drop-facts"

/**
 * The release this product belongs to, while it is upcoming or live. Before release the page's
 * main action becomes the drop reminder (NotifyButton, in the buy box); once live, Add to bag
 * returns with the per-customer limit.
 */
export function DropModule({ drop, phase }: { drop: Drop; phase: DropPhase }) {
  return (
    <section aria-labelledby="pdp-drop-title" className="rounded-lg border border-line bg-card p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <DropStatus drop={drop} />
        <Link href={`/drops/${drop.slug}`} className="group inline-flex items-center gap-1 text-xs text-ink-2 transition-colors hover:text-ink">
          Drop details
          <ArrowUpRight className="size-3.5 transition-transform duration-300 ease-out-quint group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </Link>
      </div>
      <h2 id="pdp-drop-title" className="mt-4 text-base font-medium text-ink">
        {drop.name}
      </h2>
      <p className="mt-1 text-sm leading-relaxed text-ink-2">{drop.description}</p>
      <Countdown drop={drop} className="mt-4" />
      <p className="mt-4 border-t border-line-soft pt-3 text-xs text-ink-2">
        {accessRule[drop.access]} {limitText(drop)}.{phase === "upcoming" && drop.access !== "draw" ? " Sizes open at release." : ""}
      </p>
    </section>
  )
}
