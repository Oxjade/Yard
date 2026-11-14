import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { connection } from "next/server"
import { StudioProposalEditPage } from "@/components/proposals/studio-proposals"

export const metadata: Metadata = { title: "Edit before accepting" }
export const instant = false

export default async function StudioSuggestionEditPage({ params }: PageProps<"/studio/products/suggestions/[id]/edit">) {
  await connection()
  const { id } = await params
  if (!/^pp_[A-Za-z0-9_-]+$/.test(id)) notFound()
  return <StudioProposalEditPage id={id} />
}
