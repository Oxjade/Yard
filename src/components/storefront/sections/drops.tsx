"use client"

import Link from "next/link"
import { ArrowUpRightIcon as ArrowUpRight } from "@phosphor-icons/react"
import { DropCard } from "@/components/market/drop-card"
import { initialDropPhase } from "@/lib/drops"
import { formatNumber } from "@/lib/money"
import { cn } from "@/lib/utils"
import type { Drop, StorefrontSection } from "@/lib/data/types"
import { Container, SectionHeading, SectionShell, type StorefrontContext } from "../parts"

type Props = { ctx: StorefrontContext; section: StorefrontSection; index: number; first: boolean; drops: Drop[] }

/** Group drops by where they are in their life: on now, coming up, already gone. */
export function groupDrops(drops: Drop[]) {
  const live = drops.filter((d) => initialDropPhase(d) === "live")
  const upcoming = drops.filter((d) => initialDropPhase(d) === "upcoming").sort((a, b) => a.releaseOffsetHours - b.releaseOffsetHours)
  const past = drops
    .filter((d) => ["sold-out", "ended"].includes(initialDropPhase(d)))
    .sort((a, b) => b.releaseOffsetHours - a.releaseOffsetHours)
  return [
    { key: "live", title: "Live now", items: live },
    { key: "upcoming", title: "Coming up", items: upcoming },
    { key: "past", title: "Past drops", items: past },
  ].filter((g) => g.items.length)
}

/**
 * The facts a shopper needs before release. Access is left to the card beside it
 * (dropAccessLabel), so the same fact is never said twice in different words.
 */
function DropNotes({ drop, accent }: { drop: Drop; accent: boolean }) {
  const pieces = (n: number) => `${formatNumber(n)} ${n === 1 ? "piece" : "pieces"}`
  const facts = [
    { label: "Run", value: pieces(drop.totalUnits) },
    { label: "Limit", value: `${drop.limitPerCustomer} per customer` },
    { label: "In the drop", value: pieces(drop.productIds.length) },
  ]
  return (
    <div className={cn("flex flex-col rounded-lg border border-line-soft p-5 @3xl:p-8", accent && "border-l-2 border-l-(color:--sf-accent)")}>
      <h4 className="text-sm text-ink-2">About this drop</h4>
      <p className="mt-3 max-w-md text-pretty text-lg leading-snug text-ink">{drop.description}</p>
      <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-5 @3xl:grid-cols-3">
        {facts.map((f) => (
          <div key={f.label}>
            <dt className="text-xs text-ink-3">{f.label}</dt>
            <dd className="mt-1 text-sm text-ink">{f.value}</dd>
          </div>
        ))}
      </dl>
      <Link href={`/drops/${drop.slug}`} className="group mt-8 inline-flex items-center gap-1 self-start text-sm text-ink-2 transition-colors hover:text-(color:--sf-accent)">
        Open the drop page
        <ArrowUpRight className="size-4 transition-transform duration-300 ease-out-quint group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
      </Link>
    </div>
  )
}

/** A brand's own drop on its own storefront is organic: storefronts carry no paid labels. */
const organic = (drop: Drop): Drop => (drop.sponsored ? { ...drop, sponsored: false } : drop)

export function DropsSection({ ctx, section, index, first, drops }: Props) {
  const groups = groupDrops(drops)
  const street = ctx.template === "street"
  const description =
    ctx.template === "street"
      ? "Limited runs on a schedule. Set a reminder and you'll hear the moment one goes live."
      : "Limited releases. Set a reminder for the next one."

  return (
    <SectionShell ctx={ctx} section={section} first={first}>
      <Container>
        <SectionHeading ctx={ctx} section={section} index={index} description={description} />
        <div className="grid gap-10">
          {groups.map((g) => (
            <div key={g.key}>
              <h3 className="mb-4 flex items-center gap-2 text-sm text-ink">
                {g.key === "live" ? <span aria-hidden className="size-1.5 rounded-full bg-(color:--sf-accent)" /> : null}
                {g.title}
                <span className="text-ink-3 tabular">{g.items.length}</span>
              </h3>
              {g.items.length === 1 ? (
                // One drop: the card beside the details a shopper needs before release.
                <div className="grid gap-4 @3xl:grid-cols-2 @3xl:items-start">
                  <DropCard drop={organic(g.items[0])} />
                  <DropNotes drop={g.items[0]} accent={street} />
                </div>
              ) : (
                <div className={cn("grid gap-4", street ? "@2xl:grid-cols-2" : "@2xl:grid-cols-2 @5xl:grid-cols-3")}>
                  {g.items.map((d) => (
                    <DropCard key={d.id} drop={organic(d)} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </Container>
    </SectionShell>
  )
}
