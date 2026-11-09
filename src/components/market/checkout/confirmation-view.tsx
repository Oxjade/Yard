"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { StackIcon as PackageSearch } from "@phosphor-icons/react"
import { isSampleCheckout, OrderStatusBadge, orderStatusNote } from "@/components/market/account/order-status"
import { formatOrderMoney } from "@/components/market/account/format"
import { BrandMark } from "@/components/market/brand-mark"
import { SectionHeader } from "@/components/market/section-header"
import { Button } from "@/components/ui/button"
import { countries } from "@/config/markets"
import { ApiError } from "@/lib/api/client"
import { brandById } from "@/lib/data/brands"
import { CheckoutError, loadServerCheckout, useOrders, type ServerCheckout } from "@/lib/stores/orders"
import { DEMO_SHOPPER, useSession } from "@/lib/stores/session"
import { cn } from "@/lib/utils"
import type { CheckoutGroup, MerchantOrder, MerchantOrderStatus } from "@/lib/data/types"
import { orderEstimate } from "@/components/market/delivery/browser-estimate"
import { useHydrated } from "@/hooks/use-hydrated"
import { formatRange } from "@/lib/shipping/format"
import { methodFromLabel, shippingMethodLabel } from "./shipping"
import { ReceiptTicket } from "./receipt-ticket"
import { ConfirmationSkeleton } from "./skeletons"
import { useStoresReady } from "./use-stores-ready"

/** States in which a delivery estimate still means something. */
const expecting = new Set<MerchantOrderStatus>(["pending_payment", "paid", "processing", "shipped"])

/** How long an open confirmation keeps asking for a pending payment's final answer, and how often (backoff). */
const POLL_FOR_MS = 5 * 60_000
const FIRST_POLL_MS = 5_000
const MAX_POLL_MS = 30_000

/**
 * The confirmation for one checkout group: its reference, then one card per brand order. It reads
 * this browser's copy when it holds one (the demo shopper's history and demo checkouts, shown to any
 * visitor; or the signed-in shopper's checkout placed in this visit), else the server's (another browser or device, cleared storage, a
 * return from the payment page). While the provider is still confirming, it re-reads the checkout.
 */
