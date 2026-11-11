import { foundingCreateBody, foundingListQuery } from "@/lib/api/contracts/founding"
import { createFoundingBrand, listFoundingBrands } from "@/server/catalog/founding"
import { json, route } from "@/server/http/route"

/**
 * GET /api/admin/founding-brands?cursor=&limit= (owner: brands.founding): founding brands, newest
 * first, 50 a page with `nextCursor` for "Load more". Each row carries its derived status
 * (setting_up | link_sent | claimed | live), the pending claim link (never its URL) and counts.
 */
export const GET = route({ auth: "admin", permission: "brands.founding", query: foundingListQuery, rate: { key: "admin.founding.list", limit: 120, windowSec: 60 } }, async ({ query }) => listFoundingBrands(query))

/**
 * POST /api/admin/founding-brands { name, handle, category, city, country, currency, story?,
 * instagram?, tiktok?, idempotencyKey } → 201 { brand } (200 on a replay of the same key).
 * Creates a verified, founding, unclaimed brand with starter shipping and a storefront draft.
 * Audited. 20 an hour and 100 a day per admin.
 */
export const POST = route(
  { auth: "admin", permission: "brands.founding", body: foundingCreateBody, maxBody: 16 * 1024, rate: { key: "admin.founding.create", limit: 20, windowSec: 3600, daily: 100 } },
  async ({ actor, body, ipHash }) => {
    const r = await createFoundingBrand(actor, body, ipHash)
    return json({ brand: r.brand }, r.status)
  },
)
