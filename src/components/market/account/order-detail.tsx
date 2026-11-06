"use client"

import { useRef, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { ArrowCounterClockwiseIcon as RotateCcw, CaretLeftIcon as ChevronLeft, CheckCircleIcon as CheckCircle, ArrowSquareOutIcon as ExternalLink, InfoIcon as Info, StackIcon as PackageSearch } from "@phosphor-icons/react"
import { agoText } from "@/components/market/ago-text"
import { BrandMark } from "@/components/market/brand-mark"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { Button } from "@/components/ui/button"
import { countries } from "@/config/markets"
import { site } from "@/config/site"
import { brandById } from "@/lib/data/brands"
import { productById } from "@/lib/data/products"
import { useOrders } from "@/lib/stores/orders"
import { cn } from "@/lib/utils"
import { daysSince, formatDay, formatOrderMoney } from "./format"
import { isSampleCheckout, OrderStatusBadge, OrderStepper, SampleChip, TrackingLink, orderStatusNote, returnOutcome, trackingUrl } from "./order-status"
import { ReturnDialog } from "./return-dialog"
import { OrderDelivery } from "@/components/market/delivery/order-delivery"
import { businessDays } from "@/lib/shipping/format"
import { YouNav } from "./you-nav"

function Panel({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-lg border border-line-soft bg-card p-4 md:p-6", className)} aria-label={title}>
      <h2 className="text-base font-medium text-ink">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  )
}

/** Shipping method labels in the sample data read "Standard — domestic"; shoppers see "Standard, domestic". */
const methodLabel = (m: string) => m.replace(/\s+—\s+/g, ", ")

/** One brand's order: progress, items, delivery, tracking and returns. */
export function OrderDetail({ id }: { id: string }) {
  const order = useOrders((s) => s.orders.find((o) => o.id === id))
  const group = useOrders((s) => s.groups.find((g) => g.orderIds.includes(id)))
  const requestReturn = useOrders((s) => s.requestReturn)
  const [returnOpen, setReturnOpen] = useState(false)
  const returnOpener = useRef<HTMLButtonElement | null>(null)

  if (!order) {
    return (
      <>
        <BackLink />
        <h1 className="mt-6 font-display text-display-lg text-ink">Order not found</h1>
        <YouNav className="mt-8" />
        <div className="mt-10 flex flex-col items-center gap-4 rounded-lg border border-line-soft bg-card px-6 py-16 text-center">
          <span className="inline-flex size-14 items-center justify-center rounded-full border border-line">
            <PackageSearch className="size-6 text-ink-2" />
          </span>
          <div>
            <p className="text-base text-ink">We can&apos;t find this order in this browser</p>
            <p className="mt-1 max-w-sm text-sm text-ink-2">In this development build orders are kept in the browser they were placed in, so one from another browser or device won&apos;t show here.</p>
          </div>
          <Button asChild variant="primary">
            <Link href="/you/orders">See your orders</Link>
          </Button>
        </div>
      </>
    )
  }

  const brand = brandById.get(order.brandId)!
  const returnRequest = order.returnRequest ?? null
  const decision = returnRequest?.decision ?? null
  const outcome = returnOutcome(order)
  // Pieces on the request (quantities, not lines), as the items count reads.
  const returnedUnits = order.lines.filter((l) => returnRequest?.variantIds.includes(l.variantId)).reduce((n, l) => n + l.quantity, 0)
  const status = order.status
  const note = orderStatusNote(order)
  // Who decided a return: the brand, or the platform (site.name) when its team did.
  const decidedBy = decision?.by === "platform" ? site.name : brand.name
  const refundAmount = decision?.status === "approved" ? formatOrderMoney(decision.amount ?? order.refund?.amount ?? 0, order.currency) : null
  // "Delivered" in the sample history, "Marked delivered by brand" when the brand marks it in Studio; the latest counts.
  const delivered = [...order.timeline].reverse().find((t) => /^(marked )?delivered\b/i.test(t.label))
  const daysSinceDelivery = delivered ? daysSince(delivered.at) : null
  const returnDaysLeft = daysSinceDelivery === null ? null : brand.returnsDays - daysSinceDelivery
  const canReturn = order.status === "delivered" && !returnRequest && returnDaysLeft !== null && returnDaysLeft >= 0
  // "closed yesterday", "closed 4 days ago": the window ends with its last day, so -1 is yesterday.
  const returnClosedAgo = returnDaysLeft !== null && returnDaysLeft < 0 ? agoText(-returnDaysLeft * 86_400_000) : null
  const timeline = [...order.timeline].reverse()
  const count = order.lines.reduce((n, l) => n + l.quantity, 0)
  const address = order.shippingAddress
  const sample = isSampleCheckout(order.groupId)

  // On phones the return action sits right under the items and the timeline goes last.
  const returnsPanel = (
    <Panel title="Returns">
      {returnRequest ? (
        // Focused after the dialog closes, so the result of sending is announced in place.
        <div data-return-status tabIndex={-1} role="status" className="flex gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-violet">
          {decision?.status === "declined" ? <Info className="mt-0.5 size-5 shrink-0 text-ink-3" aria-hidden /> : <CheckCircle className="mt-0.5 size-5 shrink-0 text-violet" weight="fill" aria-hidden />}
          <div className="min-w-0 text-sm text-ink-2">
            <p className="text-ink">
              {decision
                ? decision.status === "declined"
                  ? `Return declined ${formatDay(decision.at)}`
                  : `${decision.partial ? "Partial refund" : "Refund"} approved ${formatDay(decision.at)}`
                : `Return requested ${formatDay(returnRequest.at)}`}
            </p>
            <p className="mt-1">
              {returnRequest.reasonLabel}, {returnedUnits} {returnedUnits === 1 ? "item" : "items"}.{" "}
              {decision?.status === "declined"
                ? decision.reason
                  ? `${decidedBy} declined it: ${decision.reason}.`
                  : `${decidedBy} declined it.`
                : decision
                  ? `${decidedBy} approved a refund of ${refundAmount}${decision.partial ? " for the items you returned" : ""}. It's recorded, and goes back to how you paid once a payment provider is connected; nothing has reached your card yet.`
                  : status === "refund_requested"
                    ? `${brand.name} reviews it and replies with return instructions, and you'll get a notification when they do. Keep the items unworn with their tags until then.`
                    : `${brand.name} has updated this return. The timeline shows what changed.`}
            </p>
          </div>
        </div>
      ) : canReturn ? (
        <>
          <p className="text-sm text-ink-2">
            {brand.name} accepts returns for {brand.returnsDays} days after delivery.{" "}
            <span className="text-ink">{returnDaysLeft === 0 ? "Today is the last day." : `${returnDaysLeft} ${returnDaysLeft === 1 ? "day" : "days"} left.`}</span>
          </p>
          <Button
            variant="secondary"
            className="mt-4 w-full"
            aria-haspopup="dialog"
            onClick={(e) => {
              returnOpener.current = e.currentTarget
              setReturnOpen(true)
            }}
          >
            <RotateCcw /> Request a return
          </Button>
        </>
      ) : (
        <p className="text-sm text-ink-2">
          {order.status === "delivered"
            ? `The ${brand.returnsDays}-day return window for this order ${returnClosedAgo ? `closed ${returnClosedAgo}` : "has closed"}.`
            : order.status === "refunded"
              ? order.refund
                ? "A refund for this order is approved, so there's nothing to return."
                : "This order has been refunded, so there's nothing to return."
              : order.status === "cancelled"
                ? order.paymentStatus === "pending" || order.paymentStatus === "failed"
                  ? "This order was cancelled before it was paid, so there's nothing to return or refund."
                  : order.paymentStatus === "refunded"
                    ? "This order was cancelled and marked refunded, so there's nothing to return."
                    : "This order was cancelled, so there's nothing to return. The refund goes back to your original payment method once the payment provider processes it."
              : order.status === "refund_requested"
                ? `${brand.name} is reviewing a return for this order.`
                : `You can request a return once it's delivered. ${brand.name} accepts returns for ${brand.returnsDays} days after delivery.`}
        </p>
      )}
    </Panel>
  )
  const timelinePanel = (
    <Panel title="Timeline">
      <ol className="relative grid gap-5 border-l border-line pl-5">
        {timeline.map((t, i) => (
          <li key={`${t.label}-${i}`} className="relative">
            <span className={cn("absolute top-1.5 -left-[1.5625rem] size-2 rounded-full", i === 0 ? "bg-violet ring-4 ring-purple/20" : "bg-line")} aria-hidden />
            <p className={cn("text-sm", i === 0 ? "text-ink" : "text-ink-2")}>{t.label}</p>
            <p className="mt-0.5 text-xs text-ink-3">{formatDay(t.at, { year: true })}</p>
          </li>
        ))}
      </ol>
    </Panel>
  )

  return (
    <>
      <BackLink />
      <header className="mt-6 flex flex-wrap items-end justify-between gap-6">
        <div className="min-w-0">
          <Link href={`/brands/${brand.handle}`} className="inline-flex items-center gap-3 text-sm text-ink-2 transition-colors hover:text-violet">
            <BrandMark brand={brand} size="sm" />
            {brand.name}
          </Link>
          <h1 className="mt-4 font-display text-display-lg text-ink">Order {order.reference}</h1>
          <p className="mt-3 text-sm text-ink-2">
            Placed {formatDay(order.placedAt, { year: true })}
            {group ? (
              <>
                , part of checkout{" "}
                <Link href={`/you/orders#g-${group.id}`} className="relative whitespace-nowrap text-violet underline-offset-4 after:absolute after:-inset-x-1 after:-inset-y-2.5 hover:underline">
                  {group.reference}
                </Link>
              </>
            ) : null}
            {sample ? <SampleChip className="ml-2" /> : null}
          </p>
        </div>
        <OrderStatusBadge status={status} order={order} />
      </header>
      <YouNav className="mt-8" />

      <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-8">
        <div className="grid content-start gap-6">
          <Panel title="Progress">
            {status === "cancelled" ? (
              <StatusBadge tone="muted">Cancelled before it shipped</StatusBadge>
            ) : (
              <OrderStepper status={status} />
            )}
            <p className="mt-6 text-sm text-ink-2">{returnRequest && status === "refund_requested" ? `${brand.name} is reviewing your return request.` : note}</p>
            {order.tracking ? (
              <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-md border border-line-soft bg-surface px-4 py-3">
                <div className="min-w-0">
                  <p className="text-xs text-ink-3">{order.tracking.carrier} tracking number</p>
                  <p className="mt-0.5 truncate text-sm text-ink tabular">{order.tracking.number}</p>
                </div>
                <Button asChild variant={order.status === "shipped" ? "primary" : "secondary"} size="sm">
                  <a href={trackingUrl(order.tracking)} target="_blank" rel="noopener noreferrer">
                    Track parcel <ExternalLink />
                    <span className="sr-only">(opens {order.tracking.carrier})</span>
                  </a>
                </Button>
              </div>
            ) : null}
          </Panel>

          <Panel title={`Items (${count})`}>
            <ul className="divide-y divide-line-soft">
              {order.lines.map((l) => {
                const product = productById.get(l.productId)
                const returning = returnRequest?.variantIds.includes(l.variantId)
                const thumb = (
                  <span className="relative block h-28 w-22 shrink-0 overflow-hidden rounded-md bg-surface">
                    <Image src={l.image.src} alt={l.image.alt} fill sizes="88px" className="object-cover" />
                  </span>
                )
                return (
                  <li key={l.variantId} className="flex gap-4 py-4 first:pt-0 last:pb-0">
                    {product ? <Link href={`/products/${product.slug}`}>{thumb}</Link> : thumb}
                    <div className="flex min-w-0 flex-1 flex-col">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          {product ? (
                            <Link href={`/products/${product.slug}`} className="block truncate text-sm text-ink hover:text-violet">{l.name}</Link>
                          ) : (
                            <p className="truncate text-sm text-ink">{l.name}</p>
                          )}
                          <p className="mt-0.5 truncate text-xs text-ink-2">{l.variantLabel}</p>
                          <p className="mt-0.5 text-xs text-ink-3 tabular">Qty {l.quantity}</p>
                        </div>
                        <p className="shrink-0 text-sm text-ink tabular">{formatOrderMoney(l.unitPrice * l.quantity, order.currency)}</p>
                      </div>
                      {returning ? (
                        <StatusBadge tone={outcome ? outcome.tone : "attention"} className="mt-auto self-start">
                          {decision?.status === "approved" ? "Refund approved" : decision?.status === "declined" ? "Return declined" : "Return requested"}
                        </StatusBadge>
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ul>
          </Panel>

          <div className="lg:hidden">{returnsPanel}</div>
          <div className="hidden lg:block">{timelinePanel}</div>
        </div>

        <aside className="grid content-start gap-6">
          <Panel title="Summary">
            <dl className="grid gap-2 text-sm">
              <div className="flex justify-between gap-4 text-ink-2">
                <dt>Subtotal</dt>
                <dd className="text-ink tabular">{formatOrderMoney(order.subtotal, order.currency)}</dd>
              </div>
              <div className="flex justify-between gap-4 text-ink-2">
                <dt>Shipping</dt>
                <dd className="text-ink tabular">{order.shipping === 0 ? "Free" : formatOrderMoney(order.shipping, order.currency)}</dd>
              </div>
              {order.tax ? (
                <div className="flex justify-between gap-4 text-ink-2">
                  <dt>Taxes and duties</dt>
                  <dd className="text-ink tabular">{formatOrderMoney(order.tax, order.currency)}</dd>
                </div>
              ) : null}
              <div className="mt-2 flex justify-between gap-4 border-t border-line-soft pt-3 text-base">
                <dt className="text-ink">Total</dt>
                <dd className="text-ink tabular">{formatOrderMoney(order.total, order.currency)}</dd>
              </div>
            </dl>
            <p className="mt-3 text-xs leading-relaxed text-ink-3">
              {sample
                ? `Sample order history for the demo account, in ${order.currency}: it shows how a paid order reads, and no payment was taken.${order.refund ? ` A refund of ${formatOrderMoney(order.refund.amount, order.currency)} is approved and recorded.` : ""}`
                : order.paymentStatus === "pending" && order.status === "cancelled"
                ? "Not charged: the order was cancelled before it was paid."
                : order.paymentStatus === "pending"
                ? `Not charged. In ${order.currency}, awaiting payment confirmation: no payment provider is connected in this development build.`
                : order.paymentStatus === "failed"
                  ? "The payment didn't go through, so nothing was charged."
                  : order.paymentStatus === "authorized"
                    ? `Authorised in ${order.currency}. The charge completes when ${brand.name} ships it.`
                : order.refund
                  ? `Charged in ${order.currency} by ${brand.name}. A refund of ${formatOrderMoney(order.refund.amount, order.currency)} is approved and recorded; it's sent once a payment provider is connected.`
                  : order.paymentStatus === "refunded"
                    ? `Charged in ${order.currency} by ${brand.name}, then refunded in full.`
                    : order.paymentStatus === "partially_refunded"
                      ? `Charged in ${order.currency} by ${brand.name}, then partly refunded.`
                      : `Charged in ${order.currency} by ${brand.name}.`}
            </p>
          </Panel>

          <Panel title="Delivery">
            <OrderDelivery order={order} brand={brand} />
            <dl className="mt-5 grid gap-4 border-t border-line-soft pt-5 text-sm">
              <div>
                <dt className="text-xs text-ink-3">Ship to</dt>
                <dd className="mt-1 leading-relaxed text-ink">
                  {address.name}
                  <br />
                  {address.line1}
                  <br />
                  {address.city}
                  {address.postcode ? ` ${address.postcode}` : ""}, {countries[address.country].name}
                  {/* The demo account has no phone number on file, so sample orders show none. */}
                  {address.phone && !sample ? (
                    <>
                      <br />
                      <span className="text-ink-2 tabular">{address.phone}</span>
                    </>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink-3">Shipping method</dt>
                <dd className="mt-1 text-ink">{methodLabel(order.shippingMethod)}</dd>
                <dd className="mt-0.5 text-xs text-ink-2">
                  Ships from {brand.city}, {countries[brand.shipsFrom].name}. Usually dispatches in {businessDays(brand.processingDays)}.
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink-3">Tracking</dt>
                <dd className="mt-1">
                  {order.tracking ? (
                    <>
                      <span className="block text-ink tabular">
                        {order.tracking.carrier}, {order.tracking.number}
                      </span>
                      <TrackingLink tracking={order.tracking} className="mt-1.5" />
                    </>
                  ) : (
                    <span className="text-ink-2">Added when {brand.name} ships your order</span>
                  )}
                </dd>
              </div>
            </dl>
          </Panel>

          <div className="hidden lg:block">{returnsPanel}</div>
          <div className="lg:hidden">{timelinePanel}</div>
        </aside>
      </div>

      {order.status === "delivered" || returnRequest ? (
        <ReturnDialog
          order={order}
          brand={brand}
          open={returnOpen}
          onOpenChange={setReturnOpen}
          onRequested={(r) => requestReturn(order.id, r)}
          onSent={() => {
            // The panel is rendered for phones and for desktop; focus the one on screen.
            const visible = [...document.querySelectorAll<HTMLElement>("[data-return-status]")].find((el) => el.offsetParent !== null)
            visible?.focus()
          }}
          onCancelled={() => returnOpener.current?.focus()}
        />
      ) : null}
    </>
  )
}

function BackLink() {
  return (
    <Link href="/you/orders" className="inline-flex items-center gap-1 text-sm text-ink-2 transition-colors hover:text-ink">
      <ChevronLeft className="size-4" aria-hidden />
      All orders
    </Link>
  )
}
