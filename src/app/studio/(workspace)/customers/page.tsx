import type { Metadata } from "next"
import { Suspense } from "react"
import { connection } from "next/server"
import { SampleDataProvider } from "@/components/sample/sample-data-context"
import { customersDescription } from "@/components/studio/business/model"
import { CustomersIndex } from "@/components/studio/business/customers-index"
import { CustomersSkeleton } from "@/components/studio/business/skeletons"
import { getEnv } from "@/server/env"

export const metadata: Metadata = { title: "Customers" }

/**
 * Studio › Customers. The demo switch is read at request time (after connection(), inside
 * Suspense, so the build never fixes it): the demo renders its sample list at once; a real brand
 * gets its buyers from GET /api/studio/customers.
 */
export default function StudioCustomersPage() {
  return (
    <Suspense fallback={<CustomersSkeleton sample={false} description={customersDescription("your brand")} />}>
      <WithSampleFlag />
    </Suspense>
  )
}

async function WithSampleFlag() {
  await connection()
  return (
    <SampleDataProvider value={getEnv().seedDemo}>
      <CustomersIndex />
    </SampleDataProvider>
  )
}
