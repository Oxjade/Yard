import type { CurrencyCode } from "@/config/markets"
import type { OnboardingApplicationDto } from "@/lib/api/contracts/admin"
import { convert } from "@/lib/money"
import { brands } from "./brands"
import { campaigns } from "./ads"
import { merchantOrders, sampleReturnRequest, shoppers } from "./orders"
import { products } from "./products"
import { daysAgo, hash, randInt, rand } from "./seed"

/**
 * Internal Admin Control Center data for development. Financial records are append-only:
 * the admin screens never edit a balance; adjustments are new ledger entries with an
 * actor, a reason and an approval.
 */

export type AdminRole = "owner" | "finance" | "trust_safety" | "support" | "ads_ops" | "engineering"
export const adminRoles: Record<AdminRole, { name: string; can: string[] }> = {
  owner: { name: "Owner", can: ["everything"] },
  finance: { name: "Finance", can: ["view finance", "approve payouts", "approve adjustments", "issue refunds"] },
  trust_safety: { name: "Trust & safety", can: ["review brands", "moderate products", "restrict accounts", "suspend brands"] },
  support: { name: "Support", can: ["view orders", "view customers", "request refunds"] },
  ads_ops: { name: "Ads operations", can: ["review campaigns", "manage placements", "edit pricing"] },
  engineering: { name: "Engineering", can: ["view health", "replay webhooks", "retry jobs"] },
}

export const adminUser = { id: "adm_1", name: "Kemi Ajayi", email: "kemi@yard.example", role: "owner" as AdminRole, mfa: true }

export const adminTeam = [
  adminUser,
  { id: "adm_2", name: "Daniel Okoro", email: "daniel@yard.example", role: "finance" as AdminRole, mfa: true },
  { id: "adm_3", name: "Aisha Bello", email: "aisha@yard.example", role: "trust_safety" as AdminRole, mfa: true },
  { id: "adm_4", name: "Sam Lee", email: "sam@yard.example", role: "ads_ops" as AdminRole, mfa: false },
  { id: "adm_5", name: "Ngozi Eze", email: "ngozi@yard.example", role: "support" as AdminRole, mfa: true },
  { id: "adm_6", name: "Lukas Brandt", email: "lukas@yard.example", role: "engineering" as AdminRole, mfa: true },
]

/* ---------- Brand review ---------- */

export type BrandReviewStatus = "pending_review" | "verified" | "restricted" | "suspended"

export type BrandApplication = {
  id: string
  brandName: string
  handle: string
  country: string
  category: string
  submittedAt: string
  status: BrandReviewStatus
  kyc: "not_started" | "submitted" | "verified" | "failed"
  risk: "low" | "medium" | "high"
  notes: string
  products: number
  brandId?: string
  onboardingId?: string
  /** The application was already approved: the brand is acted on by its status, not reviewed again. */
  reviewed?: boolean
  /** What a submitted Studio application says (brand, business, first product, payout), for the review sheet. */
  application?: OnboardingApplicationDto["data"]
}

export const brandApplications: BrandApplication[] = [
  ...brands.map((b) => ({
    id: `app_${b.handle}`,
    brandName: b.name,
    handle: b.handle,
    country: b.country,
    category: b.categories[0],
    submittedAt: b.joinedAt,
    status: (b.verified ? "verified" : "pending_review") as BrandReviewStatus,
    kyc: (b.verified ? "verified" : "submitted") as BrandApplication["kyc"],
    risk: (b.verified ? "low" : "medium") as BrandApplication["risk"],
    notes: b.verified ? "Identity and payout account verified." : "Payout account verified; business registration document under review.",
    products: products.filter((p) => p.brandId === b.id).length,
    brandId: b.id,
  })),
  { id: "app_eko_noir", brandName: "Eko Noir", handle: "eko-noir", country: "NG", category: "streetwear", submittedAt: daysAgo(1), status: "pending_review", kyc: "submitted", risk: "low", notes: "New streetwear label from Surulere. 6 products drafted.", products: 6 },
  { id: "app_salt_stone", brandName: "Salt & Stone Goods", handle: "salt-stone-goods", country: "GB", category: "home-lifestyle", submittedAt: daysAgo(2), status: "pending_review", kyc: "not_started", risk: "medium", notes: "Payout details missing.", products: 3 },
  { id: "app_luxe_replica", brandName: "Luxe Replica Hub", handle: "luxe-replica-hub", country: "US", category: "accessories", submittedAt: daysAgo(3), status: "restricted", kyc: "failed", risk: "high", notes: "Listings reference third-party trademarks. Identity check failed. Listings hidden pending appeal.", products: 22 },
  { id: "app_kaya", brandName: "Kaya Ceramics", handle: "kaya-ceramics", country: "KE", category: "home-lifestyle", submittedAt: daysAgo(4), status: "pending_review", kyc: "verified", risk: "low", notes: "Strong portfolio. Ready to approve.", products: 9 },
  { id: "app_flash", brandName: "Flash Kicks Resale", handle: "flash-kicks", country: "US", category: "sneakers", submittedAt: daysAgo(18), status: "suspended", kyc: "verified", risk: "high", notes: "Three chargebacks in 30 days and two counterfeit reports. Suspended by Aisha Bello.", products: 41 },
]

