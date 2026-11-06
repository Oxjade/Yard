import { AccountSkeleton } from "@/components/market/account/skeletons"

export default function OverviewLoading() {
  return (
    <div className="mx-auto max-w-page px-4 pt-28 md:px-8 md:pt-32">
      <AccountSkeleton variant="grid" />
    </div>
  )
}
