import { eq } from "drizzle-orm"
import { db } from "@/server/db"
import { brands } from "@/server/db/schema"
import { notFound } from "@/server/http/errors"
import { route } from "@/server/http/route"
import { assertAdminFinance } from "@/server/ledger/access"
import { updateBrandFinanceSettings } from "@/server/ledger/payouts"
import { brandPayoutSummary } from "@/server/ledger/read"
import { brandSettingsBody } from "@/server/ledger/schemas"

/** GET /api/admin/finance/brands/{brandId}: a brand's balances, rules (tier, reserve, commission, hold), masked account and payouts. */
export const GET = route({ auth: "admin", permission: "any_admin" }, async ({ actor, params }) => {
  assertAdminFinance(actor)
  const d = await db()
  const [b] = await d.select({ id: brands.id, name: brands.name, currency: brands.currency }).from(brands).where(eq(brands.id, params.brandId))
  if (!b) throw notFound("We couldn't find that brand.")
  return { brand: b, ...(await brandPayoutSummary(b.id, b.currency)) }
})

/** PUT /api/admin/finance/brands/{brandId} { tierOverride?, commissionBpsOverride?, payoutsOnHold?, holdReason? }: finance settings (commission changes need re-auth). */
export const PUT = route(
  { auth: "admin", permission: "any_admin", body: brandSettingsBody, rate: { key: "finance.brand_settings", limit: 60, windowSec: 3600 } },
  async ({ actor, params, body, ipHash }) => ({ settings: await updateBrandFinanceSettings(actor, params.brandId, body, ipHash) }),
)
