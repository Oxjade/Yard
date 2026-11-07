"use client"

import Link from "next/link"
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react"
import { StatusBadge, orderStatusMeta } from "@/components/dashboard/status-badge"
import { Bone } from "@/components/feedback/skeletons"
import { monthYear, shortDate } from "@/components/inbox/format"
import { Button } from "@/components/ui/button"
import type { CustomerContextDto } from "@/lib/api/contracts/inbox"
import { errorMessage } from "@/lib/api/errors"
import { STUDIO_BRAND_ID } from "@/lib/data/brands"
import { countries, type CountryCode, type CurrencyCode } from "@/config/markets"
import { formatMoney } from "@/lib/money"
import { useStudio } from "@/lib/stores/studio"
import { cn } from "@/lib/utils"

const money = (amount: number, currency: string) => {
  try {
    return formatMoney(amount, currency as CurrencyCode)
  } catch {
    return `${amount / 100} ${currency}`
  }
}

export function CustomerContextSkeleton() {
  return (
    <div role="status" aria-label="Loading customer" className="grid gap-4 p-4">
      <Bone className="h-5 w-32" />
      <Bone className="h-3 w-48" />
      <Bone className="h-3 w-40" />
      <Bone className="mt-4 h-4 w-28" />
      {[0, 1, 2].map((i) => (
        <Bone key={i} className="h-14 w-full rounded-lg" />
      ))}
    </div>
  )
}

/**
 * The context panel (§6.2): this customer with this brand only, from the server's order mirror.
 * "Open in Orders" appears only when the order is also in this browser's Studio store; otherwise
 * the details show inline.
 */
export function CustomerContext({ data, error, loading, onRetry, brandId, className }: { data: CustomerContextDto | undefined; error: unknown; loading: boolean; onRetry: () => void; brandId: string | null; className?: string }) {
  const localOrders = useStudio((s) => s.orders)
  if (loading) return <CustomerContextSkeleton />
  if (error || !data)
    return (
      <div className="flex flex-col items-center gap-3 p-6 text-center" role="alert">
        <p className="text-sm text-ink">Couldn&apos;t load this customer.</p>
        <p className="text-xs text-ink-2">{errorMessage(error)}</p>
        <Button size="sm" variant="secondary" onClick={onRetry}>
          <ArrowCounterClockwiseIcon /> Retry
        </Button>
      </div>
    )
  const c = data.customer
  const where = [c.lastShipToCity, c.lastShipToCountry ? (countries[c.lastShipToCountry as CountryCode]?.name ?? c.lastShipToCountry) : null].filter(Boolean).join(", ")
  return (
    <div className={cn("grid gap-6 p-4", className)}>
      <section aria-labelledby="ctx-customer">
        <h2 id="ctx-customer" className="text-xs text-ink-3">
          Customer
        </h2>
        <p className="mt-1.5 text-[0.9375rem] font-medium text-ink">{c.name}</p>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
          <dt className="text-ink-3">Ships to</dt>
          <dd className="text-right text-ink-2">{where || "No orders yet"}</dd>
          <dt className="text-ink-3">Customer since</dt>
          <dd className="text-right text-ink-2">{c.customerSince ? monthYear(c.customerSince) : "No orders yet"}</dd>
          <dt className="text-ink-3">Orders with you</dt>
          <dd className="text-right text-ink-2 tabular">
            {c.ordersCount}
            {c.awaitingPayment ? ` (${c.awaitingPayment} awaiting payment)` : ""}
          </dd>
          <dt className="text-ink-3">Spent with you</dt>
          <dd className="text-right text-ink tabular">
            {money(c.spentMinor, c.currency)}
            {c.spentOther.map((o) => (
              <span key={o.currency} className="block text-ink-2">
                plus {money(o.amount, o.currency)}
              </span>
            ))}
          </dd>
        </dl>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-3">Paid orders only. Orders awaiting payment, cancelled or refunded aren&apos;t counted.</p>
      </section>
      <section aria-labelledby="ctx-orders" id="customer-orders" tabIndex={-1} className="scroll-mt-4 rounded-lg outline-none">
        <h2 id="ctx-orders" className="text-xs text-ink-3">
          Orders with you
        </h2>
        {data.orders.length ? (
          <ul className="mt-2 grid gap-2">
            {data.orders.map((o) => {
              const local = brandId === STUDIO_BRAND_ID && localOrders.some((x) => x.id === o.id)
              const meta = orderStatusMeta[o.status]
              return (
                <li key={o.id} className="rounded-lg border border-line-soft bg-card p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-ink tabular">{o.reference}</span>
                    <StatusBadge tone={meta?.tone ?? "neutral"}>{meta?.label ?? o.status}</StatusBadge>
                  </div>
                  <p className="mt-1 text-xs text-ink-2">
                    {shortDate(o.placedAt)}, <span className="text-ink tabular">{money(o.total.amount, o.total.currency)}</span>
                  </p>
                  {local ? (
                    <Button asChild size="sm" variant="ghost" className="mt-2 -ml-3">
                      <Link href={`/studio/orders/${o.id}`}>Open in Orders</Link>
                    </Button>
                  ) : (
                    <div className="mt-2 border-t border-line-soft pt-2 text-xs text-ink-2">
                      <p className="line-clamp-2">{o.items.map((i) => `${i.qty} × ${i.name}`).join(", ")}</p>
                      <p className="mt-1 text-ink-3">Placed in another browser — details shown here.</p>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-ink-2">No orders with you yet.</p>
        )}
      </section>
      <section aria-labelledby="ctx-products">
        <h2 id="ctx-products" className="text-xs text-ink-3">
          Products discussed
        </h2>
        {data.productsDiscussed.length ? (
          <ul className="mt-2 grid gap-1.5">
            {data.productsDiscussed.map((p) => (
              <li key={p.productId} className="flex items-center justify-between gap-2 text-xs">
                <Link href={`/products/${p.slug}`} className="truncate text-ink hover:text-violet">
                  {p.name}
                </Link>
                <span className="shrink-0 text-ink-2 tabular">{money(p.price.amount, p.price.currency)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-ink-2">No product cards in this conversation yet.</p>
        )}
      </section>
    </div>
  )
}
