import { PayoutsSkeleton } from "@/components/studio/business/skeletons"
import { STUDIO_BRAND_ID, brandById } from "@/lib/data/brands"

export default function PayoutsLoading() {
  const cur = brandById.get(STUDIO_BRAND_ID)!.currency
  return <PayoutsSkeleton description={`Your earnings in ${cur}, after the 5% commission. Payouts go to your verified account.`} />
}
