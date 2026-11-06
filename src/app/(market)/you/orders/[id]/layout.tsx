import { notFound } from "next/navigation"
import { customerOrders } from "@/lib/data/orders"

/**
 * Checks the id before anything streams, so an unknown order answers with a real 404 while
 * the page below can have a loading state (loading.tsx sits inside this layout). The
 * not-found page is one level up, where a layout's notFound() is caught.
 */
export const instant = false

/** Orders placed in this browser get ids like mo_cg_<key>_<n>; they live in the local orders store. */
const LOCAL_ORDER_ID = /^mo_cg_[a-z0-9]+_\d+$/

export default async function OrderLayout({ children, params }: LayoutProps<"/you/orders/[id]">) {
  const { id } = await params
  if (!customerOrders.some((o) => o.id === id) && !LOCAL_ORDER_ID.test(id)) notFound()
  return children
}
