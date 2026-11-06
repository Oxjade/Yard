import type { Metadata } from "next"
import { PromotionsPage } from "@/components/studio/growth/promotions"

export const metadata: Metadata = { title: "Promotions" }

export default function StudioCampaignsPage() {
  return <PromotionsPage />
}
