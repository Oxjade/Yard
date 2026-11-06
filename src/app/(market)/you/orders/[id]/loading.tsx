import { AccountSkeleton } from "@/components/market/account/skeletons"

/** Inside the id check in layout.tsx, so unknown orders still get a real 404. */
export default function OrderLoading() {
  return (
    <div className="mx-auto max-w-page px-4 pt-28 md:px-8 md:pt-32">
      <AccountSkeleton variant="detail" />
    </div>
  )
}
