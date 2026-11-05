import type { Metadata } from "next"
import { SecurityView } from "@/components/admin/platform/security/security-view"

export const metadata: Metadata = { title: "Security" }

export default function AdminSecurityPage() {
  return <SecurityView />
}
