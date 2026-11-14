import type { Metadata } from "next"
import { StudioProposalsPage } from "@/components/proposals/studio-proposals"

export const metadata: Metadata = { title: "Suggestions from Yard" }

export default function StudioSuggestionsPage() {
  return <StudioProposalsPage />
}
