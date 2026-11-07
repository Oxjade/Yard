import { shopperBlockBody } from "@/lib/api/contracts/inbox"
import { route } from "@/server/http/route"
import { shopperBlock } from "@/server/inbox/service"

const opts = { auth: "shopper", body: shopperBlockBody, maxBody: 512, rate: { key: "inbox.block", limit: 30, windowSec: 60 } } as const

/** POST /api/inbox/blocks { brandId }: stop a brand messaging you (§5.3). */
export const POST = route(opts, async ({ actor, body }) => shopperBlock(actor, body.brandId, true))

/** DELETE /api/inbox/blocks { brandId }: unblock. */
export const DELETE = route(opts, async ({ actor, body }) => shopperBlock(actor, body.brandId, false))
