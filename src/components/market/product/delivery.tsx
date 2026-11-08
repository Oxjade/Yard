"use client"

import Link from "next/link"
import { ClockIcon, PackageIcon as Package, ArrowCounterClockwiseIcon as RotateCcw, TruckIcon as Truck, LightningIcon } from "@phosphor-icons/react"
import { Bone } from "@/components/feedback/skeletons"
import { AskAboutProductLink } from "@/components/inbox/entry"
import { RetryButton } from "@/components/market/delivery/delivery-bits"
import { DestinationPicker } from "@/components/market/delivery/destination-picker"
import { countries, type CountryCode, type CurrencyCode } from "@/config/markets"
import { useHydrated } from "@/hooks/use-hydrated"
import { getDemoAnchor, useNow } from "@/hooks/use-now"
import type { EstimateResponse, QuoteOptionDto } from "@/lib/api/contracts/shipping"
import { estimateKey, getEstimate } from "@/lib/api/shipping"
import { useApi } from "@/lib/api/use-api"
import { dropWindow } from "@/lib/drops"
import { dateIn } from "@/lib/shipping/calendar"
import { businessDays, formatDay, formatDayShort, formatRange, formatShortRange } from "@/lib/shipping/format"
import { useSession } from "@/lib/stores/session"
import type { Brand, Drop, Product } from "@/lib/data/types"
import { LocaleSelect } from "../locale-select"
import { Price } from "../price"

/** Country names that take "the" inside a sentence ("to the United Kingdom"). */
const takesArticle = new Set<CountryCode>(["GB", "US"])

/** A country as it reads mid-sentence: "the United Kingdom", "Nigeria". */
export function countryInSentence(code: CountryCode) {
  return takesArticle.has(code) ? `the ${countries[code].name}` : countries[code].name
}

