import { Suspense } from "react"
import { connection } from "next/server"
import { Bone } from "@/components/feedback/skeletons"
import { SampleDataProvider } from "@/components/sample/sample-data-context"
import { getEnv } from "@/server/env"
import { StudioOverview } from "./overview"

/**
 * The Studio Overview. Whether it shows the sample Overview (demo and development) is the demo
 * switch, read at request time (after connection(), inside Suspense, so the build never fixes it)
 * and handed to the page with the first HTML: the demo renders its sample at once, with no
 * session skeleton first. The fallback is only the prerendered shell.
 */
export default function StudioOverviewPage() {
  return (
    <Suspense fallback={<OverviewFallback />}>
      <WithSampleFlag />
    </Suspense>
  )
}

async function WithSampleFlag() {
  await connection()
  return (
    <SampleDataProvider value={getEnv().seedDemo}>
      <StudioOverview />
    </SampleDataProvider>
  )
}

function OverviewFallback() {
  return (
    <div aria-busy className="grid gap-3" role="status">
      <span className="sr-only">Loading the Overview</span>
      <Bone className="h-8 w-48" />
      <Bone className="h-40 w-full rounded-lg" />
    </div>
  )
}
