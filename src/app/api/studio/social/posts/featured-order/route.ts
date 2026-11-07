import { featuredOrderBody } from "@/lib/api/contracts/social"
import { route } from "@/server/http/route"
import { setFeaturedOrder } from "@/server/social/posts"

/** PUT …/posts/featured-order (content.publish) { ids }: each a featured post of the active brand. */
export const PUT = route({ auth: "brand", permission: "content.publish", body: featuredOrderBody }, async ({ actor, body }) => setFeaturedOrder(actor, body.ids))
