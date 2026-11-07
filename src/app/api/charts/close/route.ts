import { connection, type NextRequest } from "next/server"
import { z } from "zod"
import { writeAudit } from "@/server/audit"
import { closeEditions } from "@/server/charts"
import { withTx } from "@/server/db"
import { getEnv } from "@/server/env"
import { route } from "@/server/http/route"

/**
 * POST /api/charts/close (development only; 404 in production): runs the 00:00 UTC edition close
 * now, so the close, its catch-up and the chart_movement notifications can be checked without
 * waiting for midnight. `?reclose=1` recomputes yesterday's finals even when they exist; it sends
 * movement notices again only with `&notify=1` (a notice upsert marks it unread in brand inboxes),
 * and then also takes back that edition's notices the rule doesn't give. Admin cookie with
 * charts.review, 6 an hour per admin. The close and its audit row commit together: the close does
 * no network or file I/O, so it can run inside the transaction.
 */
const handler = route(
  {
    auth: "admin",
    permission: "charts.review",
    query: z.object({ reclose: z.enum(["1"]).optional(), notify: z.enum(["1"]).optional() }).strict(),
    rate: { key: "charts.close", limit: 6, windowSec: 3600 },
  },
  async ({ actor, query }) =>
    withTx(async () => {
      const r = await closeEditions(Date.now(), { reclose: query.reclose === "1", notify: query.notify === "1" })
      await writeAudit({
        actor: { kind: "admin", id: actor.userId, name: actor.name, role: actor.role },
        action: "charts.recomputed",
        target: "Charts editions",
        subjectType: "charts",
        subjectId: "editions",
        meta: { snapshots: r.snapshots, notified: r.notified, reclose: query.reclose === "1" ? "yes" : "no" },
      })
      return r
    }),
)

export async function POST(req: NextRequest, ctx: { params: Promise<Record<string, string | string[]>> }) {
  await connection()
  if (!getEnv().dev) return Response.json({ error: { code: "not_found", message: "Not found." } }, { status: 404 })
  return handler(req, ctx)
}
