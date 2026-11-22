import { brandRemovalBody } from "@/lib/api/contracts/brand-removal"
import { removeBrand } from "@/server/catalog/brand-removal"
import { route } from "@/server/http/route"

/**
 * DELETE /api/admin/brands/{id} { mode, confirmHandle, reason } (brands.delete, owner admins;
 * re-auth within 5 minutes: 403 fields.reauth = "required"). Erases the brand (mode "delete") or
 * closes it (mode "close"), whichever GET …/removal said; a brand whose records changed since is a
 * 409. `confirmHandle` must be the brand's handle (400 otherwise). One audit row (brand.deleted /
 * brand.closed) with the counts. → { mode, brand, removed, filesRemoved, sessionsEnded }.
 */
export const DELETE = route(
  { auth: "admin", permission: "brands.delete", body: brandRemovalBody, maxBody: 4 * 1024, rate: { key: "admin.brands.remove", limit: 20, windowSec: 600, daily: 100 } },
  async ({ actor, params, body, ipHash }) => removeBrand(actor, params.id, body, { ipHash }),
)
