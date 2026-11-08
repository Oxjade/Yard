import { z } from "zod"
import { route } from "@/server/http/route"
import { intParam } from "@/server/catalog/params"
import { restoreStorefrontVersion } from "@/server/catalog/storefront"

/** POST /api/studio/storefront/versions/{version}/restore (content.publish): copies that version into the draft (`baseRevision` = the draft revision you saw). Not live until published. */
export const POST = route(
  { auth: "brand", permission: "content.publish", body: z.strictObject({ baseRevision: z.number().int().min(0) }), rate: { key: "studio.storefront.save", limit: 60, windowSec: 60 } },
  async ({ actor, params, body, ipHash }) => restoreStorefrontVersion(actor, intParam(params, "version"), body.baseRevision, ipHash),
)
