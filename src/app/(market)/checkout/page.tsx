import type { Metadata } from "next"
import { CheckoutFlow } from "@/components/market/checkout/checkout-flow"

export const metadata: Metadata = {
  title: "Checkout",
  robots: { index: false },
}

export default function CheckoutPage() {
  return (
    <div className="mx-auto max-w-page px-4 pt-28 md:px-8 md:pt-32">
      <CheckoutFlow />
    </div>
  )
}
