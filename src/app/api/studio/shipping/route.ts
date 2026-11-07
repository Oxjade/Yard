import { shippingProfileBody } from "@/lib/api/contracts/shipping"
import { route } from "@/server/http/route"
import { saveShipping, studioShipping } from "@/server/shipping/profile"

/** GET /api/studio/shipping (any member: inbox.read; 60 a minute per member): the active brand's profile, zones, methods, rates, closures and origin holidays. */
export const GET = route({ auth: "brand", permission: "inbox.read", rate: { key: "studio.shipping.read", limit: 60, windowSec: 60 } }, async ({ actor }) => studioShipping(actor))

/**
 * PUT /api/studio/shipping (shipping.manage). Validates handling, transit, zones, tiers and the
 * cutoff; checks the pickup point with assertOwned (this brand's own published store or showroom);
 * replaces every zone, method, rate and closure with fresh ids (ids in the body are ignored);
 * sets updated_by and writes audit.
 */
export const PUT = route(
  { auth: "brand", permission: "shipping.manage", body: shippingProfileBody, rate: { key: "studio.shipping.save", limit: 30, windowSec: 60 } },
  async ({ actor, body, ipHash }) => saveShipping(actor, body, ipHash),
)
