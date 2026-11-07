import type { Metadata } from "next"
import { DeliveryView } from "@/components/admin/trust/delivery-view"

export const metadata: Metadata = { title: "Delivery" }

export default function AdminDeliveryPage() {
  return <DeliveryView />
}
