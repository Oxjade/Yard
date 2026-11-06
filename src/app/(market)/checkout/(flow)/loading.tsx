import { CheckoutSkeleton } from "@/components/market/checkout/skeletons"

/** The steps and the order summary, shaped like the first step. */
export default function CheckoutLoading() {
  return (
    <div className="mx-auto max-w-page px-4 pt-28 md:px-8 md:pt-32">
      <CheckoutSkeleton withTitle />
    </div>
  )
}
