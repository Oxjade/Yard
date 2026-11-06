"use client"

import { useEffect, useRef, useState } from "react"
import Image from "next/image"
import { CaretDownIcon as ChevronDown, ShoppingBagOpenIcon as ShoppingBag } from "@phosphor-icons/react"
import { AnimatePresence, motion } from "motion/react"
import { duration, ease } from "@/lib/motion"
import { BrandMark } from "@/components/market/brand-mark"
import { Price } from "@/components/market/price"
import { countries, shippingZone, type CountryCode, type CurrencyCode } from "@/config/markets"
import { variantLabel } from "@/lib/data/products"
import { cn } from "@/lib/utils"
import type { BrandGroup } from "@/lib/cart"
import { shippingMethodLabel, shippingPrice, type ShippingMethod } from "./shipping"

export type CheckoutTotals = { subtotal: number; shipping: number; total: number; count: number }

type SummaryProps = {
  groups: BrandGroup[]
  totals: CheckoutTotals
  currency: CurrencyCode
  shipTo: CountryCode
  methodFor: (brandId: string) => ShippingMethod
}

const money = (amount: number, currency: CurrencyCode, className?: string) =>
  amount === 0 ? <span className={cn("text-sm", className)}>Free</span> : <Price amount={amount} currency={currency} className={className} />

