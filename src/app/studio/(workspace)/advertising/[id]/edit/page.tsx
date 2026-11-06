import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { CampaignWizard } from "@/components/studio/growth/campaign-wizard"
import { brandCampaigns, isCampaignId } from "../../campaign-ids"

export const metadata: Metadata = { title: "Edit campaign" }

/** As the results page: unknown ids answer with a real 404; sample campaigns are prerendered. */
export const instant = false

export function generateStaticParams() {
  return brandCampaigns.map((c) => ({ id: c.id }))
}

export default async function EditCampaignPage({ params }: PageProps<"/studio/advertising/[id]/edit">) {
  const { id } = await params
  if (!isCampaignId(id)) notFound()
  return <CampaignWizard campaignId={id} />
}