/* ---------- Users ---------- */

export type PlatformUser = { id: string; name: string; email: string; country: string; joinedAt: string; orders: number; status: "active" | "restricted" | "suspended"; reports: number; lastActive: string }

export const platformUsers: PlatformUser[] = shoppers.map((s, i) => ({
  id: s.id,
  name: s.name,
  email: s.email,
  country: s.country,
  joinedAt: daysAgo(randInt(`${s.id}-j`, 5, 300)),
  orders: merchantOrders.filter((o) => o.customerId === s.id).length,
  status: i === 7 ? "restricted" : i === 23 ? "suspended" : "active",
  reports: i === 7 ? 2 : i === 23 ? 4 : 0,
  lastActive: daysAgo(randInt(`${s.id}-a`, 0, 20)),
}))

/* ---------- Moderation ---------- */

export type ModerationItem = { id: string; productId?: string; title: string; brandName: string; reason: "counterfeit" | "prohibited" | "misleading" | "ip_complaint" | "auto_flag"; reportedBy: string; reportedAt: string; status: "open" | "removed" | "dismissed" | "escalated"; detail: string }

export const moderationQueue: ModerationItem[] = [
  { id: "mod_1", title: "“Designer-inspired” monogram belt", brandName: "Luxe Replica Hub", reason: "counterfeit", reportedBy: "Automated logo match", reportedAt: daysAgo(0), status: "open", detail: "Image matches a protected monogram with 94% confidence." },
  { id: "mod_2", title: "Air-style retro high (unbranded)", brandName: "Flash Kicks Resale", reason: "ip_complaint", reportedBy: "Rights holder notice", reportedAt: daysAgo(1), status: "escalated", detail: "Formal IP complaint received. Legal review requested." },
  { id: "mod_3", productId: "p_python_box_clutch", title: "Python Box Clutch", brandName: "Velvet Underpass", reason: "misleading", reportedBy: "Customer report", reportedAt: daysAgo(2), status: "open", detail: "Customer asked whether the clutch is real python. Listing says “python-embossed calf”. Likely fine." },
  { id: "mod_4", title: "CBD gummies", brandName: "Salt & Stone Goods", reason: "prohibited", reportedBy: "Automated category rules", reportedAt: daysAgo(2), status: "open", detail: "Restricted category in several shipping countries." },
  { id: "mod_5", productId: "p_restored_portable_tv", title: "Restored Portable TV", brandName: "Mute Objects", reason: "auto_flag", reportedBy: "Electrical safety rule", reportedAt: daysAgo(5), status: "dismissed", detail: "Seller supplied a PAT test certificate. Dismissed by Aisha Bello." },
  { id: "mod_6", title: "Box-logo hoodie", brandName: "Luxe Replica Hub", reason: "counterfeit", reportedBy: "Automated logo match", reportedAt: daysAgo(6), status: "removed", detail: "Removed. Brand restricted." },
]

/* ---------- Finance (append-only ledger views) ---------- */

export type Transaction = { id: string; reference: string; at: string; brandName: string; type: "charge" | "refund" | "payout" | "commission" | "adjustment" | "chargeback"; provider: "paystack" | "flutterwave" | "stripe"; amountUsd: number; status: "succeeded" | "pending" | "failed"; webhookVerified: boolean }

