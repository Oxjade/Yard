"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { CircleNotchIcon as Loader2, StackIcon as PackageSearch } from "@phosphor-icons/react"
import { isSampleCheckout, OrderStatusBadge, orderStatusNote } from "@/components/market/account/order-status"
import { formatOrderMoney } from "@/components/market/account/format"
import { BrandMark } from "@/components/market/brand-mark"
import { usePageSampleDataState } from "@/components/sample/sample-data-context"
import { SectionHeader } from "@/components/market/section-header"
import { Button } from "@/components/ui/button"
import { countries } from "@/config/markets"
import { ApiError } from "@/lib/api/client"
import { orderBrand } from "@/lib/order-brand"
import { useCart } from "@/lib/stores/cart"
import { CheckoutError, loadServerCheckout, useOrders, type ServerCheckout } from "@/lib/stores/orders"
import { DEMO_SHOPPER, useSession } from "@/lib/stores/session"
import { cn } from "@/lib/utils"
import type { CheckoutGroup, MerchantOrder, MerchantOrderStatus } from "@/lib/data/types"
import { orderEstimate } from "@/components/market/delivery/browser-estimate"
import { useHydrated } from "@/hooks/use-hydrated"
import { formatRange } from "@/lib/shipping/format"
import { methodFromLabel, shippingMethodLabel } from "./shipping"
import { ReceiptTicket } from "./receipt-ticket"
import { useCheckoutOptions } from "./payment-options"
import { ConfirmationSkeleton } from "./skeletons"
import { useStoresReady } from "./use-stores-ready"

/** States in which a delivery estimate still means something. */
const expecting = new Set<MerchantOrderStatus>(["pending_payment", "paid", "processing", "shipped"])

/** While a payment is pending, the checkout is re-read this often, for this long; every 4th read asks Paystack directly. */
const POLL_EVERY_MS = 2_500
const POLL_FOR_MS = 60_000
const VERIFY_EVERY = 4

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const isPending = (d: ServerCheckout) => d.checkout.status === "pending_payment"
/** Paystack says no payment was completed: the shopper cancelled or left its page. Nothing was charged. */
const isAbandoned = (d: ServerCheckout) => isPending(d) && d.checkout.payment?.providerStatus === "abandoned"
/**
 * Paystack's page was never opened for this payment: its initialise failed and the server says why
 * (no page address, a message). Nothing is being confirmed, so the page shows that message with
 * Retry (which initialises again) and Return to cart, never the "checking" spinner.
 */
const initFailed = (d: ServerCheckout) => {
  const p = d.checkout.payment
  return isPending(d) && !!p && p.provider !== "stub" && !p.stub && !p.authorizationUrl && !!p.message
}

/**
 * The confirmation for one checkout group: its reference, then one card per brand order. Every
 * real checkout is read from the server, never from this browser's storage: the status shown is
 * the server's, including right after the return from Paystack (?paid=1 asks Paystack first).
 * While the payment is pending it re-reads every few seconds for a minute, then says it's still
 * confirming, with Retry. When Paystack says the shopper left its page without paying (its
 * "abandoned"; the cancel button returns here too), polling stops and the page says nothing was
 * charged, with Pay now (Paystack's page again, while the hold lasts) and Return to cart.
 * Only the demo account's sample history is shown from this browser.
 * This browser's copy of a checkout placed in this visit lends its line and delivery details.
 */
