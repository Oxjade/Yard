import { z } from "zod"
import { CLIENT_SIGNAL_KINDS } from "./enums"

/**
 * POST /api/signals (F2, §6.3): client kinds only (order_placed, order_cancelled and
 * message_started are 400). The server resolves the brand: from productId (product_view,
 * wishlist_*) or dropId (reminder_*) with the catalogue; follow, unfollow and storefront_view
 * name a brandId that must exist; post_open names a published postId (or its brandId).
 * follow, unfollow and the wishlist and reminder kinds need a shopper session (401 otherwise).
 */
export const signalBody = z
  .object({
    kind: z.enum(CLIENT_SIGNAL_KINDS),
    productId: z.string().max(80).optional(),
    dropId: z.string().max(80).optional(),
    brandId: z.string().max(80).optional(),
    postId: z.string().max(80).optional(),
  })
  .strict()
export type SignalBody = z.infer<typeof signalBody>

export const signalVerdict = z.enum(["counted", "deduped", "excluded_self", "excluded_restricted", "excluded_fraud", "excluded_anon"])
/** 200 { verdict } when stored; 204 (no body) when the caller is over its signal rate limit. */
export const signalResult = z.object({ verdict: signalVerdict })

/** GET /api/dev/signals?actor=|actorPrefix= (dev only, charts.review). */
export const devSignalRow = z.object({ seq: z.number(), kind: z.string(), brandId: z.string(), actorId: z.string(), verdict: z.string(), day: z.string(), ipHash: z.string().nullable(), createdAt: z.string() })
export const devSignalsResult = z.object({
  items: z.array(devSignalRow),
  state: z.object({ follows: z.array(z.object({ userId: z.string(), brandId: z.string() })), wishlist: z.array(z.object({ userId: z.string(), productId: z.string() })), reminders: z.array(z.object({ userId: z.string(), dropId: z.string() })) }),
})
/** DELETE /api/dev/signals?actorPrefix=u_t_… → what was cleared. */
export const devSignalsCleared = z.object({ events: z.number(), follows: z.number(), wishlist: z.number(), reminders: z.number(), windows: z.number() })
