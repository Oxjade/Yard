import type { Metadata } from "next"
import { ShippingView } from "@/components/studio/shipping/shipping-view"

export const metadata: Metadata = { title: "Shipping & fulfilment" }

/** Studio › Shipping & fulfilment (§6.5): a static shell; the settings load client-side through the API. */
export default function StudioShippingPage() {
  return <ShippingView />
}
