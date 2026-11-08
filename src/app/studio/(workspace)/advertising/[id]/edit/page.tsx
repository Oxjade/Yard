import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { CampaignWizard } from "@/components/studio/growth/campaign-wizard"
import { brandCampaigns, isCampaignId } from "../../campaign-ids"

export const metadata: Metadata = { title: "Edit campaign" }

/** As the results page: unknown ids answer with a real 404; sample campaigns are prerendered. */
export const instant = false
/**
 * The whole route is static output, so an address that wasn't prerendered waits for its own
 * render (where the check runs before anything is sent) instead of being served the shared
 * fallback shell with a 200 first.
 */
export const ensureStatic = "navigation"

export function generateStaticParams() {
  return brandCampaigns.map((c) => ({ id: c.id }))
}

export default async function EditCampaignPage({ params }: PageProps<"/studio/advertising/[id]/edit">) {
  const { id } = await params
  if (!isCampaignId(id)) notFound()
  return <CampaignWizard campaignId={id} />
}