const andList = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`)

/**
 * The server's estimate for this piece to the shopper's destination (GET /api/shipping/estimate,
 * §6.5). Fetched after hydration only, so no clock is read on the server. An unreleased drop
 * counts from its release, as this browser's drop clock reads it.
 */
export function useProductEstimate(product: Product, drop?: Drop | null) {
  const hydrated = useHydrated()
  const shipTo = useSession((s) => s.shipTo)
  const shipToCity = useSession((s) => s.shipToCity)
  const currency = useSession((s) => s.currency)
  const now = useNow(60_000)
  const release = hydrated && drop && now !== null ? dropWindow(drop, getDemoAnchor()).release : null
  const upcoming = release !== null && now !== null && release > now
  const q = { product: product.id, to: shipTo, city: shipToCity, cur: currency, release: upcoming ? new Date(release).toISOString() : null }
  const r = useApi<EstimateResponse>(hydrated ? estimateKey(q) : null, () => getEstimate(q), { revalidateOnFocus: false, refreshInterval: 10 * 60_000 })
  return {
    data: r.data,
    isLoading: !hydrated || r.isLoading,
    error: r.data ? undefined : r.error,
    retry: () => void r.revalidate(),
    retrying: r.isValidating,
    releaseAt: upcoming ? release : null,
    currency: currency as CurrencyCode,
  }
}

const parcel = (d: EstimateResponse | undefined) => d?.options.filter((o) => o.available && o.service !== "pickup") ?? []
const standardOf = (d: EstimateResponse | undefined) => parcel(d).find((o) => o.service === "standard") ?? parcel(d)[0] ?? null

/** "Includes Christmas Day (25 Dec) and Boxing Day (28 Dec)." */
function holidayNote(o: QuoteOptionDto | null) {
  const seen = new Map<string, string>()
  for (const h of o?.estimate?.holidaysCrossed ?? []) if (!seen.has(h.name)) seen.set(h.name, `${h.name} (${formatDayShort(h.date)})`)
  const list = [...seen.values()].slice(0, 3)
  return list.length ? `Includes ${andList(list)}.` : null
}

/** Lines under Add to bag: destination, estimated delivery, dispatch, express, who ships it, returns (§6.5). */
export function DeliverySummary({ brand, product, drop, status = "available", variantId }: { brand: Brand; product: Product; drop?: Drop | null; status?: "available" | "unreleased" | "unavailable"; variantId?: string | null }) {
  const e = useProductEstimate(product, status === "unreleased" ? drop : null)
  const now = useNow(30_000)
  const d = e.data
  const std = standardOf(d)
  const express = parcel(d).find((o) => o.service === "express") ?? null
  const range = std?.estimate?.arrivalFrom && std.estimate.arrivalTo ? formatRange(std.estimate.arrivalFrom, std.estimate.arrivalTo) : null
  const city = d?.brand.originCity ?? brand.city
  const beforeCutoff = !!d?.cutoffAt && now !== null && now < Date.parse(d.cutoffAt)
  const failed = !e.isLoading && !!e.error
  const loading = e.isLoading && !d

  let truck: React.ReactNode
  if (loading) truck = <Bone className="mt-0.5 h-4 w-[180px]" />
  else if (failed)
    truck = (
      <span role="status" className="flex flex-wrap items-center gap-x-1.5 text-ink-2">
        Couldn&apos;t load a delivery estimate
        <span aria-hidden>·</span>
        <RetryButton onRetry={e.retry} retrying={e.retrying} />
      </span>
    )
  else if (!d || d.unavailable || !std) truck = <span className="text-ink">{d?.reason ?? "Doesn't ship here"}</span>
  else if (status === "unreleased" && e.releaseAt)
    truck = (
      <span className="text-ink-2">
        Ships after the drop on <span className="text-ink">{formatDay(dateIn(d.brand.timeZone, e.releaseAt))}</span>. Estimated delivery{" "}
        <span className="text-ink">{formatShortRange(std.estimate!.arrivalFrom!, std.estimate!.arrivalTo!)}</span>.
      </span>
    )
  else if (status === "unavailable")
    truck = (
      <span className="text-ink-2">
        Not available right now. When it is, {brand.name} usually delivers to {countryInSentence(d.destination.country as CountryCode)} in{" "}
        {businessDays([d.handling[0] + std.transit[0], d.handling[1] + std.transit[1]])}.
      </span>
    )
  else
    truck = (
      <span className="text-ink-2">
        Estimated delivery <span className="text-ink">{range}</span>
      </span>
    )

  const countriesNamed = d ? andList(d.calendarCountries.map((c) => countries[c as CountryCode]?.name ?? c)) : null
  const holidays = holidayNote(std)

  return (
    <div className="grid gap-3">
      <DestinationPicker />
      <ul className="grid gap-3 text-sm" aria-live="polite">
        <li className="flex gap-3">
          <Truck className="mt-0.5 size-4 shrink-0 text-ink-2" aria-hidden />
          {truck}
        </li>
        {d && !d.unavailable && std && status !== "unavailable" ? (
          <li className="flex gap-3">
            <ClockIcon className="mt-0.5 size-4 shrink-0 text-ink-2" aria-hidden />
            <span className="text-ink-2">
              Usually dispatches in <span className="text-ink">{businessDays(d.handling)}</span>.
              {beforeCutoff && status === "available" ? ` Order by ${d.brand.cutoffLocal} ${city} time to count from today.` : ""}
            </span>
          </li>
        ) : loading ? (
          <li className="flex gap-3">
            <ClockIcon className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
            <Bone className="mt-0.5 h-4 w-[220px]" />
          </li>
        ) : null}
        {express?.estimate?.arrivalFrom && express.estimate.arrivalTo && status === "available" ? (
          <li className="flex gap-3">
            <LightningIcon className="mt-0.5 size-4 shrink-0 text-ink-2" aria-hidden />
            <span className="text-ink-2">
              Express: est. <span className="text-ink">{formatRange(express.estimate.arrivalFrom, express.estimate.arrivalTo)}</span>,{" "}
              {express.free ? "free" : <Price amount={express.price.amount} currency={express.price.currency as CurrencyCode} className="text-sm text-ink-2" />}
            </span>
          </li>
        ) : null}
        <li className="flex gap-3">
          <Package className="mt-0.5 size-4 shrink-0 text-ink-2" aria-hidden />
          <span className="text-ink-2">
            Sold and shipped by <span className="text-ink">{brand.name}</span> from {city}, {countries[(d?.brand.originCountry as CountryCode) ?? brand.shipsFrom]?.name}.
          </span>
        </li>
        <li className="flex gap-3">
          <RotateCcw className="mt-0.5 size-4 shrink-0 text-ink-2" aria-hidden />
          <span className="text-ink-2">
            <span className="text-ink">{brand.returnsDays}-day returns</span> from the day it arrives.
          </span>
        </li>
      </ul>
      {d && !d.unavailable && countriesNamed ? (
        <p className="text-xs leading-relaxed text-ink-3">
          Estimates, not guarantees. They skip weekends and public holidays in {countriesNamed}.{holidays ? ` ${holidays}` : ""}
        </p>
      ) : null}
      {/* Sizing, stock or a delivery that doesn't fit: ask the brand, with this piece (and size) attached (§7.4). */}
      <AskAboutProductLink brand={brand} productId={product.id} variantId={variantId} className="-my-1 justify-self-start" />
    </div>
  )
}

/**
 * The Shipping accordion: every option this piece ships with to the shopper's destination, with
 * price, business days in transit and estimated dates, and the brand's free-shipping tier.
 */
export function ShippingDetails({ brand, product }: { brand: Brand; product: Product }) {
  const e = useProductEstimate(product)
  const d = e.data
  const options = d?.options.filter((o) => o.available) ?? []
  const std = standardOf(d)
  const to = (d?.destination.country as CountryCode | undefined) ?? null

  return (
    <div className="grid gap-4 text-sm leading-relaxed text-ink-2">
      <p>
        {brand.name} ships its own orders from {d?.brand.originCity ?? brand.city}
        {d ? ` and usually dispatches in ${businessDays(d.handling)}` : ""}. Times below are business days in transit, after dispatch{to ? `, to ${countryInSentence(to)}` : ""}.
      </p>
      {e.isLoading && !d ? (
        <div className="grid gap-2" role="status" aria-label="Loading shipping options">
          <Bone className="h-12 w-full" />
          <Bone className="h-12 w-full" />
        </div>
      ) : !d && e.error ? (
        <p role="status" className="flex flex-wrap items-center gap-x-1.5">
          Couldn&apos;t load shipping options
          <span aria-hidden>·</span>
          <RetryButton onRetry={e.retry} retrying={e.retrying} />
        </p>
      ) : d?.unavailable ? (
        <p className="text-ink">{d.reason}</p>
      ) : d ? (
        <dl className="divide-y divide-line-soft rounded-lg border border-line-soft">
          {options.map((o) => (
            <div key={o.service} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <dt className="min-w-0">
                <span className="text-ink">{o.label}</span>
                <span className="block text-xs text-ink-3">
                  {o.service === "pickup"
                    ? o.estimate?.arrivalFrom
                      ? `Est. ready ${formatDay(o.estimate.arrivalFrom)}`
                      : "Ready once packed"
                    : `${businessDays(o.transit)} in transit${o.estimate?.arrivalFrom && o.estimate.arrivalTo ? `, est. ${formatShortRange(o.estimate.arrivalFrom, o.estimate.arrivalTo)}` : ""}`}
                </span>
              </dt>
              <dd className="shrink-0 text-ink">{o.free ? "Free" : <Price amount={o.price.amount} currency={o.price.currency as CurrencyCode} />}</dd>
            </div>
          ))}
          {std?.freeOver ? (
            <div className="flex items-center justify-between gap-3 px-3 py-2.5">
              <dt>Free standard shipping on {brand.name} orders over</dt>
              <dd className="shrink-0 text-ink">
                <Price amount={std.freeOver.amount} currency={std.freeOver.currency as CurrencyCode} />
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      <p className="text-xs text-ink-3">Prices are for this piece alone. Checkout prices shipping once for everything in your cart from {brand.name}. Delivery dates are estimates, not guarantees.</p>
      {to && d && to !== d.brand.originCountry ? <p>Import duties for {countryInSentence(to)}, if any, are collected by the courier on delivery.</p> : null}
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
