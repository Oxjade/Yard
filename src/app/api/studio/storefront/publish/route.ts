import { route } from "@/server/http/route"
import { storefrontPublishBody } from "@/server/catalog/contracts"
import { publishStorefront } from "@/server/catalog/storefront"

/**
 * POST /api/studio/storefront/publish (content.publish): snapshots the draft as the next version.
 * `draftRevision` must match the draft and `expectedVersion` the live version (409 otherwise).
 * Refused while the brand is restricted or under review.
 */
export const POST = route(
  { auth: "brand", permission: "content.publish", body: storefrontPublishBody, rate: { key: "studio.storefront.publish", limit: 20, windowSec: 60, daily: 200 } },
  async ({ actor, body, ipHash }) => publishStorefront(actor, body, ipHash),
)
