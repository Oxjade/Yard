import type { Metadata } from "next"
import { AccountGate } from "@/components/market/account/auth-panel"
import { OrderDetail } from "@/components/market/account/order-detail"
import { customerOrders } from "@/lib/data/orders"
import { img } from "@/lib/data/media"

export const metadata: Metadata = { title: "Order" }

/** layout.tsx checks the id first, so an unknown order answers with a real 404. Known ids are prerendered. */
export const instant = false
/**
 * The whole route is static output, so an id that wasn't prerendered waits for its own render
 * (where layout.tsx's check runs before anything is sent) instead of being served the shared
 * fallback shell with a 200 first.
 */
export const ensureStatic = "navigation"

export function generateStaticParams() {
  return customerOrders.map((o) => ({ id: o.id }))
}

export default async function OrderPage({ params }: PageProps<"/you/orders/[id]">) {
  const { id } = await params
  return (
    <div className="mx-auto max-w-page px-4 pt-28 md:px-8 md:pt-32">
      <AccountGate
        skeleton="detail"
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
