import { quickReplyBody } from "@/lib/api/contracts/inbox"
import { json, route } from "@/server/http/route"
import { createQuickReply, listQuickReplies } from "@/server/inbox/service"

/** GET /api/studio/inbox/quick-replies: the active brand's saved replies, in order. */
export const GET = route({ auth: "brand", permission: "inbox.read" }, async ({ actor }) => ({ items: await listQuickReplies(actor.brandId) }))

/** POST (inbox.manage, at most 30 per brand). */
export const POST = route({ auth: "brand", permission: "inbox.manage", body: quickReplyBody, maxBody: 4096, rate: { key: "studio.qr.write", limit: 60, windowSec: 60 } }, async ({ actor, body }) => json({ item: await createQuickReply(actor, body) }, 201))
