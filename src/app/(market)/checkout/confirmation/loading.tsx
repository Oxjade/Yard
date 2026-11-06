import { ConfirmationSkeleton } from "@/components/market/checkout/skeletons"

export default function ConfirmationLoading() {
  return (
    <div className="mx-auto max-w-page px-4 pt-28 md:px-8 md:pt-32">
      <ConfirmationSkeleton />
    </div>
  )
}
