import { route } from "@/server/http/route"
import { assertBrandFinanceView } from "@/server/ledger/access"
import { statement } from "@/server/ledger/read"
import { statementQuery } from "@/server/ledger/schemas"

/** GET /api/studio/payouts/statement?currency&account&before&limit: the brand's ledger lines, newest first (page with `before` = the returned nextBefore). */
export const GET = route({ rate: { key: "payouts.statement", limit: 30, windowSec: 60 }, auth: "brand", permission: "any_member", query: statementQuery }, async ({ actor, query }) => {
  assertBrandFinanceView(actor)
  const lines = await statement({ ownerKind: "brand", ownerId: actor.brandId, currency: query.currency, accountKind: query.account, before: query.before, limit: query.limit })
  return { entries: lines, nextBefore: lines.length ? lines[lines.length - 1].id : null }
})
