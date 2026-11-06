"use client"

import { useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Check, Copy, PackageSearch } from "lucide-react"
import { motion } from "motion/react"
import { toast } from "sonner"
import { customerOrderStatus, OrderStatusBadge } from "@/components/market/account/order-status"
import { formatDay } from "@/components/market/account/format"
import { BrandMark } from "@/components/market/brand-mark"
import { SectionHeader } from "@/components/market/section-header"
import { Button } from "@/components/ui/button"
import { countries } from "@/config/markets"
import { brandById } from "@/lib/data/brands"
import { formatMoney } from "@/lib/money"
import { useOrders } from "@/lib/stores/orders"
import { useSession } from "@/lib/stores/session"
import { cn } from "@/lib/utils"
import type { MerchantOrder, MerchantOrderStatus } from "@/lib/data/types"
import { arrivalRange, deliveryDays, methodFromLabel, shippingMethodLabel } from "./shipping"
import { ConfirmationSkeleton } from "./skeletons"
import { useStoresReady } from "./use-stores-ready"

/** States in which a delivery estimate still means something. */
const expecting = new Set<MerchantOrderStatus>(["pending_payment", "paid", "processing", "shipped"])

/** The confirmation for one checkout group: its reference, then one card per brand order. */
export function ConfirmationView() {
  const params = useSearchParams()
  const groupId = params.get("group")
  const ready = useStoresReady()
  const groups = useOrders((s) => s.groups)
  const allOrders = useOrders((s) => s.orders)
  const user = useSession((s) => s.user)

  if (!ready) return <ConfirmationSkeleton />

  const group = groupId ? groups.find((g) => g.id === groupId) : undefined
  const orders = group ? group.orderIds.map((id) => allOrders.find((o) => o.id === id)).filter((o): o is MerchantOrder => !!o) : []

  if (!group || orders.length === 0) {
    return (
      <>
        <h1 className="font-display text-display-lg text-ink">Order confirmation</h1>
        <div className="mt-10 flex flex-col items-center gap-4 rounded-lg border border-dashed border-line px-6 py-16 text-center">
          <span className="inline-flex size-14 items-center justify-center rounded-full border border-line">
            <PackageSearch className="size-6 text-ink-2" />
          </span>
          <div>
            <p className="text-base text-ink">We can&apos;t find that checkout on this device</p>
            <p className="mt-1 max-w-sm text-sm text-ink-2">The link may be incomplete, or the order was placed on another device.</p>
          </div>
          <Button asChild variant="primary">
            <Link href="/you/orders">See your orders</Link>
          </Button>
        </div>
      </>
    )
  }

  const firstName = user?.name.split(" ")[0]
  const brandsOf = orders.map((o) => brandById.get(o.brandId)!)
  const processing = brandsOf.flatMap((b) => b.processingDays)
  const returns = brandsOf.map((b) => b.returnsDays)
  const single = orders.length === 1
  // Orders are created unpaid and only the payment provider may mark them paid, so the
  // heading and labels follow the orders' real status instead of assuming success.
  const awaitingPayment = orders.some((o) => o.status === "pending_payment")
  const allPaid = orders.every((o) => o.status === "paid")

  return (
    <>
      <section aria-labelledby="confirmed-title">
        <motion.span
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 420, damping: 18, delay: 0.1 }}
          className="inline-flex size-12 items-center justify-center rounded-full bg-acid text-obsidian"
          aria-hidden
        >
          <Check className="size-6" strokeWidth={2.5} />
        </motion.span>
        <h1 id="confirmed-title" className="mt-6 font-display text-display-lg text-ink">
          {awaitingPayment ? "Order placed" : "Order confirmed"}
        </h1>
        <p className="mt-4 max-w-2xl text-pretty text-[0.9375rem] leading-relaxed text-ink-2">
          {firstName ? `Thank you, ${firstName}. ` : "Thank you. "}
          {awaitingPayment
            ? single
              ? `Your order with ${brandsOf[0].name} is in. Payment confirmation is pending: the brand starts preparing your order once the payment provider confirms it.`
              : `Your checkout created ${orders.length} orders, one per brand. Payment confirmation is pending: each brand starts preparing its order once the payment provider confirms it.`
            : allPaid
              ? `Your payment went through and ${single ? `${brandsOf[0].name} is preparing your order.` : `${orders.length} brands are preparing their orders, each one shipping separately.`}`
              : `Here is where ${single ? "the order" : `each of the ${orders.length} brand orders`} from this checkout stands.`}
        </p>

        <dl className="mt-8 grid gap-px overflow-hidden rounded-lg border border-line-soft bg-line-soft sm:grid-cols-3">
          <div className="bg-card px-4 py-3.5 md:px-5">
            <dt className="text-xs text-ink-3">Checkout reference</dt>
            <dd className="mt-1 flex items-center gap-1.5">
              <span className="text-lg text-ink tabular">{group.reference}</span>
              <CopyReference value={group.reference} />
            </dd>
          </div>
          <div className="bg-card px-4 py-3.5 md:px-5">
            <dt className="text-xs text-ink-3">Placed</dt>
            <dd className="mt-1 text-lg text-ink tabular">{formatDay(group.placedAt, { year: true })}</dd>
          </div>
          <div className="bg-card px-4 py-3.5 md:px-5">
            <dt className="text-xs text-ink-3">{awaitingPayment ? "Total" : "Total charged"}</dt>
            <dd className="mt-1 text-lg text-ink tabular">{formatMoney(group.total, group.currency)}</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs leading-relaxed text-ink-3">
          {awaitingPayment
            ? "Payments are simulated in this development build. No payment provider is connected, so nothing was charged and these orders stay awaiting payment."
            : "Payments are simulated in this development build."}{" "}
          Quote the reference if you contact us or a brand.
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Button asChild variant="primary" size="lg">
            <Link href="/you/orders">Track in Your World</Link>
          </Button>
          <Button asChild variant="secondary" size="lg">
            <Link href="/shop">Continue shopping</Link>
          </Button>
        </div>
      </section>

      <section aria-labelledby="orders-title" className="mt-24 md:mt-32">
        <div id="orders-title">
          <SectionHeader
            title={single ? "Your order" : `${orders.length} orders, one per brand`}
            description={single ? undefined : "Each brand packs and ships its own parcel, with its own tracking and returns."}
          />
        </div>
        <div className={cn("grid gap-4 md:grid-cols-2", orders.length >= 3 && "xl:grid-cols-3")}>
          {orders.map((o) => (
            <BrandOrderCard key={o.id} order={o} />
          ))}
        </div>
      </section>

      <section aria-labelledby="next-title" className="mt-24 md:mt-32">
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
    </>
  )
}

