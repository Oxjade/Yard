import { Suspense } from "react"
import type { Metadata } from "next"
import { CustomersIndex } from "@/components/studio/business/customers-index"
import { customersDescription } from "@/components/studio/business/model"
import { CustomersSkeleton } from "@/components/studio/business/skeletons"
import { STUDIO_BRAND_ID, brandById } from "@/lib/data/brands"

export const metadata: Metadata = { title: "Customers" }

/** The list reads ?customer= to open someone's history, so it renders inside Suspense. */
export default function StudioCustomersPage() {
  const brand = brandById.get(STUDIO_BRAND_ID)!
  return (
    <Suspense fallback={<CustomersSkeleton description={customersDescription(brand.name)} />}>
      <CustomersIndex />
    </Suspense>
  )
}
