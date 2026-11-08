import { route } from "@/server/http/route"
import { collectionUpdateBody } from "@/server/catalog/contracts"
import { idParam } from "@/server/catalog/params"
import { deleteCollection, updateCollection } from "@/server/catalog/studio"

/** PATCH /api/studio/catalog/collections/{id} (content.publish): name, handle, description, image, status, position. */
export const PATCH = route(
  { auth: "brand", permission: "content.publish", body: collectionUpdateBody, rate: { key: "studio.catalog.collections", limit: 60, windowSec: 60 } },
  async ({ actor, params, body, ipHash }) => updateCollection(actor, idParam(params, "id"), body, ipHash),
)

/** DELETE /api/studio/catalog/collections/{id} (content.publish): deletes the collection (products stay). */
export const DELETE = route({ auth: "brand", permission: "content.publish", rate: { key: "studio.catalog.collections", limit: 60, windowSec: 60 } }, async ({ actor, params, ipHash }) =>
  deleteCollection(actor, idParam(params, "id"), ipHash),
)
