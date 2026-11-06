import { AnalyticsSkeleton, analyticsDescription } from "@/components/studio/business/skeletons"
import { STUDIO_BRAND_ID, brandById } from "@/lib/data/brands"

export default function AnalyticsLoading() {
  return <AnalyticsSkeleton description={analyticsDescription(brandById.get(STUDIO_BRAND_ID)!.name)} />
}
