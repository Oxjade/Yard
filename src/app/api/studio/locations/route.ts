import { locationWriteBody } from "@/lib/api/contracts/around"
import { brandWriteRate, createLocation, listLocations } from "@/server/around/service"
import { json, route } from "@/server/http/route"

/** GET /api/studio/locations: the active brand's places, drafts included (§6.4). */
export const GET = route({ auth: "brand", permission: "any_member" }, async ({ actor }) => {
  const b = actor.brand
  return {
    locations: await listLocations(actor),
    brand: { id: b.id, name: b.name, verified: b.reviewStatus === "verified", reviewStatus: b.reviewStatus, city: b.city, citySlug: b.citySlug, country: b.country, timeZone: b.timeZone },
  }
})

/** POST /api/studio/locations: add a place (`locations.manage`). */
export const POST = route({ auth: "brand", permission: "locations.manage", body: locationWriteBody }, async ({ actor, body, ipHash }) => {
  await brandWriteRate(actor, ipHash)
  return json(await createLocation(actor, body, ipHash), 201)
})
