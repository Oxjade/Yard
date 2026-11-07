import { route } from "@/server/http/route"
import { unreadBrand } from "@/server/inbox/service"

/** GET /api/studio/inbox/unread → { conversations }: the brand side's unread count (the Unread tab). */
export const GET = route({ auth: "brand", permission: "inbox.read", rate: { key: "studio.inbox.unread", limit: 120, windowSec: 60 } }, async ({ actor }) => ({ conversations: await unreadBrand(actor.brandId) }))
