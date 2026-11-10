"use client"

import { api } from "@/lib/api/client"
import { useApi } from "@/lib/api/use-api"
import { canAdminFinance } from "@/lib/permissions"
import { useServerSession } from "@/lib/session/use-server-session"

type Overview = { payoutQueue: { status: string; currency: string; n: number; total: number }[] }

/**
 * Finance for the shell badge, the palette and the Overview (rule 2). A real (non-demo) admin's
 * Finance and Orders read the server, so the sample payouts and refunds in the browser store must
 * not drive their counts or actions. `live` says so; `payoutsToDecide` is the server's count of
 * payouts awaiting a first or second approval, for the roles the finance service answers. It shares
 * the Finance overview's request (same key), so it costs nothing extra on that page.
 */
export function useLiveMoney() {
  const status = useServerSession((session) => session.status)
  const admin = useServerSession((session) => session.admin)
  const live = !!admin && !admin.demo
  const finance = live && canAdminFinance(admin.role)
  const overview = useApi<Overview>(finance ? "admin.finance.overview" : null, () => api<Overview>("/api/admin/finance/overview"), { keepPrevious: false })
  const payoutsToDecide = overview.data ? overview.data.payoutQueue.filter((row) => row.status === "requested" || row.status === "awaiting_second_approval").reduce((sum, row) => sum + row.n, 0) : undefined
  return { ready: status !== "loading", live, finance, payoutsToDecide }
}
