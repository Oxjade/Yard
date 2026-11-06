import { Suspense } from "react"
import type { Metadata } from "next"
import { PageHeader } from "@/components/dashboard/page-header"
import { TableSkeleton } from "@/components/feedback/skeletons"
import { CustomersIndex } from "@/components/studio/business/customers-index"
import { customersDescription } from "@/components/studio/business/model"
import { STUDIO_BRAND_ID, brandById } from "@/lib/data/brands"

export const metadata: Metadata = { title: "Customers" }

/** The list reads ?customer= to open someone's history, so it renders inside Suspense. */
export default function StudioCustomersPage() {
  const brand = brandById.get(STUDIO_BRAND_ID)!
  return (
    <Suspense
      fallback={
        <div className="grid gap-6">
          <PageHeader title="Customers" description={customersDescription(brand.name)} />
          <TableSkeleton rows={6} cols={6} />
        </div>
      }
    >
      <CustomersIndex />
    </Suspense>
  )
}
