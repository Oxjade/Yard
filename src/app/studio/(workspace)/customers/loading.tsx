import { customersDescription } from "@/components/studio/business/model"
import { CustomersSkeleton } from "@/components/studio/business/skeletons"
import { STUDIO_BRAND_ID, brandById } from "@/lib/data/brands"

export default function CustomersLoading() {
  return <CustomersSkeleton description={customersDescription(brandById.get(STUDIO_BRAND_ID)!.name)} />
}
