"use client"

import { useMemo } from "react"
import { useMirrorServerStatuses } from "@/components/admin/trust/status-sync"
import { adminKeys, listOnboardingApplications } from "@/lib/api/admin"
import type { OnboardingApplicationDto } from "@/lib/api/contracts/admin"
import { useApi } from "@/lib/api/use-api"
import type { BrandApplication, BrandReviewStatus } from "@/lib/data/admin"
import { canAdmin } from "@/lib/permissions"
import { useServerSession } from "@/lib/session/use-server-session"
import { useAdmin } from "@/lib/stores/admin"

/**
 * A submitted Studio application in the Brands queue. Identity checks haven't started at this
 * stage, so the row says that rather than copying a sample KYC state.
 */
export function fromOnboardingApplication(o: OnboardingApplicationDto): BrandApplication {
  const brand = o.data.brand
  const business = o.data.business
  const product = o.data.product
  const payments = o.data.payments
  const payout = payments?.accountLast4 ? `Payout account ending ${payments.accountLast4}.` : "Payout details missing."
  return {
    id: o.id,
    brandName: brand?.name?.trim() || "Brand application",
    handle: brand?.handle ?? "",
    country: business?.country ?? "—",
    category: brand?.category ?? "—",
    submittedAt: o.submittedAt ?? o.updatedAt,
    status: "pending_review",
    kyc: "not_started",
    risk: "medium",
    notes: `Submitted from Brand Studio onboarding. ${product?.name ? `First product: ${product.name}. ` : ""}${payout}`,
    products: product ? 1 : 0,
    brandId: o.brandId ?? undefined,
    onboardingId: o.id,
    application: o.data,
  }
}

/**
 * Every brand application the Control Center shows: submitted Studio applications from Yard's
 * server (each in place of a sample row for the same brand), then this browser's sample rows.
 * A live row takes its brand's server status, so a brand suspended or restricted while its
 * application waits shows (and is acted on) as such. The Brands page, the sidebar badge, the
 * palette and the Overview all read this, so their counts agree.
 */
export function useBrandApplications() {
  const localApplications = useAdmin((s) => s.applications)
  const admin = useServerSession((s) => s.admin)
  const canReviewApplications = !!admin && canAdmin(admin.role, "brands.restrict")
  const onboarding = useApi(canReviewApplications ? adminKeys.onboardings : null, listOnboardingApplications, { refreshInterval: 60_000 })
  const merged = useMemo(() => {
    const live = onboarding.data?.onboardings.map(fromOnboardingApplication) ?? []
    const liveBrands = new Set(live.flatMap((a) => (a.brandId ? [a.brandId] : [])))
    return [...live, ...localApplications.filter((a) => !a.brandId || !liveBrands.has(a.brandId))]
  }, [onboarding.data, localApplications])
  const ids = useMemo(() => merged.flatMap((a) => (a.brandId ? [a.brandId] : [])), [merged])
  const { statuses, reinstateTo } = useMirrorServerStatuses("brand", ids)
  const applications = useMemo(
    () => merged.map((a) => (a.onboardingId && a.brandId && statuses?.[a.brandId] && statuses[a.brandId] !== a.status ? { ...a, status: statuses[a.brandId] as BrandReviewStatus } : a)),
    [merged, statuses],
  )
  return { applications, onboarding, canReviewApplications, reinstateTo }
}
