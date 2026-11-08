import { route } from "@/server/http/route"
import { assertBrandFinanceView } from "@/server/ledger/access"
import { statement } from "@/server/ledger/read"
import { statementQuery } from "@/server/ledger/schemas"

/** GET /api/studio/payouts/statement?currency&account&before&limit: the brand's ledger lines, newest first (page with `before` = last `at`). */
export const GET = route({ auth: "brand", permission: "any_member", query: statementQuery }, async ({ actor, query }) => {
  assertBrandFinanceView(actor)
  const entries = await statement({ ownerKind: "brand", ownerId: actor.brandId, currency: query.currency, accountKind: query.account, before: query.before, limit: query.limit })
  return { entries, nextBefore: entries.length ? entries[entries.length - 1].at : null }
})
