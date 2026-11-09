import { Suspense } from "react"
import type { Metadata } from "next"
import { PaymentReturn } from "@/components/market/checkout/payment-return"
import { ConfirmationSkeleton } from "@/components/market/checkout/skeletons"

export const metadata: Metadata = {
  title: "Checking payment",
  robots: { index: false },
}

export default function CheckoutPaymentReturnPage() {
  return (
    <div className="mx-auto max-w-page px-4 pt-28 md:px-8 md:pt-32">
      {/* Reads ?checkout= on the client, so it streams behind the skeleton. */}
      <Suspense fallback={<ConfirmationSkeleton />}>
        <PaymentReturn />
      </Suspense>
    </div>
  )
}
