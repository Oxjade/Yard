"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { HeartIcon as Heart, PackageIcon as Package, SparkleIcon as Sparkles, StorefrontIcon as Storefront } from "@phosphor-icons/react"
import { BrandCard } from "@/components/market/brand-card"
import { DropCard } from "@/components/market/drop-card"
import { ProductCard } from "@/components/market/product-card"
import { Rail } from "@/components/market/rail"
import { SectionHeader } from "@/components/market/section-header"
import { useUpcomingDrops } from "@/components/market/editorial/use-drop-phase"
import { Button } from "@/components/ui/button"
import { brandById, drops as allDrops, productById, recommendBrands } from "@/lib/data"
import { useOrders } from "@/lib/stores/orders"
import { useSaved } from "@/lib/stores/saved"
import { useSession } from "@/lib/stores/session"
import type { Brand, MerchantOrder, Product } from "@/lib/data/types"
import { firstName, formatDay, formatOrderMoney } from "./format"
import { InterestEditor } from "./interest-editor"
import { isSampleCheckout, OrderStatusBadge, SampleChip } from "./order-status"
import { InboxSummaryCard } from "@/components/inbox/entry"
import { YouNav } from "./you-nav"
import { merchantStatusOf, serverCheckoutGroups, useServerOrderSummaries } from "./use-server-order-summaries"
import type { CurrencyCode } from "@/config/markets"

function greeting(hour: number) {
  if (hour < 5) return "Up late"
  if (hour < 12) return "Good morning"
  if (hour < 18) return "Good afternoon"
  return "Good evening"
}

