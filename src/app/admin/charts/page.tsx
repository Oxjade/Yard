import type { Metadata } from "next"
import { ChartsView } from "@/components/admin/trust/charts-view"

export const metadata: Metadata = { title: "Charts" }

export default function AdminChartsPage() {
  return <ChartsView />
}
