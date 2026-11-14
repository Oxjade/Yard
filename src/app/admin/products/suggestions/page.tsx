import type { Metadata } from "next"
import { AdminProposalsView } from "@/components/proposals/admin-proposals-view"

export const metadata: Metadata = { title: "Suggestions" }

export default function AdminSuggestionsPage() {
  return <AdminProposalsView />
}
