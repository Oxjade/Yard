import { route, json } from "@/server/http/route"
import { collectionBody } from "@/server/catalog/contracts"
import { createCollection, listStudioCollections } from "@/server/catalog/studio"

/** GET /api/studio/catalog/collections (any member): the active brand's collections with ordered product ids. */
export const GET = route({ auth: "brand", permission: "any_member", rate: { key: "studio.catalog.read", limit: 240, windowSec: 60 } }, async ({ actor }) => listStudioCollections(actor))

/** POST /api/studio/catalog/collections (content.publish): creates a collection (handle from the name unless given). 201. */
export const POST = route(
  { auth: "brand", permission: "content.publish", body: collectionBody, rate: { key: "studio.catalog.collections", limit: 30, windowSec: 60 } },
  async ({ actor, body, ipHash }) => json(await createCollection(actor, body, ipHash), 201),
)