export const transactions: Transaction[] = merchantOrders.slice(0, 80).flatMap((o, i) => {
  const brand = brands.find((b) => b.id === o.brandId)!
  const provider = brand.country === "NG" || brand.country === "GH" ? "paystack" : brand.country === "KE" || brand.country === "ZA" ? "flutterwave" : "stripe"
  const usd = convert(o.total, o.currency, "USD")
  const charge: Transaction = { id: `tx_${o.id}`, reference: o.reference, at: o.placedAt, brandName: brand.name, type: "charge", provider, amountUsd: usd, status: i === 4 ? "failed" : "succeeded", webhookVerified: i !== 4 }
  const extra: Transaction[] = []
  if (o.status === "refunded") extra.push({ id: `tx_${o.id}_r`, reference: o.reference, at: o.placedAt, brandName: brand.name, type: "refund", provider, amountUsd: -usd, status: "succeeded", webhookVerified: true })
  extra.push({ id: `tx_${o.id}_c`, reference: o.reference, at: o.placedAt, brandName: brand.name, type: "commission", provider, amountUsd: convert(o.commission, o.currency, "USD"), status: "succeeded", webhookVerified: true })
  return [charge, ...extra]
})

/**
 * A brand payout. `amount` is what the brand is paid, in its own currency (minor units, the same
 * units as its orders); `amountUsd` is the same payout in USD cents for platform-wide totals.
 * A payout a brand requests keeps the exact amount it confirmed in `amount`.
 */
export type Payout = { id: string; brandName: string; brandId: string; amount: number; currency: CurrencyCode; amountUsd: number; scheduledFor: string; status: "scheduled" | "awaiting_approval" | "processing" | "paid" | "held"; method: string; holdReason?: string; orders: number }

export const payouts: Payout[] = brands.map((b, i) => {
  const orders = merchantOrders.filter((o) => o.brandId === b.id && o.status === "delivered")
  const gross = orders.reduce((s, o) => s + convert(o.subtotal - o.commission, o.currency, "USD"), 0)
  const status: Payout["status"] = i === 2 ? "awaiting_approval" : i === 5 ? "held" : i % 4 === 0 ? "paid" : i % 3 === 0 ? "processing" : "scheduled"
  const amountUsd = Math.round(gross / 3)
  return { id: `po_${b.handle}`, brandName: b.name, brandId: b.id, amount: convert(amountUsd, "USD", b.currency), currency: b.currency, amountUsd, scheduledFor: daysAgo(status === "paid" ? (i % 5) + 2 : -((i % 5) + 1)), status, method: b.country === "NG" ? "Paystack transfer" : b.country === "KE" ? "Flutterwave transfer" : "Bank transfer", holdReason: status === "held" ? "Open refund request exceeds reserve." : undefined, orders: orders.length }
})

/** A payout's amount in a given currency: the exact stored amount in the brand's own currency, else converted from USD. */
export function payoutAmountIn(p: Pick<Payout, "amount" | "currency" | "amountUsd">, currency: CurrencyCode) {
  return p.currency === currency && typeof p.amount === "number" ? p.amount : convert(p.amountUsd, "USD", currency)
}

export type Refund = { id: string; reference: string; brandName: string; customer: string; amountUsd: number; reason: string; requestedAt: string; status: "requested" | "approved" | "issued" | "declined"; idempotencyKey: string }

export const refunds: Refund[] = merchantOrders
  .filter((o) => o.status === "refund_requested" || o.status === "refunded")
  .slice(0, 14)
  .map((o) => ({
    id: `rf_${o.id}`,
    reference: o.reference,
    brandName: brands.find((b) => b.id === o.brandId)!.name,
    customer: shoppers.find((s) => s.id === o.customerId)?.name ?? "Customer",
    amountUsd: convert(o.total, o.currency, "USD"),
    // The same request Studio shows on the order.
    reason: sampleReturnRequest(o).reasonLabel,
    requestedAt: sampleReturnRequest(o).at,
    status: o.status === "refunded" ? "issued" : "requested",
    idempotencyKey: `rfnd_${hash(o.id).toString(36)}`,
  }))

export type Dispute = { id: string; reference: string; brandName: string; amountUsd: number; reason: string; openedAt: string; dueBy: string; stage: "needs_evidence" | "under_review" | "won" | "lost"; type: "chargeback" | "inquiry" }

export const disputes: Dispute[] = merchantOrders.slice(10, 15).map((o, i) => ({
  id: `dp_${o.id}`,
  reference: o.reference,
  brandName: brands.find((b) => b.id === o.brandId)!.name,
  amountUsd: convert(o.total, o.currency, "USD"),
  reason: ["Item not received", "Fraudulent", "Product unacceptable", "Duplicate charge", "Item not received"][i],
  openedAt: daysAgo(i * 3 + 1),
  dueBy: daysAgo(-(7 - i)),
  stage: (["needs_evidence", "under_review", "needs_evidence", "won", "lost"] as const)[i],
  type: i === 3 ? "inquiry" : "chargeback",
}))

