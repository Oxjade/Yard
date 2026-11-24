import { AnalyticsSkeleton, analyticsDescription } from "@/components/studio/business/skeletons"

/** Neutral copy: this shell is shared by the demo and by real brands, so it names no brand. */
export default function AnalyticsLoading() {
  return <AnalyticsSkeleton description={analyticsDescription("your brand")} />
}
