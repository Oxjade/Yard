import { bulkVisibilityBody } from "@/lib/api/contracts/social"
import { route } from "@/server/http/route"
import { bulkVisibility } from "@/server/social/posts"

/** POST …/posts/bulk (content.publish) { ids, visibility }: Content Studio's bulk Show / Hide, in one transaction. */
export const POST = route({ rate: { key: "studio.social.bulk", limit: 20, windowSec: 60 }, auth: "brand", permission: "content.publish", body: bulkVisibilityBody }, async ({ actor, body }) => ({ posts: await bulkVisibility(actor, body.ids, body.visibility) }))
