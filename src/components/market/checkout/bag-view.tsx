"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { PackageIcon as Package, ShoppingBagOpenIcon as ShoppingBag } from "@phosphor-icons/react"
import { AnimatePresence, motion } from "motion/react"
import { BagGroups } from "@/components/market/bag-contents"
import { bagCount } from "@/components/market/bag-count"
import { Price } from "@/components/market/price"
import { ProductCard } from "@/components/market/product-card"
import { SectionHeader } from "@/components/market/section-header"
import { Button } from "@/components/ui/button"
import { ArrivalChip, RetryButton, ShippingAmount } from "@/components/market/delivery/delivery-bits"
import { useShippingQuote } from "@/components/market/delivery/use-shipping-quote"
import { Bone } from "@/components/feedback/skeletons"
import { countries } from "@/config/markets"
import { priceCart } from "@/lib/cart"
import { productById, productStock } from "@/lib/data/products"
import { duration, ease } from "@/lib/motion"
import { useCart } from "@/lib/stores/cart"
import { useSaved } from "@/lib/stores/saved"
import { useSession } from "@/lib/stores/session"
import type { Product } from "@/lib/data/types"
import { Notice } from "./fields"
import { BagSkeleton } from "./skeletons"
import { useStoresReady } from "./use-stores-ready"

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The cart page (/bag): lines grouped by brand, a summary with one Checkout, and saved pieces. */
export function BagView() {
  const ready = useStoresReady()
  const router = useRouter()
  const lines = useCart((s) => s.lines)
  const currency = useSession((s) => s.currency)
  const shipTo = useSession((s) => s.shipTo)
  const shipToCity = useSession((s) => s.shipToCity)
  const requireAuth = useSession((s) => s.requireAuth)
  const wishlist = useSaved((s) => s.wishlist)
  // Shipping comes only from the server's quote (§6.5): a Bone while it loads, "Shipping not
  // included" when it couldn't load.
  const quote = useShippingQuote(lines, shipTo, shipToCity, currency, { enabled: ready })
  const bag = useMemo(() => priceCart(lines, shipTo, currency, quote.quotes), [lines, shipTo, currency, quote.quotes])
  const quoteFailed = !quote.isLoading && !!quote.error

  const saved = useMemo(() => {
    const inBag = new Set(lines.map((l) => l.productId))
    return wishlist
      .map((id) => productById.get(id))
      // Only pieces that could join this order: published, in stock and not already in the bag.
      .filter((p): p is Product => !!p && p.status === "published" && productStock(p) > 0 && !inBag.has(p.id))
      .slice(0, 4)
  }, [wishlist, lines])

  function checkout() {
    const go = () => router.push("/checkout")
    if (requireAuth("checkout", go)) go()
  }

  const brandCount = bag.groups.length

  // Phones: until the summary scrolls into view, a compact total with Checkout floats above
  // the home bar (clear of its raised Around pin) so the next step is always one tap away.
  const summaryRef = useRef<HTMLElement>(null)
  const [summaryAhead, setSummaryAhead] = useState(false)
  const hasLines = ready && brandCount > 0
  useEffect(() => {
    const el = summaryRef.current
    if (!hasLines || !el) return
    const io = new IntersectionObserver(([e]) => setSummaryAhead(!e.isIntersecting && e.boundingClientRect.top > 0), { rootMargin: "0px 0px -96px 0px" })
    io.observe(el)
    return () => io.disconnect()
  }, [hasLines])
  // Removing a line moves focus to the next line (BagGroups handles that); removing the last
  // one moves it to the empty state's title, so keyboard users keep their place.
  const emptyTitle = useRef<HTMLParagraphElement>(null)

  const returns = bag.groups.map((g) => g.brand.returnsDays)
  const [minReturns, maxReturns] = [Math.min(...returns), Math.max(...returns)]

  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
        <h1 className="font-display text-display-lg text-ink">Cart</h1>
        {ready && brandCount > 0 ? (
          <p className="text-sm text-ink-2 tabular">
            {plural(bagCount(lines), "item")} from {plural(brandCount, "brand")}
          </p>
        ) : null}
      </div>

      {!ready ? (
        <BagSkeleton />
      ) : brandCount === 0 ? (
        <div className="mt-10 flex flex-col items-center gap-4 rounded-lg border border-line-soft bg-card px-6 py-16 text-center">
          <span className="inline-flex size-14 items-center justify-center rounded-full border border-line">
            <ShoppingBag className="size-6 text-ink-2" />
          </span>
          <div>
            <p ref={emptyTitle} tabIndex={-1} className="text-base text-ink outline-none">
              Your cart is empty
            </p>
            <p className="mt-1 max-w-sm text-sm text-ink-2">Add pieces from any brand and they check out together, one order per brand.</p>
          </div>
          <Button asChild variant="primary">
            <Link href="/brands">Discover brands</Link>
          </Button>
        </div>
      ) : (
        <div className="mt-8 grid gap-8 md:mt-10 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-12">
          <div className="min-w-0">
            <Notice icon={Package} className="mb-4">
              One checkout creates one order per brand. Each brand packs and ships its own parcel, with its own tracking.
            </Notice>
            {/* Each brand's section shows its day count and shipping line once its quote has loaded (§6.5). */}
            <BagGroups groups={bag.groups} currency={currency} focusWhenEmpty={emptyTitle} />
          </div>

          <aside ref={summaryRef} aria-labelledby="bag-summary-title" className="rounded-lg border border-line-soft bg-card p-5 md:p-6 lg:sticky lg:top-28">
            <h2 id="bag-summary-title" className="text-base font-medium text-ink">
              Summary
            </h2>
            <dl className="mt-5 grid gap-3 text-sm">
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-ink-2">Subtotal</dt>
                <dd>
                  <Price amount={bag.subtotal} currency={currency} />
                </dd>
              </div>
              <div>
                <div className="flex min-h-5 items-center justify-between gap-4">
                  <dt className="text-ink-2">Shipping, {plural(brandCount, "brand")}</dt>
                  <dd>
                    <ShippingAmount amount={bag.shipping} currency={currency} state={quote} unavailable={bag.blocked.length > 0} />
                  </dd>
                </div>
                {quoteFailed ? (
                  <p role="status" className="mt-2 flex flex-wrap items-center gap-x-2 border-l border-line pl-3 text-xs text-ink-2">
                    Shipping is calculated at checkout
                    <RetryButton onRetry={quote.retry} retrying={quote.retrying} />
                  </p>
                ) : (
                  <ul className="mt-2 grid gap-2 border-l border-line pl-3" aria-label="Shipping by brand">
                    {bag.groups.map((g) => (
                      <li key={g.brand.id} className="grid gap-1 text-xs text-ink-2">
                        <span className="flex items-baseline justify-between gap-3">
                          <span className="truncate">
                            {g.brand.name}
                            {g.option ? `, ${g.option.service === "express" ? "express" : "standard"}` : ""}
                          </span>
                          {g.quote ? (
                            g.unavailable ? (
                              <span className="shrink-0">Not available</span>
                            ) : g.option?.free ? (
                              <span>Free</span>
                            ) : g.option ? (
                              <Price amount={g.option.price.amount} currency={currency} className="text-xs text-ink-2" />
                            ) : null
                          ) : (
                            <Bone className="h-3.5 w-12" />
                          )}
                        </span>
                        {g.quote ? (
                          g.unavailable ? <span className="text-ink-3">{g.reason}. Remove its pieces or change the delivery country at checkout.</span> : <ArrivalChip estimate={g.estimate} className="justify-self-start" />
                        ) : (
                          <Bone className="h-5 w-32 rounded-full" />
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </dl>
            <p className="mt-4 text-xs text-ink-3">Taxes aren&apos;t calculated in this build. Import duties, if any, are collected by the courier on delivery. Delivery dates are estimates, not guarantees.</p>
            <div className="mt-5 flex items-baseline justify-between gap-4 border-t border-line-soft pt-5">
              <span className="text-base text-ink">{bag.total === null ? "Subtotal" : "Total"}</span>
              <Price amount={bag.total ?? bag.subtotal} currency={currency} size="lg" />
            </div>
            <div className="mt-5 grid gap-2">
              <Button variant="primary" size="lg" className="w-full" onClick={checkout}>
                Checkout
              </Button>
              <Button asChild variant="secondary" size="lg" className="w-full">
                <Link href="/shop">Continue shopping</Link>
              </Button>
            </div>
            <ul className="mt-5 grid gap-1.5 text-xs leading-relaxed text-ink-3">
              <li>{quoteFailed ? `Shipping to ${countries[shipTo].name} is priced at checkout.` : `Shipping priced for delivery to ${countries[shipTo].name}.`} You can change the address at checkout.</li>
              <li>
                {minReturns === maxReturns
                  ? `Returns accepted within ${minReturns} days of delivery.`
                  : `Returns accepted within ${minReturns} to ${maxReturns} days of delivery, depending on the brand.`}
              </li>
            </ul>
          </aside>
        </div>
      )}

      <AnimatePresence>
        {hasLines && summaryAhead ? (
          <motion.div
            key="bag-bar"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0, transition: { duration: duration.dropdown, ease: ease.out } }}
            exit={{ opacity: 0, y: 12, transition: { duration: duration.press, ease: ease.in } }}
            className="fixed inset-x-4 bottom-(--tabbar-clear) z-30 flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-obsidian/92 py-2 pr-2 pl-4 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.9)] backdrop-blur-xl lg:hidden"
          >
            <p className="min-w-0 text-xs text-ink-2">
              {bag.total === null ? "Subtotal" : "Total"}, {plural(bagCount(lines), "item")}
              <Price amount={bag.total ?? bag.subtotal} currency={currency} className="flex text-base text-ink" />
            </p>
            <Button variant="primary" size="lg" onClick={checkout} className="min-w-36">
              Checkout
            </Button>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {ready && brandCount > 0 && saved.length > 0 ? (
        <section aria-labelledby="saved-title" className="mt-24 md:mt-32">
          <div id="saved-title">
            <SectionHeader title="Saved for later" description="Pieces from your wishlist, in case they belong in this order." href="/wishlist" />
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-4 md:grid-cols-4">
            {saved.map((p) => (
              <ProductCard key={p.id} product={p} variant="compact" sizes="(min-width: 768px) 22vw, 50vw" />
            ))}
          </div>
        </section>
      ) : null}
    </>
  )
}
