import { duplicateBody } from "@/lib/api/contracts/around"
import { brandWriteRate, duplicateLocation } from "@/server/around/service"
import { json, route } from "@/server/http/route"

/**
 * POST /api/studio/locations/{id}/duplicate: a draft copy. It keeps reviewed_at, so a copy of a
 * reviewed or rejected place goes to review when published; removed places can't be copied.
 */
export const POST = route({ auth: "brand", permission: "locations.manage", body: duplicateBody }, async ({ actor, params, body, ipHash }) => {
  await brandWriteRate(actor, ipHash)
  return json(await duplicateLocation(params.id ?? "", body, ipHash), 201)
})
