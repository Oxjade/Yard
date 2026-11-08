import { route } from "@/server/http/route"
import { handleQuery } from "@/server/catalog/contracts"
import { handleStatus } from "@/server/catalog/onboarding"

/** GET /api/studio/onboarding/handle?handle=x (signed-in shopper): whether a storefront handle is available (taken by a brand or another open application, reserved, or malformed). */
export const GET = route({ auth: "shopper", query: handleQuery, rate: { key: "onboarding.handle", limit: 60, windowSec: 60 } }, async ({ query }) => {
  const status = await handleStatus(query.handle.trim().toLowerCase())
  return { handle: query.handle, status, available: status === "available" }
})