export type ReconciliationRow = { provider: "paystack" | "flutterwave" | "stripe"; date: string; ledgerUsd: number; providerUsd: number; status: "matched" | "mismatch" | "pending" }

export const reconciliation: ReconciliationRow[] = (["paystack", "flutterwave", "stripe"] as const).flatMap((provider, pi) =>
  Array.from({ length: 5 }, (_, d) => {
    const ledger = randInt(`${provider}-${d}-l`, 120_000, 980_000)
    const mismatch = pi === 1 && d === 1
    return { provider, date: daysAgo(d + 1).slice(0, 10), ledgerUsd: ledger, providerUsd: mismatch ? ledger - 4_250 : ledger, status: d === 0 ? "pending" : mismatch ? "mismatch" : "matched" }
  }),
)

/* ---------- Health ---------- */

/**
 * One day of the public API's p95 latency (ms) and failed requests. Keyed by the date, so a day
 * reads the same in every period, and the API's current p95 is the latest day's.
 */
function apiDay(back: number) {
  const date = daysAgo(back).slice(0, 10)
  // Two days ago: the background-jobs incident that slowed the API too.
  const incident = back === 2
  return { date, latency: Math.round(150 + rand(`lat-${date}`) * 80 + (incident ? 120 : 0)), errors: Math.round(rand(`err-${date}`) * 30 + (incident ? 60 : 4)) }
}

export const healthServices = [
  { name: "API", status: "operational" as const, latencyP95: apiDay(0).latency, errorRate: 0.0012, uptime: 0.9996 },
  { name: "Database (primary)", status: "operational" as const, latencyP95: 9, errorRate: 0, uptime: 0.9999 },
  { name: "Search", status: "operational" as const, latencyP95: 41, errorRate: 0.0004, uptime: 0.9998 },
  { name: "Media storage", status: "operational" as const, latencyP95: 64, errorRate: 0.0001, uptime: 0.9999 },
  { name: "Background jobs", status: "degraded" as const, latencyP95: 1240, errorRate: 0.021, uptime: 0.998 },
  { name: "Payment webhooks", status: "operational" as const, latencyP95: 310, errorRate: 0.006, uptime: 0.9993 },
]

export const failedJobs = [
  { id: "job_8812", queue: "notifications", name: "drop-reminder:d_nf_04", attempts: 3, error: "Push provider timeout after 10s", failedAt: daysAgo(0) },
  { id: "job_8790", queue: "images", name: "resize:p_mo_2_leather", attempts: 5, error: "Source image exceeds 40MP limit", failedAt: daysAgo(0) },
  { id: "job_8741", queue: "analytics", name: "rollup:2026-11-04", attempts: 2, error: "Lock wait timeout", failedAt: daysAgo(1) },
]

export const webhookFailures = [
  { id: "wh_311", provider: "flutterwave", event: "charge.completed", receivedAt: daysAgo(0), reason: "Signature check failed (verif-hash mismatch)", replayable: false },
  { id: "wh_298", provider: "paystack", event: "transfer.success", receivedAt: daysAgo(1), reason: "Handler timeout; event stored, safe to replay (idempotent)", replayable: true },
]

/** The API's daily p95 latency and failed requests over the last `days` days, oldest first; the last day is the API's current p95. */
export function healthSeries(days = 14) {
  return Array.from({ length: days }, (_, i) => apiDay(days - 1 - i))
}

/* ---------- Security ---------- */

export type AuditEntry = { id: string; at: string; actor: string; role: AdminRole; action: string; target: string; reason?: string; ip: string; approvedBy?: string; /** The record the action was taken on (user, brand, payout…), so lookalike names never share history. */ subjectId?: string }

const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * Sample audit entries that name a sample record take it from the seed, so the log never vouches
 * for a payout or refund that isn't there. The payout approval is the one Finance shows as
 * processing (approved, transfer pending); the refund request is a shopper's request on a
 * Gridlock Supply order that support logged for them.
 */
const approvedPayout = payouts.find((p) => p.status === "processing") ?? payouts[0]
const supportRefund = refunds.find((r) => r.brandName === "Gridlock Supply" && r.status === "requested") ?? refunds[0]

