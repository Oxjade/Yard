import type { Metadata } from "next"
import { HealthView } from "@/components/admin/platform/health/health-view"

export const metadata: Metadata = { title: "Health" }

export default function AdminHealthPage() {
  return <HealthView />
}
