import { brands } from "@/lib/data"
import type { BrandApplication, PlatformUser } from "@/lib/data/admin"
import { daysAgo, hash, randInt } from "@/lib/data/seed"

/**
 * Review details the frontend data layer doesn't store yet, derived deterministically from
 * what it does store. In the backend phase these come from `verification_submissions` and
 * the reports table.
 */

export type CheckState = "done" | "review" | "missing" | "failed"
export type CheckItem = { key: string; label: string; detail: string; state: CheckState }

export function verificationChecklist(a: BrandApplication): CheckItem[] {
  const identity: CheckItem = {
    key: "identity",
    label: "Owner identity",
    ...(a.kyc === "verified"
      ? { state: "done" as const, detail: "Government ID matched to the account owner." }
      : a.kyc === "submitted"
        ? { state: "review" as const, detail: "ID submitted, check in progress." }
        : a.kyc === "failed"
          ? { state: "failed" as const, detail: "ID didn't match the account owner." }
          : { state: "missing" as const, detail: "No ID submitted yet." }),
  }
  const payoutMissing = /payout details missing/i.test(a.notes) || a.kyc === "not_started"
  const last4 = a.application?.payments?.accountLast4
  const payout: CheckItem = {
    key: "payout",
    label: "Payout account",
    // A Studio application names its account; nobody has checked it against the owner yet.
    ...(a.application
      ? last4
        ? { state: "review" as const, detail: `Account ending ${last4} added, not yet matched to the owner.` }
        : { state: "missing" as const, detail: "No bank account added." }
      : payoutMissing
      ? { state: "missing" as const, detail: "No bank account added." }
      : a.kyc === "failed"
        ? { state: "failed" as const, detail: "Account name doesn't match the owner." }
        : { state: "done" as const, detail: "Bank account name matches the owner." }),
  }
  const registration: CheckItem = {
    key: "registration",
    label: "Business registration",
    ...(a.status === "pending_review" && a.kyc !== "verified"
      ? { state: a.kyc === "not_started" ? ("missing" as const) : ("review" as const), detail: a.kyc === "not_started" ? "Not uploaded." : "Document under review." }
      : a.kyc === "failed"
        ? { state: "failed" as const, detail: "Document couldn't be verified." }
        : { state: "done" as const, detail: "Registration number confirmed." }),
  }
  const authenticity: CheckItem = {
    key: "authenticity",
    label: "Brand authenticity",
    ...(a.risk === "high"
      ? { state: "failed" as const, detail: "Listings matched protected marks or counterfeit reports." }
      : a.risk === "medium"
        ? { state: "review" as const, detail: "Catalogue spot-check not done yet." }
        : { state: "done" as const, detail: "Original designs, no marks matched." }),
  }
  const catalogue: CheckItem = {
    key: "catalogue",
    label: "Catalogue ready",
    ...(a.products >= 3
      ? { state: "done" as const, detail: `${a.products} products drafted or live.` }
      : { state: "missing" as const, detail: "Fewer than 3 products." }),
  }
  return [identity, payout, registration, authenticity, catalogue]
}

export type UserReport = { id: string; at: string; reason: string; reportedBy: string; context: string }

const REPORT_REASONS = [
  { reason: "Chargeback filed after a confirmed delivery", context: "Carrier shows signed delivery; the card issuer reversed the charge 12 days later." },
  { reason: "Suspected bot entries during a drop", context: "Seven draw entries from one device within two seconds of opening." },
  { reason: "Abusive messages to a brand", context: "Repeated insulting messages after a delayed shipment." },
  { reason: "Several accounts sharing one card", context: "Same card used across three accounts with different shipping names." },
  { reason: "Reselling a draw-only release", context: "Listed a numbered pair on a resale site the day it arrived." },
]


export function reportsFor(u: PlatformUser): UserReport[] {
  const offset = hash(u.id) % REPORT_REASONS.length
  return Array.from({ length: u.reports }, (_, i) => {
    const r = REPORT_REASONS[(offset + i) % REPORT_REASONS.length]
    const system = /bot/.test(r.reason) ? "Drop protection rules" : /card/.test(r.reason) ? "Payment risk rules" : null
    return {
      id: `${u.id}_r${i}`,
      at: daysAgo(randInt(`${u.id}-report-${i}`, 1, 40) + i * 3),
      reason: r.reason,
      context: r.context,
      reportedBy: system ?? brands[hash(`${u.id}-${i}`) % brands.length].name,
    }
  }).sort((a, b) => b.at.localeCompare(a.at))
}
