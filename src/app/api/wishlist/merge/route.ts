import { mergeSavedBody } from "@/server/follows/contracts"
import { mergeSaved } from "@/server/follows"
import { route } from "@/server/http/route"

/**
 * POST /api/wishlist/merge { productIds, brandIds }: after sign-in, the browser's saved pieces and
 * followed brands are added to the account (existing ones are left alone; unknown ids are skipped
 * and returned in `skipped`).
 */
export const POST = route({ auth: "shopper", body: mergeSavedBody, maxBody: 32 * 1024, rate: { key: "wishlist.merge", limit: 5, windowSec: 60, daily: 50 } }, async ({ actor, body, ipHash, req }) =>
  mergeSaved(actor, body, { ipHash, userAgent: req.headers.get("user-agent") }),
)