export function ConfirmationView() {
  const params = useSearchParams()
  const groupId = params.get("group")
  const returnedFromPayment = params.get("paid") === "1"
  const ready = useStoresReady()
  const groups = useOrders((s) => s.groups)
  const allOrders = useOrders((s) => s.orders)
  const user = useSession((s) => s.user)
  const [remote, setRemote] = useState<{ id: string; data: ServerCheckout } | null>(null)
  const [remoteError, setRemoteError] = useState<{ id: string; status: number; message: string } | null>(null)
  /** The poll ran out while the payment was still pending (per checkout id). */
  const [timedOut, setTimedOut] = useState<string | null>(null)
  /** Paystack reported no completed payment (per checkout id), and when this page learnt it. */
  const [abandoned, setAbandoned] = useState<{ id: string; at: number } | null>(null)
  const [attempt, setAttempt] = useState(0)
  /** Why the last Retry couldn't open Paystack's page (the server's 503 message), per checkout id. */
  const [retryError, setRetryError] = useState<{ id: string; message: string } | null>(null)

  // The demo switch as /api/session answers it (null until then). With sample data off
  // (production) there is no sample history and no demo shopper: a sample group id is read from
  // the server like any other (and isn't found), and nothing kept in this browser for the demo
  // shopper shows. While the answer is pending, nothing sample-only shows either.
  const sampleOn = usePageSampleDataState()
  const sample = sampleOn !== false && isSampleCheckout(groupId ?? undefined)
  // A checkout kept in this browser shows to the shopper it belongs to. The demo shopper's (its
  // sample history and demo checkouts) is public demo data, so in demo it shows to any visitor, as before.
  const localGroup = groupId ? groups.find((g) => g.id === groupId && !(sampleOn !== true && isSampleCheckout(g.id)) && ((sampleOn === true && g.customerId === DEMO_SHOPPER) || (!!user && g.customerId === user.id))) : undefined
  const localOrders = localGroup ? localGroup.orderIds.map((id) => allOrders.find((o) => o.id === id)).filter((o): o is MerchantOrder => !!o) : []
  const local = localGroup && localOrders.length ? { group: localGroup, orders: localOrders } : null
  const serverData = remote?.id === groupId ? remote.data : null
  const needServer = ready && !!groupId && !sample

  useEffect(() => {
    if (!needServer || !groupId) return
    let active = true
    void (async () => {
      let data: ServerCheckout
      try {
        // Back from Paystack: ask it first. If it can't answer right now, the plain read still shows the order.
        // A Retry after a failed initialise asks the server to open Paystack's page again; when it
        // can't, its reason is kept to show beside the plain read.
        data =
          returnedFromPayment || attempt > 0
            ? await loadServerCheckout(groupId, { verify: true }).catch((cause) => {
                if (active && attempt > 0 && cause instanceof ApiError && cause.message) setRetryError({ id: groupId, message: cause.message })
                return loadServerCheckout(groupId)
              })
            : await loadServerCheckout(groupId)
      } catch (cause) {
        if (active) setRemoteError({ id: groupId, status: cause instanceof CheckoutError && cause.kind === "signin" ? 401 : cause instanceof ApiError ? cause.status : 0, message: cause instanceof ApiError ? cause.message : "" })
        return
      }
      if (!active) return
      setRemote({ id: groupId, data })
      setRemoteError(null)
      setTimedOut(null)
      setAbandoned(isAbandoned(data) ? { id: groupId, at: Date.now() } : null)
      const deadline = Date.now() + POLL_FOR_MS
      let reads = 0
      while (active && isPending(data) && !isAbandoned(data) && !initFailed(data) && Date.now() < deadline) {
        await pause(POLL_EVERY_MS)
        if (!active) return
        reads++
        const verify = reads % VERIFY_EVERY === 0 && !data.checkout.payment?.stub
        try {
          data = await loadServerCheckout(groupId, { verify })
          if (active) {
            setRemote({ id: groupId, data })
            if (isAbandoned(data)) setAbandoned({ id: groupId, at: Date.now() })
          }
        } catch {
          /* offline for a moment, or Paystack busy: the next read tries again */
        }
      }
      // A live payment still pending after a minute: say so, with Retry. (The stub never settles on its own.)
      if (active && isPending(data) && !isAbandoned(data) && !initFailed(data) && !data.checkout.payment?.stub) setTimedOut(groupId)
    })()
    return () => { active = false }
  }, [needServer, groupId, returnedFromPayment, attempt])

  // Once Paystack has answered, the server's cart has moved on (paid pieces leave it): reload the bag.
  const settled = !!serverData && !isPending(serverData) && returnedFromPayment
  useEffect(() => {
    if (settled) void useCart.getState().syncFromServer()
  }, [settled])

  const retry = () => {
    setTimedOut(null)
    setAbandoned(null)
    setRemoteError(null)
    setRetryError(null)
    setAttempt((n) => n + 1)
  }

  // The server's status and money; this browser's copy (when it placed the checkout) adds the lines'
  // product details, the delivery estimate and the payment method the shopper chose.
  const shown = sample
    ? local
    : serverData
      ? {
          group: { ...serverData.group, payment: serverData.group.payment ? { ...localGroup?.payment, ...serverData.group.payment } : localGroup?.payment },
          orders: serverData.orders.map((o) => {
            const mine = localOrders.find((l) => l.id === o.id)
            return mine ? { ...o, lines: mine.lines, delivery: mine.delivery, shippingMethod: mine.shippingMethod } : o
          }),
        }
      : null
  const loadFailed = !!remoteError && remoteError.id === groupId

  if (!ready || (sample && sampleOn === null) || (needServer && !serverData && !loadFailed)) return <ConfirmationSkeleton />

  if (!shown) {
    const signedOut = !user || remoteError?.status === 401
    const transient = remoteError?.status === 0 || (remoteError?.status ?? 0) >= 500
    return (
      <>
        <h1 className="font-display text-display-lg text-ink">Order confirmation</h1>
        <div className="mt-10 flex flex-col items-center gap-4 rounded-lg border border-line-soft bg-card px-6 py-16 text-center">
          <span className="inline-flex size-14 items-center justify-center rounded-full border border-line">
            <PackageSearch className="size-6 text-ink-2" />
          </span>
          <div>
            <p className="text-base text-ink">{signedOut ? "Sign in to see this checkout" : transient ? "We couldn’t load this checkout" : "We can’t find that checkout"}</p>
            <p className="mt-1 max-w-sm text-sm text-ink-2">
              {signedOut
                ? "A checkout shows only to the account that placed it. Sign in with that account to see its orders."
                : transient
                  ? remoteError?.message || "Check your connection and try again. Your orders are safe either way."
                  : "The link may be incomplete, or the checkout belongs to another account. Every order you placed is in Your orders."}
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            {transient && !signedOut ? (
              <Button variant="primary" onClick={retry}>
                Retry
              </Button>
            ) : null}
            <Button asChild variant={transient && !signedOut ? "secondary" : "primary"}>
              <Link href={signedOut ? "/sign-in" : "/you/orders"}>{signedOut ? "Sign in" : "See your orders"}</Link>
            </Button>
          </div>
        </div>
      </>
    )
  }

  const pendingLive = !sample && !!serverData && isPending(serverData) && !serverData.checkout.payment?.stub
  const notStarted = pendingLive && initFailed(serverData)
  const notPaidAt = pendingLive && !notStarted && abandoned?.id === groupId ? abandoned.at : null
  // Paystack's page for this payment, while the checkout still holds the pieces.
  const payUrl = notPaidAt !== null && serverData?.checkout.payment?.authorizationUrl && Date.parse(serverData.checkout.expiresAt) > notPaidAt ? serverData.checkout.payment.authorizationUrl : null
  return (
    <Confirmation
      group={shown.group}
      orders={shown.orders}
      holder={serverData ? (serverData.holder ?? undefined) : user && user.id === shown.group.customerId ? user.name : undefined}
      confirming={pendingLive ? (notStarted ? "not_started" : notPaidAt !== null ? "not_paid" : timedOut === groupId ? "timed_out" : "polling") : null}
      problem={notStarted ? (retryError?.id === groupId ? retryError.message : serverData.checkout.payment?.message) || null : null}
      payUrl={payUrl}
      holdUntil={pendingLive ? serverData.checkout.expiresAt : null}
      onRetry={retry}
    />
  )
}

