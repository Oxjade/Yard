import { Suspense } from "react"
import type { Metadata } from "next"
import { ConfirmationView } from "@/components/market/checkout/confirmation-view"
import { ConfirmationSkeleton } from "@/components/market/checkout/skeletons"

export const metadata: Metadata = {
  title: "Order confirmation",
  robots: { index: false },
}

export default function CheckoutConfirmationPage() {
  return (
    <div className="mx-auto max-w-page px-4 pt-28 md:px-8 md:pt-32">
      {/* Reads ?group= on the client, so it streams behind the skeleton. */}
      <Suspense fallback={<ConfirmationSkeleton />}>
        <ConfirmationView />
      </Suspense>
    </div>
  )
}
