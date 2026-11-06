import type { Metadata } from "next"
import { PromotionsPage } from "@/components/studio/growth/promotions"

export const metadata: Metadata = { title: "Campaigns" }

export default function StudioCampaignsPage() {
  return <PromotionsPage />
}
