import { route } from "@/server/http/route"
import { handleQuery } from "@/server/catalog/contracts"
import { applicantHandleStatus } from "@/server/catalog/onboarding"

/** GET /api/studio/onboarding/handle?handle=x (signed-in shopper): whether a storefront handle is available (taken by another brand or another open application, reserved, or malformed; the caller's own application doesn't count). */
export const GET = route({ auth: "shopper", query: handleQuery, rate: { key: "onboarding.handle", limit: 60, windowSec: 60 } }, async ({ actor, query }) => {
  const status = await applicantHandleStatus(actor, query.handle.trim().toLowerCase())
  return { handle: query.handle, status, available: status === "available" }
})
