import type { Metadata } from "next"
import { AnalyticsView } from "@/components/studio/business/analytics-view"

export const metadata: Metadata = { title: "Analytics" }

export default function StudioAnalyticsPage() {
  return <AnalyticsView />
}
