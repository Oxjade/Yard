import { z } from "zod"
import { route } from "@/server/http/route"
import { productUpdateBody } from "@/server/catalog/contracts"
import { idParam } from "@/server/catalog/params"
import { getStudioProduct, setProductStatus, updateProduct } from "@/server/catalog/studio"

/** GET /api/studio/catalog/products/{id} (any member): one product of the active brand (404 for another brand's). */
export const GET = route({ auth: "brand", permission: "any_member", rate: { key: "studio.catalog.read", limit: 240, windowSec: 60 } }, async ({ actor, params }) => getStudioProduct(actor, idParam(params, "id")))

/**
 * PATCH /api/studio/catalog/products/{id} (content.publish): partial update. `expectedVersion` is
 * required; a stale one is 409. Sending `variants` reconciles them (kept by id, new ones added,
 * missing ones archived); stock changes go through the stock endpoint.
 */
export const PATCH = route(
  { auth: "brand", permission: "content.publish", body: productUpdateBody, maxBody: 256 * 1024, rate: { key: "studio.catalog.update", limit: 60, windowSec: 60 } },
  async ({ actor, params, body, ipHash }) => updateProduct(actor, idParam(params, "id"), body, ipHash),
)

/** DELETE /api/studio/catalog/products/{id}?expectedVersion=N (content.publish): archives the product (history, holds and orders keep pointing at it). */
export const DELETE = route(
  { auth: "brand", permission: "content.publish", query: z.object({ expectedVersion: z.coerce.number().int().positive() }), rate: { key: "studio.catalog.update", limit: 60, windowSec: 60 } },
  async ({ actor, params, query, ipHash }) => setProductStatus(actor, idParam(params, "id"), { action: "archive", expectedVersion: query.expectedVersion }, ipHash),
)
