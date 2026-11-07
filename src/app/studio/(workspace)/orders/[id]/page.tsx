import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { OrderDetail } from "@/components/studio/business/order-detail"
import { STUDIO_BRAND_ID } from "@/lib/data/brands"
import { customerOrders, merchantOrders } from "@/lib/data/orders"
import { isPlacedOrderId } from "@/lib/shipping/order-ids"

/**
 * The id is checked before anything renders so an unknown order answers with a real 404 (no
 * loading boundary sits above this page: the list's is in its (list) group, and OrderDetail shows
 * its own skeleton while the Studio store loads). That check needs the URL, so this segment may
 * block; the brand's sample orders are prerendered.
 * Only this brand's orders resolve here — in the backend phase the server enforces it per request.
 */
export const instant = false

/** The brand's sample orders, and the demo shopper's orders with it (the Studio store holds both). */
const brandOrders = [...merchantOrders, ...customerOrders].filter((o) => o.brandId === STUDIO_BRAND_ID)

/**
 * Orders placed at checkout get server-minted ids (`or_…`, or `mo_cg_…` from before v2). They live
 * in the local stores, so this page can't list them: it renders, and OrderDetail resolves the id
 * from the Studio store once it has loaded (a skeleton until then, never a flash of "not found").
 * An id that is neither a known order nor shaped like one is a real 404.
 */

export function generateStaticParams() {
  return brandOrders.map((o) => ({ id: o.id }))
}

export async function generateMetadata({ params }: PageProps<"/studio/orders/[id]">): Promise<Metadata> {
  const { id } = await params
  const order = brandOrders.find((o) => o.id === id)
  return { title: order ? `Order #${order.reference}` : "Order" }
}

export default async function StudioOrderPage({ params }: PageProps<"/studio/orders/[id]">) {
  const { id } = await params
  if (!brandOrders.some((o) => o.id === id) && !isPlacedOrderId(id)) notFound()
  return <OrderDetail id={id} />
}