/** The marketplace empty state, laid out in a row so a quiet section stays short. */
function InlineEmpty({ icon: Icon, title, body, href, action }: { icon: React.ComponentType<{ className?: string }>; title: string; body: string; href: string; action: string }) {
  return (
    <div className="flex flex-col items-start gap-4 rounded-lg border border-line-soft bg-card px-5 py-6 sm:flex-row sm:items-center">
      <span className="inline-flex size-14 shrink-0 items-center justify-center rounded-full border border-line">
        <Icon className="size-6 text-ink-2" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-base text-ink">{title}</p>
        <p className="mt-1 text-sm text-ink-2">{body}</p>
      </div>
      <Button asChild variant="secondary">
        <Link href={href}>{action}</Link>
      </Button>
    </div>
  )
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** Your World overview: what's next from the brands you follow, what you saved, and your orders. */
export function YouOverview() {
  const user = useSession((s) => s.user)!
  const onboarded = useSession((s) => s.onboarded)
  const interests = useSession((s) => s.interests)
  const following = useSaved((s) => s.following)
  const wishlist = useSaved((s) => s.wishlist)
  const recentlyViewed = useSaved((s) => s.recentlyViewed)
  const groups = useOrders((s) => s.groups)
  const orders = useOrders((s) => s.orders)
  // Rendered only on the client (behind the account gate), so the local clock is safe here.
  const [hour] = useState(() => new Date().getHours())

  const followedBrands = following.map((id) => brandById.get(id)).filter((b): b is Brand => !!b)
  // The rows stay for the visit: unfollowing one turns its button back to Follow rather than
  // pulling the row, and focus, out from under the shopper. New follows join the end.
  const [visitFollowing] = useState(() => following)
  const rowBrands = [...visitFollowing, ...following.filter((id) => !visitFollowing.includes(id))]
    .map((id) => brandById.get(id))
    .filter((b): b is Brand => !!b)
  // On the demo clock, so a drop that has released during the visit leaves "Upcoming drops".
  const allUpcoming = useUpcomingDrops(allDrops)
  const followedUpcoming = allUpcoming.filter((d) => following.includes(d.brandId))
  const drops = followedUpcoming.length ? followedUpcoming : allUpcoming
  const saved = wishlist.map((id) => productById.get(id)).filter((p): p is Product => !!p)
  const viewed = recentlyViewed.map((id) => productById.get(id)).filter((p): p is Product => !!p).slice(0, 4)
  // Worked out once per visit so a suggestion doesn't disappear the moment it's followed.
  const [recommended] = useState(() => recommendBrands({ interests, following }, 4))

  const orderById = useMemo(() => new Map(orders.map((o) => [o.id, o])), [orders])
  const recentGroups = [...groups].sort((a, b) => b.placedAt.localeCompare(a.placedAt)).slice(0, 2)
  // A real shopper's orders come from the server; the local store holds only demo and sample history.
  const server = useServerOrderSummaries()
  const serverGroups = server ? serverCheckoutGroups(server.items).slice(0, 2) : []
  // Every shipped order, counted by the server; while unknown (loading, failed) the sentence is left out.
  const onTheWay = server === undefined ? orders.filter((o) => o.status === "shipped").length : (server?.counts?.shipped ?? 0)
  const hasRecent = server === undefined ? recentGroups.length > 0 : serverGroups.length > 0

  const brandsText = plural(followedBrands.length, "brand", "brands")
  const savedText = plural(saved.length, "piece", "pieces")
  const summary = [
    followedBrands.length && saved.length
      ? `You follow ${brandsText} and have saved ${savedText}.`
      : followedBrands.length
        ? `You follow ${brandsText}.`
        : saved.length
          ? `You've saved ${savedText}. Follow a few brands to see their drops here first.`
          : "Follow a few brands and save pieces you like, and this page fills up with them.",
    onTheWay ? `${plural(onTheWay, "parcel is", "parcels are")} on the way.` : null,
  ].filter(Boolean)

  return (
    <>
      <header>
        <p className="text-sm text-violet">Your World</p>
        <h1 className="mt-2 font-display text-display-lg text-ink">
          {greeting(hour)}, {firstName(user.name)}
        </h1>
        <p className="mt-4 max-w-xl text-pretty text-[0.9375rem] leading-relaxed text-ink-2">{summary.join(" ")}</p>
      </header>
      <YouNav className="mt-8" />

      {/* Unread count and the 3 latest conversations; nothing when signed out (§7.3). */}
      <InboxSummaryCard className="mt-10" />

      {!onboarded ? (
        <div className="mt-10 flex flex-col gap-4 rounded-lg border border-line-soft bg-card p-5 sm:flex-row sm:items-center sm:justify-between md:p-6">
          <div className="flex items-start gap-4">
            <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-purple/15 text-violet">
              <Sparkles className="size-5" aria-hidden />
            </span>
            <div>
              <p className="text-base text-ink">Tell us what you&apos;re into</p>
              <p className="mt-1 text-sm text-ink-2">Three quick picks, under a minute. They tune Discover and the brands we suggest.</p>
            </div>
          </div>
          <Button asChild variant="primary">
            <Link href="/welcome?next=/you">Personalise</Link>
          </Button>
        </div>
      ) : null}

      {drops.length ? (
        <section aria-labelledby="you-drops" className="mt-24 md:mt-32">
          <div id="you-drops">
            <SectionHeader
              title={followedUpcoming.length ? "Coming from brands you follow" : "Upcoming drops"}
              description={
                followedUpcoming.length
                  ? "Limited releases from your brands. Set a reminder and we'll tell you the moment one goes live."
                  : "None of your brands have a drop scheduled, so here's everything coming up."
              }
              href="/drops"
            />
          </div>
          <Rail label="Upcoming drops" itemClassName="w-[82vw] sm:w-[46vw] md:w-[38vw] lg:w-[32%]">
            {drops.map((d) => (
              <DropCard key={d.id} drop={d} />
            ))}
          </Rail>
        </section>
      ) : null}

      <section aria-labelledby="you-brands" className="mt-24 md:mt-32">
        <div id="you-brands">
          <SectionHeader title="Brands you follow" description="Their new pieces, collections, drops and stories arrive in Following." href={rowBrands.length ? "/following" : undefined} action="Open your feed" />
        </div>
        {rowBrands.length ? (
          <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-4">
            {rowBrands.map((b) => (
              <BrandCard key={b.id} brand={b} variant="row" />
            ))}
          </div>
        ) : (
          <InlineEmpty icon={Storefront} title="No brands yet" body="Follow a studio to see its drops and new pieces here first." href="/brands" action="Browse brands" />
        )}
      </section>

      <section aria-labelledby="you-saved" className="mt-24 md:mt-32">
        <div id="you-saved">
          <SectionHeader title="Saved pieces" description={saved.length > 4 ? `The latest 4 of ${saved.length}.` : "Everything you've hearted, from every brand."} href={saved.length ? "/wishlist" : undefined} />
        </div>
        {saved.length ? (
          <div className="grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-4 md:grid-cols-4">
            {saved.slice(0, 4).map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        ) : (
          <InlineEmpty icon={Heart} title="Nothing saved yet" body="Tap the heart on any piece to keep it here." href="/shop" action="Browse the shop" />
        )}
      </section>

      {viewed.length ? (
        <section aria-labelledby="you-viewed" className="mt-24 md:mt-32">
          <div id="you-viewed">
            <SectionHeader title="Recently viewed" description="Pick up where you left off." />
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-4 md:grid-cols-4">
            {viewed.map((p) => (
              <ProductCard key={p.id} product={p} variant="compact" />
            ))}
          </div>
        </section>
      ) : null}

      {recommended.length ? (
        <section aria-labelledby="you-recommended" className="mt-24 md:mt-32">
          <div id="you-recommended">
            <SectionHeader
              title="Brands you might like"
              description={interests.length ? "Matched to your interests, with a lift for studios growing fast." : "Fast-growing studios. Add interests below and these get more personal."}
              href="/brands"
              action="All brands"
            />
          </div>
          <div className="rail -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 *:w-[78vw] *:shrink-0 *:snap-start sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-0 sm:*:w-auto lg:grid-cols-4">
            {recommended.map((b) => (
              <BrandCard key={b.id} brand={b} showProducts />
            ))}
          </div>
        </section>
      ) : null}

      <div className="mt-24 grid grid-cols-[minmax(0,1fr)] gap-16 md:mt-32 lg:grid-cols-2 lg:gap-12">
        <section aria-labelledby="you-orders">
          <div id="you-orders">
            <SectionHeader title="Recent orders" description="Each brand ships its own part of a checkout." href={hasRecent ? "/you/orders" : undefined} action="All orders" />
          </div>
          {server === null ? (
            <div className="h-32 animate-pulse rounded-lg border border-line-soft bg-card" aria-hidden />
          ) : server?.failed ? (
            <InlineEmpty icon={Package} title="Couldn’t load your orders" body="Check your connection and reload the page. Your orders are safe either way." href="/you/orders" action="Open your orders" />
          ) : server ? (
            serverGroups.length ? (
              <ul className="grid grid-cols-[minmax(0,1fr)] gap-3">
                {serverGroups.map((g) => (
                  <li key={g.id} className="rounded-lg border border-line-soft bg-card">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line-soft px-4 py-3">
                      <p className="text-sm text-ink tabular">Checkout {g.reference}</p>
                      <p className="text-xs text-ink-2">
                        {formatDay(g.placedAt)}, <span className="tabular">{formatOrderMoney(g.totalMinor, g.currency as CurrencyCode)}</span>
                      </p>
                    </div>
                    <ul className="divide-y divide-line-soft">
                      {g.orders.map((o) => (
                        <li key={o.id}>
                          <Link href={`/you/orders/${encodeURIComponent(o.id)}`} className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-elevated">
                            <span className="min-w-0">
                              <span className="block truncate text-sm text-ink">{o.brand.name}</span>
                              <span className="block truncate text-xs text-ink-3">
                                {o.previewItems[0]?.name}
                                {o.itemCount > (o.previewItems[0]?.qty ?? 0) && o.previewItems[0] ? ` and ${o.itemCount - o.previewItems[0].qty} more` : ""}
                              </span>
                            </span>
                            <OrderStatusBadge status={merchantStatusOf(o.states.merchant)} />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            ) : (
              <InlineEmpty icon={Package} title="No orders yet" body="Every brand's order and tracking shows up here." href="/shop" action="Start shopping" />
            )
          ) : recentGroups.length ? (
            <ul className="grid grid-cols-[minmax(0,1fr)] gap-3">
              {recentGroups.map((g) => {
                const list = g.orderIds.map((id) => orderById.get(id)).filter((o): o is MerchantOrder => !!o)
                return (
                  <li key={g.id} className="rounded-lg border border-line-soft bg-card">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line-soft px-4 py-3">
                      <p className="flex items-center gap-2 text-sm text-ink tabular">
                        Checkout {g.reference}
                        {isSampleCheckout(g.id) ? <SampleChip /> : null}
                      </p>
                      <p className="text-xs text-ink-2">
                        {formatDay(g.placedAt)}, <span className="tabular">{formatOrderMoney(g.total, g.currency)}</span>
                      </p>
                    </div>
                    <ul className="divide-y divide-line-soft">
                      {list.map((o) => (
                        <li key={o.id}>
                          <Link href={`/you/orders/${o.id}`} className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-elevated">
                            <span className="min-w-0">
                              <span className="block truncate text-sm text-ink">{brandById.get(o.brandId)?.name}</span>
                              <span className="block truncate text-xs text-ink-3">
                                {o.lines[0]?.name}
                                {o.lines.length > 1 ? ` and ${o.lines.length - 1} more` : ""}
                              </span>
                            </span>
                            <OrderStatusBadge order={o} />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </li>
                )
              })}
            </ul>
          ) : (
            <InlineEmpty icon={Package} title="No orders yet" body="Every brand's order and tracking shows up here." href="/shop" action="Start shopping" />
          )}
        </section>

        <section aria-labelledby="you-interests">
          <div id="you-interests">
            <SectionHeader title="Your interests" description="These shape Picked for you on Discover and the brands we suggest." />
          </div>
          <InterestEditor />
        </section>
      </div>
    </>
  )
}
