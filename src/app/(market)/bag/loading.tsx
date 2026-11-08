import { BagSkeleton } from "@/components/market/checkout/skeletons"

/** The real title over the cart's own skeleton: brand groups beside the summary. */
export default function BagLoading() {
  return (
    <div className="mx-auto max-w-page px-4 pt-28 md:px-8 md:pt-32">
      <h1 className="font-display text-display-lg text-ink">Cart</h1>
      <BagSkeleton />
    </div>
  )
}
