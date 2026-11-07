import { reportBody } from "@/lib/api/contracts/reports"
import { json, route } from "@/server/http/route"
import { createReport } from "@/server/reports"

/**
 * POST /api/reports?as=shopper|brand (§5.3). `as` names the session that reports; only that
 * cookie is read and recorded. 10 filed reports a day per reporter (and 5 attempts a minute); one open report
 * per subject per reporter (409). Admins whose role holds the queue's view permission are
 * notified with the reason and subject type only.
 */
export const POST = route(
  {
    auth: "multi",
    as: ["shopper", "brand"],
    body: reportBody,
    maxBody: 4096,
    // 5 attempts a minute here; the 10-a-day cap counts filed reports only (createReport, DAILY_REPORTS).
    rate: { key: "reports", limit: 5, windowSec: 60 },
  },
  async ({ actor, body }) => json({ report: await createReport(actor, body) }, 201),
)
