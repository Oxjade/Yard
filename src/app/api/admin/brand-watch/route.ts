import { importListQuery, watchSetBody } from "@/lib/api/contracts/imports"
import { getAdminWatch, setWatch } from "@/server/catalog/importer/watch"
import { route } from "@/server/http/route"

/**
 * GET /api/admin/brand-watch?brandId= (catalog.propose; + brands.founding for an unclaimed
 * founding brand) → { brand, watch, pieces, changes, seen }: the brand's watched website, its "New
 * from their website" pieces and "Changes on their site" (docs/IMPORTER.md › Watching a website).
 */
export const GET = route({ auth: "admin", permission: "catalog.propose", query: importListQuery, rate: { key: "admin.brand_watch.read", limit: 240, windowSec: 60 } }, async ({ actor, query }) => getAdminWatch(actor, query.brandId))

/**
 * PUT /api/admin/brand-watch { brandId, enabled, importId? } → the same: turns "Keep watching
 * {site} for new pieces" on (the import's address and platform; the latest scan when no import is
 * named) or off. One website per brand. Audited catalog.watch_started / catalog.watch_stopped.
 */
export const PUT = route({ auth: "admin", permission: "catalog.propose", body: watchSetBody, rate: { key: "admin.brand_watch.set", limit: 30, windowSec: 3600 } }, async ({ actor, body, ipHash }) => setWatch(actor, body, ipHash))
