import { ordersDescription } from "@/components/studio/business/model"
import { OrdersSkeleton } from "@/components/studio/business/skeletons"
import { STUDIO_BRAND_ID, brandById } from "@/lib/data/brands"

/*
 * In the (list) group so it wraps only the orders list. A loading boundary above [id] would
 * start the response before that page checks the id, turning its 404 into a 200.
 */
export default function OrdersLoading() {
  return <OrdersSkeleton description={ordersDescription(brandById.get(STUDIO_BRAND_ID)!.name)} />
}
