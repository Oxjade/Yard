import type { Metadata } from "next"
import { AdminProposalFormRoute } from "@/components/proposals/admin-proposal-form"

export const metadata: Metadata = { title: "Add product for brand" }

/** ?brand=<id>: a new product for that brand; ?product=<id>: suggest changes; ?revise=<proposal id>: update a waiting suggestion. */
export default function AdminSuggestionFormPage() {
  return <AdminProposalFormRoute />
}