function Confirmation({
  group,
  orders,
  holder,
  confirming,
  payUrl,
  holdUntil,
  problem,
  onRetry,
}: {
  group: CheckoutGroup
  orders: MerchantOrder[]
  holder?: string
  /**
   * A live payment still pending: being checked, checked for a minute without an answer, or
   * reported by Paystack as not completed (the shopper cancelled or left its page).
   */
  confirming: "polling" | "timed_out" | "not_paid" | "not_started" | null
  /** Why Paystack's page couldn't be opened (the server's words), with "not_started". */
  problem?: string | null
  /** Paystack's page for this payment while the checkout still holds the pieces. */
  payUrl: string | null
  holdUntil: string | null
  onRetry: () => void
}) {
  const brandsOf = orders.map((o) => orderBrand(o)).filter((b) => b !== null)
  // Processing and returns days are known here only for the sample catalogue's brands; others keep the general copy.
  const known = brandsOf.flatMap((b) => (b.sample ? [b.sample] : []))
  const processing = known.length ? known.flatMap((b) => b.processingDays) : [1, 3]
  const returns = known.length ? known.map((b) => b.returnsDays) : [14]
  const single = orders.length === 1
  // Orders are created unpaid and only the payment provider may mark them paid, so the
  // heading and labels follow the orders' real status instead of assuming success.
  const paymentFailed = group.payment?.status === "failed" || orders.some((o) => o.paymentStatus === "failed")
  const awaitingPayment = !paymentFailed && orders.some((o) => o.status === "pending_payment")
  const notPaid = awaitingPayment && confirming === "not_paid"
  const notStarted = awaitingPayment && confirming === "not_started"
  const hydrated = useHydrated()
  const holdTime = hydrated && holdUntil ? new Date(holdUntil).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : null
  const allPaid = orders.every((o) => o.status === "paid")
  const sample = isSampleCheckout(group.id)
  const { providerName } = useCheckoutOptions()

  return (
    <>
      {/* The page's heading and what happens now, beside the ticket receipt (§6.6): the ticket
          carries the reference, total, date, payment method and each brand's estimate, so the
          print view (and Save as PDF) is the ticket alone, centred on one page. */}
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-10 lg:grid-cols-[minmax(0,1fr)_28rem] lg:gap-16">
        <section aria-labelledby="confirmed-title" className="lg:pt-6 print:hidden">
          <h1 id="confirmed-title" className="font-display text-display-lg text-ink">
            {notStarted ? "Payment didn’t start" : paymentFailed || notPaid ? "Payment wasn’t completed" : awaitingPayment ? "Order placed" : "Order confirmed"}
          </h1>
          <p className="mt-4 max-w-2xl text-pretty text-[0.9375rem] leading-relaxed text-ink-2">
            {notStarted
              ? problem || "We couldn’t reach the payment provider. Nothing was charged. Try again."
              : paymentFailed
              ? "The payment provider couldn’t complete this payment. No payment was taken, and the order won’t be prepared. You can try placing it again."
              : notPaid
              ? payUrl
                ? `${providerName} didn’t receive a payment: it was cancelled or the page was closed, so nothing was charged. Your ${single ? "order is" : "orders are"} held${holdTime ? ` until ${holdTime}` : " for a short while"}; pay now to complete ${single ? "it" : "them"}.`
                : `${providerName} didn’t receive a payment: it was cancelled or the page was closed, so nothing was charged. The hold on these pieces has ended; return to your cart to check out again.`
              : awaitingPayment
              ? single
                ? `Your order${brandsOf[0] ? ` with ${brandsOf[0].name}` : ""} is in. Payment confirmation is pending: the brand starts preparing your order once the payment provider confirms it.`
                : `Your checkout created ${orders.length} orders, one per brand. Payment confirmation is pending: each brand starts preparing its order once the payment provider confirms it.`
              : allPaid
                ? `Your payment went through and ${single ? `${brandsOf[0]?.name ?? "the brand"} is preparing your order.` : `${orders.length} brands are preparing their orders, each one shipping separately.`}`
                : `Here is where ${single ? "the order" : `each of the ${orders.length} brand orders`} from this checkout stands.`}
          </p>
          <p className="mt-3 max-w-2xl text-xs leading-relaxed text-ink-3">
            {notStarted
              ? `Your ${single ? "order is" : "orders are"} held${holdTime ? ` until ${holdTime}` : " for a short while"}. Retry opens ${providerName}’s page. `
              : paymentFailed
              ? "The checkout is closed. Start a new checkout to try another payment method. "
              : notPaid
              ? "If you did pay, press Check again: some payments take a moment to reach us. "
              : awaitingPayment && group.payment?.status === "not_charged"
              ? "Payments aren’t connected in this environment, so nothing was charged and these orders stay awaiting payment confirmation. "
              : awaitingPayment
                ? confirming === "timed_out"
                  ? `${providerName} hasn’t confirmed the payment yet. Some payments take a few minutes; we’ll email you as soon as it’s confirmed. `
                  : `${providerName} is confirming the payment. This page updates on its own. `
              : sample
                ? "This is sample order history for the demo account. It shows how a paid checkout reads; no payment was taken. "
                : ""}
            Quote the order ID if you contact us or a brand.
          </p>

          {awaitingPayment && confirming && !notPaid && !notStarted ? (
            <div role="status" className="mt-6 flex max-w-2xl flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-line-soft bg-card px-4 py-3 text-sm text-ink-2 print:hidden">
              {confirming === "polling" ? (
                <>
                  <Loader2 className="size-4 shrink-0 animate-spin text-violet" aria-hidden />
                  <span className="min-w-0 flex-1">Checking your payment with {providerName}…</span>
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1">Still confirming your payment — we’ll email you when it’s confirmed.</span>
                  <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
                    Retry
                  </Button>
                </>
              )}
            </div>
          ) : null}

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap print:hidden">
            {notStarted ? (
              <>
                <Button type="button" variant="primary" size="lg" onClick={onRetry}>
                  Retry
                </Button>
                <Button asChild variant="secondary" size="lg">
                  <Link href="/bag">Return to cart</Link>
                </Button>
              </>
            ) : notPaid ? (
              <>
                {payUrl ? (
                  <Button asChild variant="primary" size="lg">
                    <a href={payUrl}>Pay now</a>
                  </Button>
                ) : (
                  <Button asChild variant="primary" size="lg">
                    <Link href="/bag">Return to cart</Link>
                  </Button>
                )}
                <Button type="button" variant="secondary" size="lg" onClick={onRetry}>
                  Check again
                </Button>
                {payUrl ? (
                  <Button asChild variant="secondary" size="lg">
                    <Link href="/bag">Return to cart</Link>
                  </Button>
                ) : null}
              </>
            ) : paymentFailed ? (
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

        <ReceiptTicket group={group} orders={orders} sample={sample} holder={holder} notPaid={notPaid} className="lg:mx-0 print:mx-auto print:break-inside-avoid" />
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
  const brand = orderBrand(order)
  const method = methodFromLabel(order.shippingMethod)
  const country = order.shippingAddress.country
  // The estimate the server returned with the order; an older order without one gets the same
  // engine's estimate computed here, labelled so. Read after hydration (it can read the clock).
  const hydrated = useHydrated()
  const estimate = hydrated ? orderEstimate(order) : null
  return (
    <article aria-label={`${brand ? `${brand.name} order` : "Order"} ${order.reference}`} className="flex flex-col rounded-lg border border-line-soft bg-card">
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
