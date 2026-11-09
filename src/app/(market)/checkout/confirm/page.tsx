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
    <Suspense fallback={<ConfirmationSkeleton />}>
      <PaymentReturn />
    </Suspense>
  )
}