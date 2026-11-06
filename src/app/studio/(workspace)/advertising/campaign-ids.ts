import { campaigns } from "@/lib/data/ads"
import { STUDIO_BRAND_ID } from "@/lib/data/brands"

/** The signed-in brand's sample campaigns, prerendered. */
export const brandCampaigns = campaigns.filter((c) => c.brandId === STUDIO_BRAND_ID)

/** Campaigns created in Studio get ids like cmp_local_<base36>; they live in the local Studio store. */
export const LOCAL_CAMPAIGN_ID = /^cmp_local_[a-z0-9]+$/

export function isCampaignId(id: string) {
  return brandCampaigns.some((c) => c.id === id) || LOCAL_CAMPAIGN_ID.test(id)
}
