import { studioBlockBody } from "@/lib/api/contracts/inbox"
import { route } from "@/server/http/route"
import { studioBlock } from "@/server/inbox/service"

const opts = { auth: "brand", permission: "inbox.manage", body: studioBlockBody, maxBody: 512, rate: { key: "studio.inbox.block", limit: 30, windowSec: 60 } } as const

/** POST /api/studio/inbox/blocks { userId }: only a shopper who has a conversation with the active brand; anyone else is 404 (§5.3). */
export const POST = route(opts, async ({ actor, body, ipHash }) => studioBlock(actor, body.userId, true, ipHash))

/** DELETE /api/studio/inbox/blocks { userId }: unblock. */
export const DELETE = route(opts, async ({ actor, body, ipHash }) => studioBlock(actor, body.userId, false, ipHash))