/** The bag again, grouped by brand, with the shipping each brand will charge. */
function SummaryLines({ groups, currency, methodFor }: Pick<SummaryProps, "groups" | "currency" | "methodFor">) {
  return (
    <ul className="grid gap-6" aria-label="Pieces by brand">
      {groups.map((g) => {
        const method = methodFor(g.brand.id)
        return (
          <li key={g.brand.id}>
            <div className="flex items-center gap-2.5">
              <BrandMark brand={g.brand} size="sm" />
              <div className="min-w-0">
                <p className="truncate text-sm text-ink">{g.brand.name}</p>
                <p className="truncate text-xs text-ink-2">
                  Ships from {g.brand.city}, {countries[g.brand.shipsFrom].name}
                </p>
              </div>
            </div>
            <ul className="mt-3 grid gap-3">
              {g.lines.map((l) => (
                <li key={l.variant.id} className="flex items-start gap-3">
                  <div className="relative h-16 w-13 shrink-0 overflow-hidden rounded-md bg-surface">
                    <Image src={l.product.images[0].src} alt={l.product.images[0].alt} fill sizes="52px" className="object-cover" />
                    {l.line.quantity > 1 ? (
                      <span className="absolute right-1 bottom-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-obsidian/85 px-1 text-[10px] text-ink tabular" aria-hidden>
                        {l.line.quantity}
                      </span>
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink">{l.product.name}</p>
                    <p className="truncate text-xs text-ink-2">{variantLabel(l.variant.options)}</p>
                    <p className="text-xs text-ink-3 tabular">Qty {l.line.quantity}</p>
                  </div>
                  <Price amount={l.total} currency={currency} />
                </li>
              ))}
            </ul>
            <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-line-soft pt-2.5 text-xs text-ink-2">
              <span>{shippingMethodLabel[method]} shipping</span>
              {money(shippingPrice(g, method), currency, "text-xs text-ink-2")}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/** Subtotal, shipping, taxes and the total: always visible, never inside a scroll area. */
function SummaryTotals({ groups, totals, currency, shipTo }: Pick<SummaryProps, "groups" | "totals" | "currency" | "shipTo">) {
  const crossBorder = groups.some((g) => shippingZone(g.brand.shipsFrom, shipTo) !== "domestic")
  return (
    <div>
      <dl className="grid gap-2 text-sm">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-ink-2">Subtotal, {totals.count} {totals.count === 1 ? "item" : "items"}</dt>
          <dd>
            <Price amount={totals.subtotal} currency={currency} />
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-ink-2">
            Shipping, {groups.length} {groups.length === 1 ? "brand" : "brands"}
          </dt>
          <dd>{money(totals.shipping, currency)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-ink-2">Taxes</dt>
          <dd className="text-sm">Included in prices</dd>
        </div>
      </dl>
      <div className="mt-4 flex items-baseline justify-between gap-4 border-t border-line-soft pt-4">
        <span className="text-base text-ink">Total</span>
        <Price amount={totals.total} currency={currency} size="lg" />
      </div>
      <p className="mt-3 text-xs leading-relaxed text-ink-3">
        {crossBorder
          ? `Import duties for parcels crossing into ${countries[shipTo].name}, if any, are collected by the courier on delivery.`
          : "Every parcel ships within the country, so nothing more is due on delivery."}
      </p>
    </div>
  )
}

/** Desktop: a sticky panel beside the steps. Only the pieces scroll; the totals stay put. */
export function OrderSummaryAside(props: SummaryProps) {
  return (
    <aside aria-labelledby="order-summary-title" className="hidden lg:block">
      <div className="sticky top-28 flex max-h-[calc(100dvh-8.5rem)] flex-col rounded-lg border border-line-soft bg-card">
        <div className="shrink-0 px-5 pt-5 pb-4 xl:px-6 xl:pt-6">
          <h2 id="order-summary-title" className="text-base font-medium text-ink">
            Order summary
          </h2>
          <p className="mt-1 text-xs text-ink-2">
            {props.groups.length === 1 ? "One brand, one order." : `${props.groups.length} brands, ${props.groups.length} orders, one payment.`}
          </p>
        </div>
        <ScrollArea>
          <SummaryLines {...props} />
        </ScrollArea>
        <div className="shrink-0 border-t border-line px-5 pt-4 pb-5 xl:px-6 xl:pb-6">
          <SummaryTotals {...props} />
        </div>
      </div>
    </aside>
  )
}

/** The pieces list in the desktop panel: scrolls on its own, and fades out while more sits below. */
function ScrollArea({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState(false)
  const [overflows, setOverflows] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      setOverflows(el.scrollHeight > el.clientHeight + 4)
      setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 4)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    el.addEventListener("scroll", update, { passive: true })
    return () => {
      ro.disconnect()
      el.removeEventListener("scroll", update)
    }
  }, [])
  return (
    <div className="relative flex min-h-0 flex-1 flex-col border-t border-line-soft">
      <div
        ref={ref}
        role="region"
        aria-label="Pieces in this checkout"
        tabIndex={overflows ? 0 : undefined}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 outline-none focus-visible:ring-2 focus-visible:ring-violet focus-visible:ring-inset xl:px-6"
      >
        {children}
      </div>
      <span
        aria-hidden
        className={cn("pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-card to-transparent transition-opacity duration-200", more ? "opacity-100" : "opacity-0")}
      />
    </div>
  )
}

/** Phone: collapsed above the step, total always visible. */
export function OrderSummaryDisclosure(props: SummaryProps) {
  const [open, setOpen] = useState(false)
  return (
    <section aria-label="Order summary" className="rounded-lg border border-line-soft bg-card lg:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? "order-summary-panel" : undefined}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-13 w-full items-center justify-between gap-3 rounded-lg px-4 py-3.5 text-left transition-colors outline-none hover:bg-elevated/50 focus-visible:ring-2 focus-visible:ring-violet"
      >
        <span className="flex items-center gap-2 text-sm text-ink">
          <ShoppingBag className="size-4 text-ink-2" />
          {open ? "Hide order summary" : "Show order summary"}
        </span>
        <span className="flex items-center gap-2">
          <Price amount={props.totals.total} currency={props.currency} />
          <ChevronDown className={cn("size-4 text-ink-2 transition-transform duration-200 ease-out-quint", open && "rotate-180")} />
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            id="order-summary-panel"
            key="panel"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0, transition: { duration: duration.dropdown, ease: ease.out } }}
            exit={{ opacity: 0, transition: { duration: duration.press, ease: ease.in } }}
          >
            <div className="border-t border-line-soft px-4 pt-4 pb-5">
              <SummaryLines {...props} />
              <div className="mt-6 border-t border-line pt-5">
                <SummaryTotals {...props} />
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  )
}
