import { locationEventBody } from "@/lib/api/contracts/around"
import { brandWriteRate, createEvent } from "@/server/around/service"
import { json, route } from "@/server/http/route"

/** POST /api/studio/locations/{id}/events: an event at one of the brand's places, under the same review rules. */
export const POST = route({ auth: "brand", permission: "locations.manage", body: locationEventBody }, async ({ actor, params, body, ipHash }) => {
  await brandWriteRate(actor, ipHash)
  return json(await createEvent(params.id ?? "", body, ipHash), 201)
})
