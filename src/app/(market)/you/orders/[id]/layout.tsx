import { notFound } from "next/navigation"
import { customerOrders } from "@/lib/data/orders"
import { isPlacedOrderId } from "@/lib/shipping/order-ids"

/**
 * Checks the id before anything streams, so an unknown order answers with a real 404 while
 * the page below can have a loading state (loading.tsx sits inside this layout). The
 * not-found page is one level up, where a layout's notFound() is caught.
 * Orders placed at checkout (server-minted `or_…` ids, or `mo_cg_…` from before v2) live in the
 * local orders store, so only their shape is checked here; the page resolves them after hydration.
 */
export const instant = false

export default async function OrderLayout({ children, params }: LayoutProps<"/you/orders/[id]">) {
  const { id } = await params
  if (!customerOrders.some((o) => o.id === id) && !isPlacedOrderId(id)) notFound()
  return children
}
