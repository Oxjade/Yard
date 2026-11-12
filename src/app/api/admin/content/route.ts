import { contentQuery, type ContentListDto } from "@/lib/api/contracts/admin"
import { route } from "@/server/http/route"
import { assertCan } from "@/server/moderation/shared"
import { contentCounts, listIntegrations, listPlaces, listPosts } from "@/server/moderation"

/**
 * GET /api/admin/content?tab=posts|uploads|places|integrations. The page opens for any of the three
 * view permissions; each tab checks its own (content.moderate, places.moderate, social.manage).
 */
export const GET = route({ rate: { key: "admin.content", limit: 120, windowSec: 60 }, auth: "admin", permission: "any_admin", query: contentQuery }, async ({ actor, query }): Promise<ContentListDto> => {
  const tab = query.tab
  if (tab === "places") {
    assertCan(actor, "places.moderate")
    return { tab, places: await listPlaces(), counts: await contentCounts() }
  }
  if (tab === "integrations") {
    assertCan(actor, "social.manage")
    return { tab, ...(await listIntegrations()), counts: await contentCounts() }
  }
  assertCan(actor, "content.moderate")
  return { tab, posts: await listPosts(tab), counts: await contentCounts() }
})
