import { ordersDescription } from "@/components/studio/business/model"
import { OrdersSkeleton } from "@/components/studio/business/skeletons"
import { STUDIO_BRAND_ID, brandById } from "@/lib/data/brands"

export default function OrdersLoading() {
  return <OrdersSkeleton description={ordersDescription(brandById.get(STUDIO_BRAND_ID)!.name)} />
}
