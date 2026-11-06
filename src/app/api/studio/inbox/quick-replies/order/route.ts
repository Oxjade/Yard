import { quickReplyOrderBody } from "@/lib/api/contracts/inbox"
import { route } from "@/server/http/route"
import { reorderQuickReplies } from "@/server/inbox/service"

/** PUT /api/studio/inbox/quick-replies/order { ids } (inbox.manage): exactly the brand's own ids, in the new order. */
export const PUT = route({ auth: "brand", permission: "inbox.manage", body: quickReplyOrderBody, maxBody: 4096, rate: { key: "studio.qr.write", limit: 60, windowSec: 60 } }, async ({ actor, body }) => ({ items: await reorderQuickReplies(actor, body.ids) }))