function BrandOrderCard({ order }: { order: MerchantOrder }) {
  const brand = brandById.get(order.brandId)!
  const method = methodFromLabel(order.shippingMethod)
  const country = order.shippingAddress.country
  return (
    <article aria-label={`${brand.name} order ${order.reference}`} className="flex flex-col rounded-lg border border-line-soft bg-card">
      <header className="border-b border-line-soft px-4 py-3.5 md:px-5">
        <div className="flex items-start justify-between gap-3">
          <Link href={`/brands/${brand.handle}`} className="flex min-w-0 items-center gap-2.5">
            <BrandMark brand={brand} size="sm" />
            <div className="min-w-0">
              <p className="truncate text-sm text-ink">{brand.name}</p>
              <p className="truncate text-xs text-ink-2 tabular">Order {order.reference}</p>
            </div>
          </Link>
          <OrderStatusBadge status={order.status} className="shrink-0" />
        </div>
        <p className="mt-2.5 text-xs leading-relaxed text-ink-2">{customerOrderStatus[order.status].note}</p>
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
            <p className="text-sm text-ink tabular">{formatMoney(l.unitPrice * l.quantity, order.currency)}</p>
          </li>
        ))}
      </ul>
      <dl className="mt-auto grid gap-2 border-t border-line-soft px-4 py-4 text-sm md:px-5">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-ink-2">Shipping</dt>
          <dd className="text-right text-ink tabular">
            {shippingMethodLabel[method]}, {order.shipping === 0 ? "free" : formatMoney(order.shipping, order.currency)}
          </dd>
        </div>
        {expecting.has(order.status) ? (
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-ink-2">Expected</dt>
            <dd className="text-right text-ink tabular">{arrivalRange(new Date(order.placedAt), deliveryDays(brand, country, method))}</dd>
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
          <dd className="text-base text-ink tabular">{formatMoney(order.total, order.currency)}</dd>
        </div>
      </dl>
    </article>
  )
}

function CopyReference({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      toast("Reference copied", { description: value })
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      toast("Couldn't copy the reference", { description: "Select it and copy it instead." })
    }
  }
  return (
    <button type="button" onClick={copy} aria-label="Copy checkout reference" className="inline-flex size-8 items-center justify-center rounded-md text-ink-2 transition hover:bg-elevated hover:text-ink">
      {copied ? <Check className="size-4 text-acid" /> : <Copy className="size-4" />}
    </button>
  )
}
