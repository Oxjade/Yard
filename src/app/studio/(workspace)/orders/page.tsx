import type { Metadata } from "next"
import { OrdersIndex } from "@/components/studio/business/orders-index"

export const metadata: Metadata = { title: "Orders" }

export default function StudioOrdersPage() {
  return <OrdersIndex />
}
