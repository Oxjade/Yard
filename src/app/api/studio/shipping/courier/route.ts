import { courierSettingsBody } from "@/lib/api/contracts/shipping"
import { route } from "@/server/http/route"
import { saveCourierSettings, studioCourierSettings } from "@/server/shipping/courier-settings"

/** GET /api/studio/shipping/courier (any member): the courier pickup address, default parcel and whether shoppers get live courier rates (docs/SHIPPING.md). */
export const GET = route({ auth: "brand", permission: "any_member", rate: { key: "studio.courier.read", limit: 60, windowSec: 60 } }, async ({ actor }) => studioCourierSettings(actor))

/**
 * PUT /api/studio/shipping/courier (shipping.manage): saves the pickup address and default parcel.
 * With a courier connected, the address is validated with it first (a refusal is a 400 on
 * `address`; the provider being down saves it unverified with a notice). 10 a minute per member,
 * since each save may call the provider.
 */
export const PUT = route(
  { auth: "brand", permission: "shipping.manage", body: courierSettingsBody, rate: { key: "studio.courier.save", limit: 10, windowSec: 60 } },
  async ({ actor, body, ipHash }) => saveCourierSettings(actor, body, ipHash),
)
