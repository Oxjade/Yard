import { z } from "zod"
import { safeId } from "@/lib/api/contracts/common"
import { addLine, MAX_QTY, resolveOwner } from "@/server/cart"
import { json, route } from "@/server/http/route"

const addBody = z.object({ variantId: safeId(), qty: z.number().int().min(1).max(MAX_QTY).default(1) }).strict()

/**
 * POST /api/cart/lines { variantId, qty } (public). Adds to the line (creating the cart, and for an
 * anonymous visitor the yard_cart cookie, on first add). 409 when CATALOG has fewer available.
 */
export const POST = route(
  { auth: "public", body: addBody, maxBody: 2048, rate: { key: "cart.write", limit: 60, windowSec: 60, anonGlobal: 3000 } },
  async ({ body }) => {
    const owner = (await resolveOwner({ create: true }))!
    await addLine(owner, body.variantId, body.qty)
    return json({ ok: true }, 201)
  },
)
