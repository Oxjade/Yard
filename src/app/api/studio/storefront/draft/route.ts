import { route } from "@/server/http/route"
import { storefrontDraftBody } from "@/server/catalog/contracts"
import { saveStorefrontDraft } from "@/server/catalog/storefront"

/** PUT /api/studio/storefront/draft (content.publish): saves the draft. `baseRevision` must be the draft revision you edited (409 otherwise). Product, collection and cover ids must be the brand's. */
export const PUT = route(
  { auth: "brand", permission: "content.publish", body: storefrontDraftBody, maxBody: 128 * 1024, rate: { key: "studio.storefront.save", limit: 60, windowSec: 60 } },
  async ({ actor, body }) => saveStorefrontDraft(actor, body),
)
