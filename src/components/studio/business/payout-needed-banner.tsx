"use client"

import Link from "next/link"
import { BankIcon } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { surfaceClass } from "@/components/dashboard/insight/insight-panel"
import type { PayoutSummaryDto } from "@/lib/api/contracts/payouts"
import { payoutNeededBanner } from "@/lib/payout-needed"
import { cn } from "@/lib/utils"

/**
 * Studio Overview and Payouts: "You have ₦X waiting. Add your payout account to get paid." while the
 * brand has earnings and no payout account (src/lib/payout-needed.ts). Reads the payouts summary the
 * page already has (GET /api/studio/payouts), so it costs no request of its own. Nothing otherwise.
 */
export function PayoutNeededBanner({ summary, role, className }: { summary: PayoutSummaryDto | null | undefined; role?: string; className?: string }) {
  const banner = payoutNeededBanner(summary, role)
  if (!banner) return null
  return (
    <section role="status" aria-label="Payout account needed" className={cn(surfaceClass, "flex flex-col gap-3 border-purple p-4 sm:flex-row sm:items-center", className)}>
      <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-purple/20 text-violet">
        <BankIcon className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-ink">{banner.title}</span>
        <span className="mt-0.5 block text-xs text-ink-2">{banner.body}</span>
      </span>
      {banner.action ? (
        <Button asChild variant="secondary" size="sm" className="h-9 shrink-0 rounded-full px-4">
          <Link href={banner.action.href}>{banner.action.label}</Link>
        </Button>
      ) : null}
    </section>
  )
}
