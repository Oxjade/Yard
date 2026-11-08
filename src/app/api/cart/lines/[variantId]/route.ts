import { z } from "zod"
import { isSafeId } from "@/lib/api/contracts/common"
import { MAX_QTY, removeLine, resolveOwner, setLine } from "@/server/cart"
import { notFound } from "@/server/http/errors"
import { noContent, route } from "@/server/http/route"

const setBody = z.object({ qty: z.number().int().min(0).max(MAX_QTY) }).strict()

/** PATCH /api/cart/lines/{variantId} { qty } (public): sets the quantity; 0 removes the line. */
export const PATCH = route(
  { auth: "public", body: setBody, maxBody: 1024, rate: { key: "cart.write", limit: 60, windowSec: 60, anonGlobal: 3000 } },
  async ({ params, body }) => {
    if (!isSafeId(params.variantId)) throw notFound()
    const owner = await resolveOwner({ create: false })
    if (!owner) throw notFound("That piece isn't in your cart.")
    await setLine(owner, params.variantId, body.qty)
    return { ok: true }
  },
)

/** DELETE /api/cart/lines/{variantId} (public). */
export const DELETE = route({ auth: "public", rate: { key: "cart.write", limit: 60, windowSec: 60, anonGlobal: 3000 } }, async ({ params }) => {
  if (!isSafeId(params.variantId)) throw notFound()
  const owner = await resolveOwner({ create: false })
  if (owner) await removeLine(owner, params.variantId)
  return noContent()
})
