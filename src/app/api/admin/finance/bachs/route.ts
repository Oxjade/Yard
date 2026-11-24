import { route } from "@/server/http/route"
import { assertAdminFinance } from "@/server/ledger/access"
import { bachsAdminView } from "@/server/payments/bachs-admin"

/**
 * GET /api/admin/finance/bachs: Yard's Bachs account as Bachs reports it (READ-ONLY): connection,
 * live balances against the ledger, recent payments, refunds, disputes and payouts, and webhook
 * health. Owner and Finance roles only. Bachs answers are cached for a minute per server; a Bachs
 * outage shows per section and never fails the request. No money-moving action exists here.
 */
export const GET = route({ rate: { key: "finance.read", limit: 240, windowSec: 60 }, auth: "admin", permission: "any_admin", cache: "no-store" }, async ({ actor }) => {
  assertAdminFinance(actor)
  return bachsAdminView(actor.role)
})
