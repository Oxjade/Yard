import { connection, type NextRequest } from "next/server"
import { z } from "zod"
import { getEnv } from "@/server/env"
import { route } from "@/server/http/route"
import { clearTestData, previewTestData } from "@/server/signals/test-data"

/**
 * GET|DELETE /api/dev/signals/test-data?actorPrefix=u_t_…[&mediaIds=a,b][&reportIds=a,b][&dangling=1]
 * The F2 kit's restore step: removes the conversations, media, reports, notifications, abuse rows
 * and kit place its test shoppers or a demo account left behind for the kit, so demo
 * accounts see only seeded sample data. GET lists what DELETE would remove. See
 * src/server/signals/test-data.ts for the exact selection.
 * Development only (404 in production); admin cookie with charts.review, like /api/dev/signals,
 * plus messages.moderate when the selection holds reports or `dangling=1`. Scoped to test data:
 * named media and reports count only when they're the kit's own. A DELETE that removes anything
 * writes the audit row dev.test_data_cleared with the counts.
 * Every option is listed in `query` (strict): an unknown key is a 400.
 */
const query = z
  .object({
    actorPrefix: z.string().regex(/^u_t_[a-z0-9_]*$/, "Only test accounts (u_t_…) can be cleared."),
    mediaIds: z
      .string()
      .max(2000)
      .regex(/^[A-Za-z0-9_-]+(,[A-Za-z0-9_-]+){0,19}$/, "Up to 20 media ids, comma-separated.")
      .optional(),
    reportIds: z
      .string()
      .max(2000)
      .regex(/^[A-Za-z0-9_-]+(,[A-Za-z0-9_-]+){0,19}$/, "Up to 20 report ids, comma-separated.")
      .optional(),
    dangling: z.enum(["0", "1"]).default("0"),
  })
  .strict()

const opts = (q: z.infer<typeof query>) => ({ mediaIds: q.mediaIds?.split(",") ?? [], reportIds: q.reportIds?.split(",") ?? [], dangling: q.dangling === "1" })

const getHandler = route({ auth: "admin", permission: "charts.review", query }, async ({ actor, query: q }) => previewTestData(actor, q.actorPrefix, opts(q)))
const deleteHandler = route({ auth: "admin", permission: "charts.review", query }, async ({ actor, query: q }) => clearTestData(actor, q.actorPrefix, opts(q)))

const devOnly = (h: (req: NextRequest, ctx: { params: Promise<Record<string, string | string[]>> }) => Promise<Response>) => async (req: NextRequest, ctx: { params: Promise<Record<string, string | string[]>> }) => {
  await connection()
  if (!getEnv().dev) return Response.json({ error: { code: "not_found", message: "Not found." } }, { status: 404 })
  return h(req, ctx)
}

export const GET = devOnly(getHandler)
export const DELETE = devOnly(deleteHandler)
