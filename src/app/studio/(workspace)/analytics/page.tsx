import type { Metadata } from "next"
import { Suspense } from "react"
import { connection } from "next/server"
import { SampleDataProvider } from "@/components/sample/sample-data-context"
import { AnalyticsSkeleton, analyticsDescription } from "@/components/studio/business/skeletons"
import { AnalyticsView } from "@/components/studio/business/analytics-view"
import { getEnv } from "@/server/env"

export const metadata: Metadata = { title: "Analytics" }

/**
 * Studio › Analytics. The demo switch is read at request time (after connection(), inside
 * Suspense, so the build never fixes it): the demo renders its sample page at once; a real brand
 * gets its own figures from GET /api/studio/analytics.
 */
export default function StudioAnalyticsPage() {
  return (
    <Suspense fallback={<AnalyticsSkeleton description={analyticsDescription("your brand")} />}>
      <WithSampleFlag />
    </Suspense>
  )
}

async function WithSampleFlag() {
  await connection()
  return (
    <SampleDataProvider value={getEnv().seedDemo}>
      <AnalyticsView />
    </SampleDataProvider>
  )
}
