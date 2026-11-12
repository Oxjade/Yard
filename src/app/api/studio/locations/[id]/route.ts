import { locationPatchBody } from "@/lib/api/contracts/around"
import { brandWriteRate, deleteLocation, getLocation, updateLocation } from "@/server/around/service"
import { route } from "@/server/http/route"

/** GET /api/studio/locations/{id}: one of the active brand's places (another brand's is 404). */
export const GET = route({ rate: { key: "studio.locations.read", limit: 120, windowSec: 60 }, auth: "brand", permission: "any_member" }, async ({ params }) => {
  const { location } = await getLocation(params.id ?? "")
  return { location }
})

/** PATCH: edit or change visibility (`{ visibility }`); rejected and removed places are locked (422). */
export const PATCH = route({ auth: "brand", permission: "locations.manage", body: locationPatchBody }, async ({ actor, params, body, ipHash }) => {
  await brandWriteRate(actor, ipHash)
  return updateLocation(params.id ?? "", body, ipHash)
})

/** DELETE: always allowed for the brand's own place, locked ones included. */
export const DELETE = route({ auth: "brand", permission: "locations.manage" }, async ({ actor, params, ipHash }) => {
  await brandWriteRate(actor, ipHash)
  return deleteLocation(params.id ?? "", ipHash)
})
