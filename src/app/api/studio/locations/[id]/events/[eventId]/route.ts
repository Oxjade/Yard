import { locationEventPatchBody } from "@/lib/api/contracts/around"
import { brandWriteRate, deleteEvent, updateEvent } from "@/server/around/service"
import { route } from "@/server/http/route"

export const PATCH = route({ auth: "brand", permission: "locations.manage", body: locationEventPatchBody }, async ({ actor, params, body, ipHash }) => {
  await brandWriteRate(actor, ipHash)
  return updateEvent(params.id ?? "", params.eventId ?? "", body, ipHash)
})

export const DELETE = route({ auth: "brand", permission: "locations.manage" }, async ({ actor, params, ipHash }) => {
  await brandWriteRate(actor, ipHash)
  return deleteEvent(params.id ?? "", params.eventId ?? "", ipHash)
})
