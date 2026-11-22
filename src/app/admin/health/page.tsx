import type { Metadata } from "next"
import { Suspense } from "react"
import { connection } from "next/server"
import { HealthView } from "@/components/admin/platform/health/health-view"
import { SampleDataProvider } from "@/components/sample/sample-data-context"
import { getEnv } from "@/server/env"
import Loading from "./loading"

export const metadata: Metadata = { title: "Health" }

/**
 * Health. The demo switch is read at request time (after connection(), inside Suspense, as on the
 * Overview) and handed to the page with the first HTML: the demo renders its sample screen at once,
 * production its real metrics, with no flash of the other.
 */
export default function AdminHealthPage() {
  return (
    <Suspense fallback={<Loading />}>
      <WithSampleFlag />
    </Suspense>
  )
}

async function WithSampleFlag() {
  await connection()
  return (
    <SampleDataProvider value={getEnv().seedDemo}>
      <HealthView />
    </SampleDataProvider>
  )
}
