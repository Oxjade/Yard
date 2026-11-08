import { z } from "zod"
import { route } from "@/server/http/route"
import { idParam } from "@/server/catalog/params"
import { listMovements } from "@/server/catalog/stock"

/** GET /api/studio/catalog/variants/{id}/movements (any member): the variant's stock movement log, newest first. */
export const GET = route(
  { auth: "brand", permission: "any_member", query: z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }), rate: { key: "studio.catalog.read", limit: 240, windowSec: 60 } },
  async ({ actor, params, query }) => listMovements(actor, idParam(params, "id"), query.limit),
)
