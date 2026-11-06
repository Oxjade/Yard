import { z } from "zod"
import { CLIENT_SIGNAL_KINDS } from "./enums"

/** POST /api/signals (F2, §6.3): client kinds only; brand_id is resolved by the server. Draft by F1. */
export const signalBody = z
  .object({
    kind: z.enum(CLIENT_SIGNAL_KINDS),
    productId: z.string().max(80).optional(),
    dropId: z.string().max(80).optional(),
    brandId: z.string().max(80).optional(),
  })
  .strict()
export type SignalBody = z.infer<typeof signalBody>

/** GET /api/dev/signals?actor= (dev only). */
export const devSignalRow = z.object({ seq: z.number(), kind: z.string(), brandId: z.string(), verdict: z.string(), day: z.string(), ipHash: z.string().nullable() })
export const devSignalsResult = z.object({ items: z.array(devSignalRow) })
