import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { connection } from "next/server"
import { StudioProposalReviewPage } from "@/components/proposals/studio-proposals"

export const metadata: Metadata = { title: "Suggestion from Yard" }
/** Suggestions live on the server, read per request: nothing to prerender. */
export const instant = false

export default async function StudioSuggestionPage({ params }: PageProps<"/studio/products/suggestions/[id]">) {
  await connection()
  const { id } = await params
  if (!/^pp_[A-Za-z0-9_-]+$/.test(id)) notFound()
  return <StudioProposalReviewPage id={id} />
}
