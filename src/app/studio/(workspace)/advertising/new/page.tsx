import type { Metadata } from "next"
import { CampaignWizard } from "@/components/studio/growth/campaign-wizard"

export const metadata: Metadata = { title: "Create a campaign" }

export default function NewCampaignPage() {
  return <CampaignWizard campaignId={null} />
}
