import { watchCheckBody } from "@/lib/api/contracts/imports"
import { checkWatchNow } from "@/server/catalog/importer/watch"
import { route } from "@/server/http/route"

/**
 * POST /api/admin/brand-watch/check { brandId, resume? } (catalog.propose) → the watch, checking:
 * "Check now" (and Resume for a watch that paused itself). The check runs in the background; poll
 * GET /api/admin/brand-watch. 6 an hour per brand. Audited catalog.watch_checked / watch_resumed.
 */
export const POST = route({ auth: "admin", permission: "catalog.propose", body: watchCheckBody, rate: { key: "admin.brand_watch.check", limit: 30, windowSec: 3600 } }, async ({ actor, body, ipHash }) => checkWatchNow(actor, body, ipHash))
