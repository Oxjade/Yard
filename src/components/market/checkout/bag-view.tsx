"use client"

import { useMemo } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Package, ShoppingBag } from "lucide-react"
import { BagGroups } from "@/components/market/bag-contents"
import { Price } from "@/components/market/price"
import { ProductCard } from "@/components/market/product-card"
import { SectionHeader } from "@/components/market/section-header"
import { Button } from "@/components/ui/button"
import { countries } from "@/config/markets"
import { priceCart } from "@/lib/cart"
import { productById, productStock } from "@/lib/data/products"
import { useCart } from "@/lib/stores/cart"
import { useSaved } from "@/lib/stores/saved"
import { useSession } from "@/lib/stores/session"
import type { Product } from "@/lib/data/types"
import { Notice } from "./fields"
import { BagSkeleton } from "./skeletons"
import { useStoresReady } from "./use-stores-ready"

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The bag page: lines grouped by brand, a summary with one Checkout, and saved pieces. */
export function BagView() {
  const ready = useStoresReady()
  const router = useRouter()
  const lines = useCart((s) => s.lines)
  const currency = useSession((s) => s.currency)
  const shipTo = useSession((s) => s.shipTo)
  const requireAuth = useSession((s) => s.requireAuth)
  const wishlist = useSaved((s) => s.wishlist)
  const bag = useMemo(() => priceCart(lines, shipTo, currency), [lines, shipTo, currency])

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
  const returns = bag.groups.map((g) => g.brand.returnsDays)
  const [minReturns, maxReturns] = [Math.min(...returns), Math.max(...returns)]

  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
        <h1 className="font-display text-display-lg text-ink">Bag</h1>
        {ready && brandCount > 0 ? (
          <p className="text-sm text-ink-2 tabular">
            {plural(bag.count, "item")} from {plural(brandCount, "brand")}
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
            <p className="text-base text-ink">Your bag is empty</p>
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
            <BagGroups groups={bag.groups} currency={currency} />
          </div>

          <aside aria-labelledby="bag-summary-title" className="rounded-lg border border-line-soft bg-card p-5 md:p-6 lg:sticky lg:top-28">
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
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-ink-2">Shipping, {plural(brandCount, "brand")}</dt>
                  <dd>{bag.shipping === 0 ? <span className="text-sm">Free</span> : <Price amount={bag.shipping} currency={currency} />}</dd>
                </div>
                <ul className="mt-2 grid gap-1.5 border-l border-line pl-3" aria-label="Shipping by brand">
                  {bag.groups.map((g) => (
                    <li key={g.brand.id} className="flex items-baseline justify-between gap-3 text-xs text-ink-2">
                      <span className="truncate">{g.brand.name}, standard</span>
                      {g.freeShipping ? <span>Free</span> : <Price amount={g.shipping} currency={currency} className="text-xs text-ink-2" />}
                    </li>
                  ))}
                </ul>
              </div>
            </dl>
            <p className="mt-4 text-xs text-ink-3">Taxes and duties confirmed at checkout</p>
            <div className="mt-5 flex items-baseline justify-between gap-4 border-t border-line-soft pt-5">
              <span className="text-base text-ink">Total</span>
              <Price amount={bag.total} currency={currency} size="lg" />
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
              <li>Shipping estimated for delivery to {countries[shipTo].name}. You can change the address at checkout.</li>
              <li>
                {minReturns === maxReturns
                  ? `Returns accepted within ${minReturns} days of delivery.`
                  : `Returns accepted within ${minReturns} to ${maxReturns} days of delivery, depending on the brand.`}
              </li>
            </ul>
          </aside>
        </div>
      )}

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