const auditSeed: AuditEntry[] = [
  { id: "au_1", at: daysAgo(0), actor: "Aisha Bello", role: "trust_safety", action: "Removed listing", target: "Box-logo hoodie (Luxe Replica Hub)", reason: "Counterfeit — logo match and rights-holder notice", ip: "102.89.x.x" },
  { id: "au_2", at: daysAgo(0), actor: "Daniel Okoro", role: "finance", action: "Approved payout", target: `${approvedPayout.brandName}, ${dollars(approvedPayout.amountUsd)}`, reason: "Delivered orders match the provider's settlement report; no open disputes", ip: "102.89.x.x", subjectId: approvedPayout.id },
  // Still waiting for a second approver (adjustment adj_1 is pending), so nobody has approved it.
  { id: "au_3", at: "2026-11-04T10:12:00.000Z", actor: "Daniel Okoro", role: "finance", action: "Ledger adjustment requested", target: "Mute Objects, +$12.40", reason: "Shipping label refund from carrier", ip: "102.89.x.x", subjectId: "adj_1" },
  { id: "au_4", at: daysAgo(1), actor: "Sam Lee", role: "ads_ops", action: "Rejected campaign", target: "Gridlock — restock week", reason: "Creative uses a third-party logo", ip: "84.12.x.x" },
  { id: "au_5", at: daysAgo(2), actor: "Kemi Ajayi", role: "owner", action: "Changed ad pricing", target: "Sponsored brand: $14/day to $15/day", reason: "Quarterly rate review: the slot was fully booked for six weeks", ip: "102.89.x.x" },
  { id: "au_6", at: daysAgo(3), actor: "Aisha Bello", role: "trust_safety", action: "Suspended brand", target: "Flash Kicks Resale", reason: "Chargebacks and counterfeit reports", ip: "102.89.x.x", approvedBy: "Kemi Ajayi" },
  { id: "au_7", at: daysAgo(4), actor: "Lukas Brandt", role: "engineering", action: "Replayed webhook", target: "paystack transfer.success wh_270", reason: "Handler timeout; idempotent replay", ip: "91.64.x.x" },
  { id: "au_8", at: supportRefund.requestedAt, actor: "Ngozi Eze", role: "support", action: "Requested refund", target: `#${supportRefund.reference}, ${dollars(supportRefund.amountUsd)}`, reason: `Shopper contacted support: ${supportRefund.reason.toLowerCase()}`, ip: "102.89.x.x", subjectId: supportRefund.id },
]

/** Newest first, as the log reads and as new entries are added. */
export const auditLog: AuditEntry[] = auditSeed.sort((a, b) => b.at.localeCompare(a.at))

/* ---------- Overview figures ---------- */

export function platformOverview() {
  const gmvUsd = merchantOrders.filter((o) => o.status !== "cancelled").reduce((s, o) => s + convert(o.total, o.currency, "USD"), 0)
  const commissionUsd = merchantOrders.filter((o) => !["cancelled", "refunded"].includes(o.status)).reduce((s, o) => s + convert(o.commission, o.currency, "USD"), 0)
  const adRevenueUsd = campaigns.filter((c) => ["active", "completed"].includes(c.status)).reduce((s, c) => s + c.budget, 0)
  const charges = transactions.filter((t) => t.type === "charge")
  return {
    users: 18_420 + platformUsers.length,
    brands: brands.length,
    pendingBrands: brandApplications.filter((a) => a.status === "pending_review").length,
    products: products.length,
    gmvUsd,
    revenueUsd: commissionUsd + adRevenueUsd,
    commissionUsd,
    adRevenueUsd,
    ordersToday: merchantOrders.filter((o) => o.placedAt.slice(0, 10) === daysAgo(0).slice(0, 10)).length,
    paymentSuccess: charges.filter((t) => t.status === "succeeded").length / Math.max(1, charges.length),
    pendingPayoutsUsd: payouts.filter((p) => p.status !== "paid").reduce((s, p) => s + p.amountUsd, 0),
    refundRequests: refunds.filter((r) => r.status === "requested").length,
    activeCampaigns: campaigns.filter((c) => c.status === "active").length,
    campaignsInReview: campaigns.filter((c) => c.status === "in_review").length,
    openModeration: moderationQueue.filter((m) => m.status === "open" || m.status === "escalated").length,
  }
}
