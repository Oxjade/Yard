"use client"

import Link from "next/link"
import { Package, RotateCcw, Truck } from "lucide-react"
import { countries, freeShippingThresholdUsd, shippingZone, type CountryCode } from "@/config/markets"
import { useHydrated } from "@/hooks/use-hydrated"
import { useNow } from "@/hooks/use-now"
import { priceCart } from "@/lib/cart"
import { useSession } from "@/lib/stores/session"
import type { Brand, Product } from "@/lib/data/types"
import { arrivalRange, deliveryDays, shippingMethodLabel, shippingPrice } from "../checkout/shipping"
import { LocaleSelect } from "../locale-select"
import { Price } from "../price"

/**
 * Delivery estimate to the shopper's ship-to country, worked out with checkout's own helpers
 * (the brand's processing time plus transit, in business days) so the page promises what
 * checkout shows. The arrival dates read the clock, so they only appear after mount.
 */
export function useDelivery(brand: Brand) {
  const hydrated = useHydrated()
  const shipTo = useSession((s) => s.shipTo)
  const now = useNow(60_000)
  const to: CountryCode = hydrated ? shipTo : "NG"
  const days = deliveryDays(brand, to, "standard")
  const arrival = now === null ? null : arrivalRange(new Date(now), days)
  return { to, country: countries[to].name, zone: shippingZone(brand.shipsFrom, to), days, arrival }
}

/** Three short lines under Add to bag: arrival, who ships it, returns. */
export function DeliverySummary({ brand, status = "available" }: { brand: Brand; status?: "available" | "unreleased" | "unavailable" }) {
  const d = useDelivery(brand)
  const range = `${d.days[0]} to ${d.days[1]} business days`
  return (
    <ul className="grid gap-3 text-sm">
      <li className="flex gap-3">
        <Truck className="mt-0.5 size-4 shrink-0 text-ink-2" aria-hidden />
        {status === "unreleased" ? (
          <span className="text-ink-2">
            <span className="text-ink">Ships after release</span>, then arrives in {range} with standard shipping to {d.country}.
          </span>
        ) : status === "unavailable" ? (
          <span className="text-ink-2">
            Usually arrives in {range} with standard shipping to {d.country}.
          </span>
        ) : (
          <span className="text-ink-2">
            <span className="text-ink">{d.arrival ? `Arrives ${d.arrival}` : `Arrives in ${range}`}</span> with standard shipping to {d.country}.
          </span>
        )}
      </li>
      <li className="flex gap-3">
        <Package className="mt-0.5 size-4 shrink-0 text-ink-2" aria-hidden />
        <span className="text-ink-2">
          Sold and shipped by <span className="text-ink">{brand.name}</span> from {brand.city}, {countries[brand.shipsFrom].name}.
        </span>
      </li>
      <li className="flex gap-3">
        <RotateCcw className="mt-0.5 size-4 shrink-0 text-ink-2" aria-hidden />
        <span className="text-ink-2">
          <span className="text-ink">{brand.returnsDays}-day returns</span> from the day it arrives.
        </span>
      </li>
    </ul>
  )
}

/**
 * Shipping rates for this piece on its own, priced through the cart and checkout helpers
 * (priceCart + shippingPrice), so standard, express and the free-shipping rule match what
 * checkout charges for the same order.
 */
export function ShippingDetails({ brand, product }: { brand: Brand; product: Product }) {
  const hydrated = useHydrated()
  const shopperCurrency = useSession((s) => s.currency)
  const currency = hydrated ? shopperCurrency : "USD"
  const d = useDelivery(brand)
  const variant = product.variants[0]
  const group = variant ? priceCart([{ productId: product.id, variantId: variant.id, quantity: 1, addedAt: 0 }], d.to, currency).groups[0] : undefined

  return (
    <div className="grid gap-4 text-sm leading-relaxed text-ink-2">
      <p>
        {brand.name} ships its own orders from {brand.city} and packs them in {brand.processingDays[0]} to {brand.processingDays[1]} business days. Times below run from your
        order to your door in {d.country}.
      </p>
      {group ? (
        <dl className="divide-y divide-line-soft rounded-lg border border-line-soft">
          {(["standard", "express"] as const).map((m) => {
            const price = shippingPrice(group, m)
            const days = deliveryDays(brand, d.to, m)
            return (
              <div key={m} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <dt>
                  <span className="text-ink">{shippingMethodLabel[m]}</span>
                  <span className="block text-xs text-ink-3">
                    {days[0]} to {days[1]} business days
                  </span>
                </dt>
                <dd className="text-ink">{price === 0 ? "Free" : <Price amount={price} currency={currency} />}</dd>
              </div>
            )
          })}
          <div className="flex items-center justify-between gap-3 px-3 py-2.5">
            <dt>Free standard shipping on {brand.name} orders over</dt>
            <dd className="text-ink">
              <Price amount={freeShippingThresholdUsd} currency="USD" />
            </dd>
          </div>
        </dl>
      ) : null}
      <p className="text-xs text-ink-3">Prices are for this piece alone. Checkout prices shipping once for everything in your bag from {brand.name}.</p>
      {d.zone === "international" ? <p>Duties and import taxes for {d.country} are shown at checkout, before you pay.</p> : null}
      <div>
        <p className="mb-2 text-xs text-ink-3">Shipping somewhere else? Change your country and the estimate updates.</p>
        <LocaleSelect />
      </div>
    </div>
  )
}

export function ReturnsDetails({ brand }: { brand: Brand }) {
  return (
    <div className="grid gap-3 text-sm leading-relaxed text-ink-2">
      <p>
        {brand.name} accepts returns within {brand.returnsDays} days of delivery. Pieces should be unworn and unused, with their tags and packaging.
      </p>
      <p>
        Start a return from your orders. Once {brand.name} receives the piece, the refund goes back to the way you paid.
      </p>
      <Link href="/you/orders" className="w-fit text-violet underline-offset-4 hover:underline">
        Go to your orders
      </Link>
    </div>
  )
}
