import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { OrderDetail } from "@/components/studio/business/order-detail"
import { STUDIO_BRAND_ID } from "@/lib/data/brands"
import { merchantOrders } from "@/lib/data/orders"

/**
 * The id is checked before anything renders so an unknown order answers with a real 404.
 * That check needs the URL, so this segment may block; the brand's sample orders are prerendered.
 * Only this brand's orders resolve here — in the backend phase the server enforces it per request.
 */
export const instant = false

const brandOrders = merchantOrders.filter((o) => o.brandId === STUDIO_BRAND_ID)

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
  if (!brandOrders.some((o) => o.id === id)) notFound()
  return <OrderDetail id={id} />
}
