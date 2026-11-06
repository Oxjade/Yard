"use client"

import Image from "next/image"
import Link from "next/link"
import { CaretLeftIcon as ChevronLeft, ArrowSquareOutIcon as ExternalLink, StackIcon as PackageSearch } from "@phosphor-icons/react"
import { BrandMark } from "@/components/market/brand-mark"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { Button } from "@/components/ui/button"
import { countries } from "@/config/markets"
import { brandById } from "@/lib/data/brands"
import { productById } from "@/lib/data/products"
import { formatMoney } from "@/lib/money"
import { useOrders } from "@/lib/stores/orders"
import { cn } from "@/lib/utils"
import { daysSince, formatDay } from "./format"
import { OrderStatusBadge, OrderStepper, customerOrderStatus, trackingUrl } from "./order-status"
import { ReturnDialog } from "./return-dialog"
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
            <p className="text-base text-ink">We can&apos;t find this order on this device</p>
            <p className="mt-1 max-w-sm text-sm text-ink-2">Orders placed on another device show up once you sign in there with the same account.</p>
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
  const status = order.status
  const meta = customerOrderStatus[status]
  const delivered = order.timeline.find((t) => t.label.toLowerCase().startsWith("delivered"))
  const daysSinceDelivery = delivered ? daysSince(delivered.at) : null
  const returnDaysLeft = daysSinceDelivery === null ? null : brand.returnsDays - daysSinceDelivery
  const canReturn = order.status === "delivered" && !returnRequest && returnDaysLeft !== null && returnDaysLeft >= 0
  const timeline = [...order.timeline].reverse()
  const count = order.lines.reduce((n, l) => n + l.quantity, 0)
  const address = order.shippingAddress

  // On phones the return action sits right under the items and the timeline goes last.
  const returnsPanel = (
    <Panel title="Returns">
      {returnRequest ? (
        <p className="text-sm text-ink-2">
          Request sent {formatDay(returnRequest.at)}. {brand.name} reviews it and replies with return instructions; you&apos;ll get a notification here. Keep the items unworn with their tags until then.
        </p>
      ) : canReturn ? (
        <>
          <p className="text-sm text-ink-2">
            {brand.name} accepts returns for {brand.returnsDays} days after delivery.{" "}
            <span className="text-ink">{returnDaysLeft === 0 ? "Today is the last day." : `${returnDaysLeft} ${returnDaysLeft === 1 ? "day" : "days"} left.`}</span>
          </p>
          <div className="mt-4">
            <ReturnDialog order={order} brand={brand} onRequested={(r) => requestReturn(order.id, r)} />
          </div>
        </>
      ) : (
        <p className="text-sm text-ink-2">
          {order.status === "delivered"
            ? `The ${brand.returnsDays}-day return window for this order closed ${Math.abs(returnDaysLeft ?? 0)} days ago.`
            : order.status === "refunded" || order.status === "cancelled"
              ? "This order has been refunded, so there's nothing to return."
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
            {group ? <>, part of checkout <Link href="/you/orders" className="text-violet underline-offset-4 hover:underline">{group.reference}</Link></> : null}
          </p>
        </div>
        <OrderStatusBadge status={status} />
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
            <p className="mt-6 text-sm text-ink-2">{returnRequest ? `${brand.name} is reviewing your return request and will reply within 2 business days.` : meta.note}</p>
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
                        <p className="shrink-0 text-sm text-ink tabular">{formatMoney(l.unitPrice * l.quantity, order.currency)}</p>
                      </div>
                      {returning ? <StatusBadge tone="attention" className="mt-auto self-start">Return requested</StatusBadge> : null}
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
                <dd className="text-ink tabular">{formatMoney(order.subtotal, order.currency)}</dd>
              </div>
              <div className="flex justify-between gap-4 text-ink-2">
                <dt>Shipping</dt>
                <dd className="text-ink tabular">{order.shipping === 0 ? "Free" : formatMoney(order.shipping, order.currency)}</dd>
              </div>
              {order.tax ? (
                <div className="flex justify-between gap-4 text-ink-2">
                  <dt>Taxes and duties</dt>
                  <dd className="text-ink tabular">{formatMoney(order.tax, order.currency)}</dd>
                </div>
              ) : null}
              <div className="mt-2 flex justify-between gap-4 border-t border-line-soft pt-3 text-base">
                <dt className="text-ink">Total</dt>
                <dd className="text-ink tabular">{formatMoney(order.total, order.currency)}</dd>
              </div>
            </dl>
            <p className="mt-3 text-xs text-ink-3">
              Charged in {order.currency} by {brand.name}.
              {order.paymentStatus === "refunded" ? " Refunded in full." : ""}
            </p>
          </Panel>

          <Panel title="Delivery">
            <dl className="grid gap-4 text-sm">
              <div>
                <dt className="text-xs text-ink-3">Ship to</dt>
                <dd className="mt-1 leading-relaxed text-ink">
                  {address.name}
                  <br />
                  {address.line1}
                  <br />
                  {address.city}
                  {address.postcode ? ` ${address.postcode}` : ""}, {countries[address.country].name}
                  {address.phone ? (
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
                  Ships from {brand.city}, {countries[brand.shipsFrom].name}. The brand dispatches within {brand.processingDays[0]}–{brand.processingDays[1]} days.
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink-3">Tracking</dt>
                <dd className="mt-1">
                  {order.tracking ? (
                    <a href={trackingUrl(order.tracking)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-violet underline-offset-4 hover:underline">
                      {order.tracking.carrier}, {order.tracking.number}
                      <ExternalLink className="size-3.5" aria-hidden />
                    </a>
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
