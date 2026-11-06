import { promotionsDescription } from "@/components/studio/growth/copy"
import { ListSkeleton } from "@/components/studio/growth/form"

export default function PromotionsLoading() {
  return <ListSkeleton title="Promotions" description={promotionsDescription} tabs={5} />
}
