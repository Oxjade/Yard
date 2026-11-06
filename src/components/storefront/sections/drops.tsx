"use client"

import Image from "next/image"
import Link from "next/link"
import { ArrowUpRightIcon as ArrowUpRight } from "@phosphor-icons/react"
import { DropCard } from "@/components/market/drop-card"
import { useDropPhases } from "@/components/market/editorial/use-drop-phase"
import { initialDropPhase } from "@/lib/drops"
import { formatNumber } from "@/lib/money"
import { cn } from "@/lib/utils"
import type { Drop, DropPhase, Product, StorefrontSection } from "@/lib/data/types"
import { Container, SectionHeading, SectionShell, type StorefrontContext } from "../parts"

type Props = {
  ctx: StorefrontContext
  section: StorefrontSection
  index: number
  first: boolean
  drops: Drop[]
  /** The brand's published products, to show what a lone drop contains. */
  products?: Product[]
}

/**
 * Group drops by where they are in their life: on now, coming up, entries closed (a draw that
 * has released sells only to its drawn winners, so it is not "Live now"), already gone. The
 * phase defaults to the one the demo loads with (safe on the server); the section passes the
 * demo clock's once mounted.
 */
export function groupDrops(drops: Drop[], phaseOf: (d: Drop) => DropPhase = initialDropPhase) {
  const live = drops.filter((d) => phaseOf(d) === "live" && d.access !== "draw")
  const upcoming = drops.filter((d) => phaseOf(d) === "upcoming").sort((a, b) => a.releaseOffsetHours - b.releaseOffsetHours)
  const closed = drops.filter((d) => phaseOf(d) === "live" && d.access === "draw")
  const past = drops
    .filter((d) => ["sold-out", "ended"].includes(phaseOf(d)))
    .sort((a, b) => b.releaseOffsetHours - a.releaseOffsetHours)
  return [
    { key: "live", title: "Live now", items: live },
    { key: "upcoming", title: "Coming up", items: upcoming },
    { key: "draw-closed", title: "Entries closed", items: closed },
    { key: "past", title: "Past drops", items: past },
  ].filter((g) => g.items.length)
}

/**
 * The facts a shopper needs before release. Access is left to the card beside it
 * (dropAccessLabel), so the same fact is never said twice in different words.
 */
function DropNotes({ drop, accent, products }: { drop: Drop; accent: boolean; products: Product[] }) {
  const pieces = (n: number) => `${formatNumber(n)} ${n === 1 ? "piece" : "pieces"}`
  const byId = new Map(products.map((p) => [p.id, p]))
  const inDrop = drop.productIds.map((id) => byId.get(id)).filter((p): p is Product => !!p)
  const facts = [
    { label: "Run", value: pieces(drop.totalUnits) },
    { label: "Limit", value: `${drop.limitPerCustomer} per customer` },
    // With the pieces shown above the facts, their count is already said.
    ...(inDrop.length ? [] : [{ label: "In the drop", value: pieces(drop.productIds.length) }]),
  ]
  return (
    <div className={cn("flex flex-col rounded-lg border border-line-soft p-5 @3xl:p-8", accent && "border-l-2 border-l-(color:--sf-accent)")}>
      <h4 className="text-sm text-ink-2">About this drop</h4>
      <p className="mt-3 max-w-md text-pretty text-lg leading-snug text-ink @3xl:text-xl">{drop.description}</p>
      {inDrop.length ? (
        <div className="mt-8">
          <h5 className="text-xs text-ink-3 tabular">In the drop, {pieces(drop.productIds.length)}</h5>
          <ul className="mt-3 grid grid-cols-3 gap-3">
            {inDrop.slice(0, 3).map((p) => (
              <li key={p.id}>
                <Link href={`/products/${p.slug}`} className="group block">
                  <span className="relative block aspect-square overflow-hidden rounded-md bg-card">
                    <Image src={p.images[0].src} alt={p.images[0].alt} fill sizes="(min-width: 768px) 14vw, 30vw" className="object-cover transition-transform duration-[900ms] ease-out-quint group-hover:scale-[1.04]" />
                  </span>
                  <span className="mt-2 block truncate text-xs text-ink-2 transition-colors group-hover:text-(color:--sf-accent)">{p.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {/* Facts and the link sit at the foot, level with the card's action beside them. */}
      <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-line-soft pt-6 @3xl:mt-auto @3xl:grid-cols-3">
        {facts.map((f) => (
          <div key={f.label}>
            <dt className="text-xs text-ink-3">{f.label}</dt>
            <dd className="mt-1 text-sm text-ink">{f.value}</dd>
          </div>
        ))}
      </dl>
      <Link href={`/drops/${drop.slug}`} className="group mt-6 inline-flex min-h-10 items-center gap-1 self-start text-sm text-ink-2 transition-colors hover:text-(color:--sf-accent) lg:mt-8 lg:min-h-0">
        Open the drop page
        <ArrowUpRight className="size-4 transition-transform duration-300 ease-out-quint group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
      </Link>
    </div>
  )
}

/** A brand's own drop on its own storefront is organic: storefronts carry no paid labels. */
const organic = (drop: Drop): Drop => (drop.sponsored ? { ...drop, sponsored: false } : drop)

export function DropsSection({ ctx, section, index, first, drops, products = [] }: Props) {
  // On the demo clock once mounted, so a drop that opens (or a draw that releases) while the
  // page is up moves to the right group; the server's grouping until then.
  const { phases } = useDropPhases(drops)
  const groups = groupDrops(drops, (d) => phases.get(d.id) ?? initialDropPhase(d))
  const street = ctx.template === "street"
  // Only invite a reminder when there is a release still to come.
  const has = (key: string) => groups.some((g) => g.key === key)
  const description = has("upcoming")
    ? street
      ? "Limited runs on a schedule. Set a reminder and you'll get an alert when the next one opens."
      : "Limited releases. Set a reminder for the next one."
    : has("live")
      ? "Open now, while stock lasts."
      : has("draw-closed")
        ? "The draw has released: entries are closed and only drawn winners can buy."
        : `Past releases from ${ctx.brand.name}. Follow to hear about the next one.`

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
                // One drop: the card beside the details a shopper needs before release, both the same height.
                <div className="grid gap-4 @3xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
                  <DropCard drop={organic(g.items[0])} />
                  <DropNotes drop={g.items[0]} accent={street} products={products} />
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
