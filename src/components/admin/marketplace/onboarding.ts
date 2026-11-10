import type { OnboardingApplicationDto } from "@/lib/api/contracts/admin"
import type { BrandApplication } from "@/lib/data/admin"

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
  }
}
