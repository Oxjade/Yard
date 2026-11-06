import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { AccountGate } from "@/components/market/account/auth-panel"
import { OrderDetail } from "@/components/market/account/order-detail"
import { customerOrders } from "@/lib/data/orders"
import { img } from "@/lib/data/media"

export const metadata: Metadata = { title: "Order" }

/**
 * The id is checked before anything renders so an unknown order answers with a real 404.
 * That check needs the URL, so this segment may block; it is cheap and the known ids are
 * prerendered below.
 */
export const instant = false

/** Orders placed in this browser get ids like mo_cg_<key>_<n>; they live in the local orders store. */
const LOCAL_ORDER_ID = /^mo_cg_[a-z0-9]+_\d+$/

export function generateStaticParams() {
  return customerOrders.map((o) => ({ id: o.id }))
}

export default async function OrderPage({ params }: PageProps<"/you/orders/[id]">) {
  const { id } = await params
  if (!customerOrders.some((o) => o.id === id) && !LOCAL_ORDER_ID.test(id)) notFound()

  return (
    <div className="mx-auto max-w-page px-4 pt-28 md:px-8 md:pt-32">
      <AccountGate
        skeleton="list"
        invite={{
          title: "Your order",
          body: "Sign in to see this order's progress, tracking and returns.",
          image: img("objects/bags/1"),
        }}
      >
        <OrderDetail id={id} />
      </AccountGate>
    </div>
  )
}
