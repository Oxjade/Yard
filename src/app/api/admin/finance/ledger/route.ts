import { route } from "@/server/http/route"
import { assertAdminFinance } from "@/server/ledger/access"
import { PLATFORM } from "@/server/ledger/core"
import { statement } from "@/server/ledger/read"
import { ledgerQuery } from "@/server/ledger/schemas"

/** GET /api/admin/finance/ledger?brandId&currency&account&before&limit: journal lines for a brand, or the platform accounts without brandId. */
export const GET = route({ auth: "admin", permission: "any_admin", query: ledgerQuery }, async ({ actor, query }) => {
  assertAdminFinance(actor)
  const entries = await statement({
    ownerKind: query.brandId ? "brand" : "platform",
    ownerId: query.brandId ?? PLATFORM,
    currency: query.currency,
    accountKind: query.account,
    before: query.before,
    limit: query.limit,
  })
  return { entries, nextBefore: entries.length ? entries[entries.length - 1].id : null }
})
