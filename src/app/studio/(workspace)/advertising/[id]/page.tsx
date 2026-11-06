import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { CampaignResults } from "@/components/studio/growth/campaign-results"
import { brandCampaigns, isCampaignId } from "../campaign-ids"

export const metadata: Metadata = { title: "Campaign results" }

/**
 * The id is checked before anything renders so an unknown campaign answers with a real 404.
 * That check needs the URL, so this segment may block; the brand's sample campaigns are prerendered.
 */
export const instant = false

export function generateStaticParams() {
  return brandCampaigns.map((c) => ({ id: c.id }))
}

export default async function CampaignResultsPage({ params }: PageProps<"/studio/advertising/[id]">) {
  const { id } = await params
  if (!isCampaignId(id)) notFound()
  return <CampaignResults id={id} />
}
