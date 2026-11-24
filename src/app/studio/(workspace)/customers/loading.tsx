import { customersDescription } from "@/components/studio/business/model"
import { CustomersSkeleton } from "@/components/studio/business/skeletons"

/** Neutral copy: this shell is shared by the demo and by real brands, so it names no brand and claims no sample data. */
export default function CustomersLoading() {
  return <CustomersSkeleton sample={false} description={customersDescription("your brand")} />
}