export function ConfirmationView() {
  const params = useSearchParams()
  const groupId = params.get("group")
  const ready = useStoresReady()
  const groups = useOrders((s) => s.groups)
  const allOrders = useOrders((s) => s.orders)
  const user = useSession((s) => s.user)
  const [remote, setRemote] = useState<{ id: string; data: ServerCheckout } | null>(null)
  const [remoteError, setRemoteError] = useState<{ id: string; status: number } | null>(null)

  // A checkout kept in this browser shows to the shopper it belongs to. The demo shopper's (its
  // sample history and demo checkouts) is public demo data, so it shows to any visitor, as before.
  const localGroup = groupId ? groups.find((g) => g.id === groupId && (g.customerId === DEMO_SHOPPER || (!!user && g.customerId === user.id))) : undefined
  const localOrders = localGroup ? localGroup.orderIds.map((id) => allOrders.find((o) => o.id === id)).filter((o): o is MerchantOrder => !!o) : []
  const local = localGroup && localOrders.length ? { group: localGroup, orders: localOrders } : null
  const fromServer = !local && remote?.id === groupId ? remote.data : null
  const needServer = ready && !!groupId && !local

  useEffect(() => {
    if (!needServer || !groupId) return
    let active = true
    void loadServerCheckout(groupId).then(
      (data) => { if (active) setRemote({ id: groupId, data }) },
      (cause: unknown) => { if (active) setRemoteError({ id: groupId, status: cause instanceof CheckoutError && cause.kind === "signin" ? 401 : cause instanceof ApiError ? cause.status : 0 }) },
    )
    return () => { active = false }
  }, [needServer, groupId])

  // A live payment still being confirmed: re-read the checkout with backoff until it's final.
  const shown = local ?? fromServer
  const pendingLive = !!shown && shown.group.payment?.status === "pending" && shown.orders.some((o) => o.status === "pending_payment")
  const fromLocal = !!local
  useEffect(() => {
    if (!pendingLive || !groupId) return
    let active = true
    let timer = 0
    const deadline = Date.now() + POLL_FOR_MS
    const tick = (delay: number) => {
      timer = window.setTimeout(async () => {
        try {
          if (fromLocal) await useOrders.getState().refreshCheckout(groupId)
          else {
            const data = await loadServerCheckout(groupId)
            if (active) setRemote({ id: groupId, data })
          }
        } catch {
          /* offline for a moment: the next look tries again */
        }
        if (active && Date.now() < deadline) tick(Math.min(delay * 2, MAX_POLL_MS))
      }, delay)
    }
    tick(FIRST_POLL_MS)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [pendingLive, fromLocal, groupId])

  if (!ready || (needServer && !fromServer && remoteError?.id !== groupId)) return <ConfirmationSkeleton />

  if (!shown) {
    const signedOut = !user || remoteError?.status === 401
    return (
      <>
        <h1 className="font-display text-display-lg text-ink">Order confirmation</h1>
        <div className="mt-10 flex flex-col items-center gap-4 rounded-lg border border-line-soft bg-card px-6 py-16 text-center">
          <span className="inline-flex size-14 items-center justify-center rounded-full border border-line">
            <PackageSearch className="size-6 text-ink-2" />
          </span>
          <div>
            <p className="text-base text-ink">{signedOut ? "Sign in to see this checkout" : remoteError?.status === 0 ? "We couldn’t load this checkout" : "We can’t find that checkout"}</p>
            <p className="mt-1 max-w-sm text-sm text-ink-2">
              {signedOut
                ? "A checkout shows only to the account that placed it. Sign in with that account to see its orders."
                : remoteError?.status === 0
                  ? "Check your connection and reload the page. Your orders are safe either way."
                  : "The link may be incomplete, or the checkout belongs to another account. Every order you placed is in Your orders."}
            </p>
          </div>
          <Button asChild variant="primary">
            <Link href={signedOut ? "/sign-in" : "/you/orders"}>{signedOut ? "Sign in" : "See your orders"}</Link>
          </Button>
        </div>
      </>
    )
  }

  return <Confirmation group={shown.group} orders={shown.orders} holder={fromServer ? (fromServer.holder ?? undefined) : user && user.id === shown.group.customerId ? user.name : undefined} />
}

function Confirmation({ group, orders, holder }: { group: CheckoutGroup; orders: MerchantOrder[]; holder?: string }) {

  const brandsOf = orders.map((o) => brandById.get(o.brandId)).filter((b) => b !== undefined)
  const processing = brandsOf.length ? brandsOf.flatMap((b) => b.processingDays) : [1, 3]
  const returns = brandsOf.length ? brandsOf.map((b) => b.returnsDays) : [14]
  const single = orders.length === 1
  // Orders are created unpaid and only the payment provider may mark them paid, so the
  // heading and labels follow the orders' real status instead of assuming success.
  const paymentFailed = group.payment?.status === "failed" || orders.some((o) => o.paymentStatus === "failed")
  const awaitingPayment = !paymentFailed && orders.some((o) => o.status === "pending_payment")
  const allPaid = orders.every((o) => o.status === "paid")
  const sample = isSampleCheckout(group.id)

  return (
    <>
      {/* The page's heading and what happens now, beside the ticket receipt (§6.6): the ticket
          carries the reference, total, date, payment method and each brand's estimate, so the
          print view (and Save as PDF) is the ticket alone, centred on one page. */}
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-10 lg:grid-cols-[minmax(0,1fr)_28rem] lg:gap-16">
        <section aria-labelledby="confirmed-title" className="lg:pt-6 print:hidden">
          <h1 id="confirmed-title" className="font-display text-display-lg text-ink">
            {paymentFailed ? "Payment wasn’t completed" : awaitingPayment ? "Order placed" : "Order confirmed"}
          </h1>
          <p className="mt-4 max-w-2xl text-pretty text-[0.9375rem] leading-relaxed text-ink-2">
            {paymentFailed
              ? "The payment provider couldn’t complete this payment. No payment was taken, and the order won’t be prepared. You can try placing it again."
              : awaitingPayment
              ? single
                ? `Your order${brandsOf[0] ? ` with ${brandsOf[0].name}` : ""} is in. Payment confirmation is pending: the brand starts preparing your order once the payment provider confirms it.`
                : `Your checkout created ${orders.length} orders, one per brand. Payment confirmation is pending: each brand starts preparing its order once the payment provider confirms it.`
              : allPaid
                ? `Your payment went through and ${single ? `${brandsOf[0]?.name ?? "the brand"} is preparing your order.` : `${orders.length} brands are preparing their orders, each one shipping separately.`}`
                : `Here is where ${single ? "the order" : `each of the ${orders.length} brand orders`} from this checkout stands.`}
          </p>
          <p className="mt-3 max-w-2xl text-xs leading-relaxed text-ink-3">
            {paymentFailed
              ? "The checkout is closed. Start a new checkout to try another payment method. "
              : awaitingPayment && group.payment?.status === "not_charged"
              ? "Payments aren’t connected in this environment, so nothing was charged and these orders stay awaiting payment confirmation. "
              : awaitingPayment
                ? "The payment provider is still confirming the result. We’ll update your order when it responds. "
              : sample
                ? "This is sample order history for the demo account. It shows how a paid checkout reads; no payment was taken. "
                : ""}
            Quote the order ID if you contact us or a brand.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row print:hidden">
            {paymentFailed ? (
              <>
                {/* The cart holds what's left to buy (reloaded from the server); placing it again starts a new checkout. */}
                <Button asChild variant="primary" size="lg">
                  <Link href="/bag">Return to cart</Link>
                </Button>
                <Button asChild variant="secondary" size="lg">
                  <Link href="/you/orders">See your orders</Link>
                </Button>
              </>
            ) : (
              <>
                <Button asChild variant="primary" size="lg">
                  <Link href="/you/orders">Track in Your World</Link>
                </Button>
                <Button asChild variant="secondary" size="lg">
                  <Link href="/shop">Continue shopping</Link>
                </Button>
              </>
            )}
          </div>
        </section>

        <ReceiptTicket group={group} orders={orders} sample={sample} holder={holder} className="lg:mx-0 print:mx-auto print:break-inside-avoid" />
      </div>

      <section aria-labelledby="orders-title" className="mt-24 md:mt-32 print:hidden">
        <div id="orders-title">
          <SectionHeader
            title={single ? "Your order" : `${orders.length} orders, one per brand`}
            description={single ? undefined : "Each brand packs and ships its own parcel, with its own tracking and returns."}
          />
        </div>
        <div className={cn("grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2", orders.length >= 3 && "xl:grid-cols-3")}>
          {orders.map((o) => (
            <BrandOrderCard key={o.id} order={o} />
          ))}
        </div>
      </section>

      {paymentFailed ? null : (
        <section aria-labelledby="next-title" className="mt-24 md:mt-32 print:hidden">
          <div id="next-title">
            <SectionHeader title="What happens next" description="Every brand runs its own studio, so each order moves at its own pace. You can follow all of them from Orders in Your World." href="/you/orders" action="Your orders" />
          </div>
          <ol className="grid gap-4 md:grid-cols-3">
            {[
              {
                title: single ? "The brand packs your order" : "Each brand packs its order",
                body: `${awaitingPayment ? "Once the payment is confirmed, pieces" : "Pieces"} are checked and packed in the brand's own studio, usually within ${Math.min(...processing)} to ${Math.max(...processing)} business days.`,
              },
              {
                title: "Tracking for every parcel",
                body: single ? "You get a tracking link as soon as the parcel ships." : "You get a tracking link as each parcel ships. They travel separately, so they may arrive on different days.",
              },
              {
                title: "Returns, brand by brand",
                body:
                  Math.min(...returns) === Math.max(...returns)
                    ? `You have ${returns[0]} days after delivery to start a return, from Orders in Your World.`
                    : `Each order has its own window, from ${Math.min(...returns)} to ${Math.max(...returns)} days after delivery. Start a return from Orders in Your World.`,
              },
            ].map((s, i) => (
              <li key={s.title} className="rounded-lg border border-line-soft bg-card p-5">
                <span className="font-display text-display-sm text-violet tabular" aria-hidden>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="mt-4 text-base text-ink">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  )
}

function BrandOrderCard({ order }: { order: MerchantOrder }) {
  const brand = brandById.get(order.brandId)
  const method = methodFromLabel(order.shippingMethod)
  const country = order.shippingAddress.country
  // The estimate the server returned with the order; an older order without one gets the same
  // engine's estimate computed here, labelled so. Read after hydration (it can read the clock).
  const hydrated = useHydrated()
  const estimate = hydrated ? orderEstimate(order) : null
  return (
    <article aria-label={`${brand?.name ?? "Brand"} order ${order.reference}`} className="flex flex-col rounded-lg border border-line-soft bg-card">
      <header className="border-b border-line-soft px-4 py-3.5 md:px-5">
        <div className="flex items-start justify-between gap-3">
          {brand ? (
            <Link href={`/brands/${brand.handle}`} className="flex min-w-0 items-center gap-2.5">
              <BrandMark brand={brand} size="sm" />
              <div className="min-w-0">
                <p className="truncate text-sm text-ink">{brand.name}</p>
                <p className="truncate text-xs text-ink-2 tabular">Order {order.reference}</p>
              </div>
            </Link>
          ) : (
            <p className="min-w-0 truncate text-xs text-ink-2 tabular">Order {order.reference}</p>
          )}
          <OrderStatusBadge order={order} className="shrink-0" />
        </div>
        <p className="mt-2.5 text-xs leading-relaxed text-ink-2">{orderStatusNote(order)}</p>
      </header>
      <ul className="divide-y divide-line-soft px-4 md:px-5">
        {order.lines.map((l) => (
          <li key={l.variantId} className="flex items-start gap-3 py-3">
            <div className="relative h-16 w-13 shrink-0 overflow-hidden rounded-md bg-surface">
              <Image src={l.image.src} alt={l.image.alt} fill sizes="52px" className="object-cover" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-ink">{l.name}</p>
              <p className="truncate text-xs text-ink-2">{l.variantLabel}</p>
              <p className="text-xs text-ink-3 tabular">Qty {l.quantity}</p>
            </div>
            <p className="text-sm text-ink tabular">{formatOrderMoney(l.unitPrice * l.quantity, order.currency)}</p>
          </li>
        ))}
      </ul>
      <dl className="mt-auto grid gap-2 border-t border-line-soft px-4 py-4 text-sm md:px-5">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-ink-2">Shipping</dt>
          <dd className="text-right text-ink tabular">
            {method === "pickup" ? order.shippingMethod : shippingMethodLabel[method]}, {order.shipping === 0 ? "free" : formatOrderMoney(order.shipping, order.currency)}
          </dd>
        </div>
        {expecting.has(order.status) ? (
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-ink-2">{method === "pickup" ? "Estimated ready" : "Estimated arrival"}</dt>
            <dd className="text-right text-ink tabular">
              {estimate?.arrivalFrom && estimate.arrivalTo ? (method === "pickup" ? formatRange(estimate.arrivalFrom, estimate.arrivalFrom) : formatRange(estimate.arrivalFrom, estimate.arrivalTo)) : estimate ? "Not available" : <span className="inline-block h-4 w-28 rounded-md skeleton align-middle" aria-hidden />}
              {estimate?.source === "browser" ? <span className="block text-xs text-ink-3">Estimated in this browser</span> : null}
            </dd>
          </div>
        ) : null}
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-ink-2">Ships to</dt>
          <dd className="min-w-0 truncate text-right text-ink">
            {order.shippingAddress.city}, {countries[country].name}
          </dd>
        </div>
        <div className="mt-1 flex items-baseline justify-between gap-4 border-t border-line-soft pt-3">
          <dt className="text-ink">Order total</dt>
          <dd className="text-base text-ink tabular">{formatOrderMoney(order.total, order.currency)}</dd>
        </div>
      </dl>
    </article>
  )
}
