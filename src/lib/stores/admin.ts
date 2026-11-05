"use client"

import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"
import { adminUser, auditLog as seedAudit, brandApplications, moderationQueue, payouts as seedPayouts, platformUsers, refunds as seedRefunds, type AuditEntry, type BrandApplication, type ModerationItem, type Payout, type PlatformUser, type Refund } from "@/lib/data/admin"
import { campaignTypes, campaigns as seedCampaigns, type Campaign, type CampaignType } from "@/lib/data/ads"

/**
 * Admin Control Center state for the frontend phase. Every decision appends an audit
 * entry with the actor and the reason; nothing financial is edited in place. Ledger
 * adjustments are requests that a second admin must approve.
 */

export type AdjustmentRequest = { id: string; at: string; brandName: string; amountUsd: number; reason: string; requestedBy: string; status: "pending" | "approved" | "rejected"; decidedBy?: string }

type AdminState = {
  audit: AuditEntry[]
  applications: BrandApplication[]
  moderation: ModerationItem[]
  users: PlatformUser[]
  payouts: Payout[]
  refunds: Refund[]
  campaigns: Campaign[]
  pricing: Record<CampaignType, number>
  adjustments: AdjustmentRequest[]
  log: (action: string, target: string, reason?: string) => void
  setApplicationStatus: (id: string, status: BrandApplication["status"], reason: string) => void
  setModerationStatus: (id: string, status: ModerationItem["status"], reason: string) => void
  setUserStatus: (id: string, status: PlatformUser["status"], reason: string) => void
  setPayoutStatus: (id: string, status: Payout["status"], reason: string) => void
  setRefundStatus: (id: string, status: Refund["status"], reason: string) => void
  reviewCampaign: (id: string, decision: "active" | "rejected", reason: string) => void
  setPrice: (type: CampaignType, priceUsd: number, reason: string) => void
  requestAdjustment: (brandName: string, amountUsd: number, reason: string) => void
  decideAdjustment: (id: string, decision: "approved" | "rejected", reason: string) => void
}

const verbs = {
  brand: { pending_review: "Returned brand to review", verified: "Verified brand", restricted: "Restricted brand", suspended: "Suspended brand" },
  moderation: { open: "Reopened report", removed: "Removed listing", dismissed: "Dismissed report", escalated: "Escalated to legal" },
  user: { active: "Reinstated account", restricted: "Restricted account", suspended: "Suspended account" },
  payout: { scheduled: "Released payout", awaiting_approval: "Sent payout for approval", processing: "Approved payout", paid: "Marked payout as paid", held: "Held payout" },
  refund: { requested: "Reopened refund request", approved: "Approved refund", issued: "Issued refund", declined: "Declined refund" },
} as const

const dollars = (cents: number) => "$" + (cents / 100).toFixed(2)

function entry(action: string, target: string, reason?: string): AuditEntry {
  return { id: `au_${Date.now().toString(36)}_${Math.round(performance.now())}`, at: new Date().toISOString(), actor: adminUser.name, role: adminUser.role, action, target, reason, ip: "local" }
}

export const useAdmin = create<AdminState>()(
  persist(
    (set, get) => ({
      audit: seedAudit,
      applications: brandApplications,
      moderation: moderationQueue,
      users: platformUsers,
      payouts: seedPayouts,
      refunds: seedRefunds,
      campaigns: seedCampaigns,
      pricing: Object.fromEntries(Object.entries(campaignTypes).map(([k, v]) => [k, v.priceUsd])) as Record<CampaignType, number>,
      adjustments: [
        { id: "adj_1", at: new Date("2026-11-04T10:12:00Z").toISOString(), brandName: "Mute Objects", amountUsd: 1240, reason: "Shipping label refund from carrier", requestedBy: "Daniel Okoro", status: "pending" },
      ],
      log: (action, target, reason) => set({ audit: [entry(action, target, reason), ...get().audit] }),
      setApplicationStatus: (id, status, reason) => {
        const a = get().applications.find((x) => x.id === id)
        set({ applications: get().applications.map((x) => (x.id === id ? { ...x, status } : x)), audit: [entry(verbs.brand[status], a?.brandName ?? id, reason), ...get().audit] })
      },
      setModerationStatus: (id, status, reason) => {
        const m = get().moderation.find((x) => x.id === id)
        set({ moderation: get().moderation.map((x) => (x.id === id ? { ...x, status } : x)), audit: [entry(verbs.moderation[status], m?.title ?? id, reason), ...get().audit] })
      },
      setUserStatus: (id, status, reason) => {
        const u = get().users.find((x) => x.id === id)
        set({ users: get().users.map((x) => (x.id === id ? { ...x, status } : x)), audit: [entry(verbs.user[status], u?.name ?? id, reason), ...get().audit] })
      },
      setPayoutStatus: (id, status, reason) => {
        const p = get().payouts.find((x) => x.id === id)
        set({ payouts: get().payouts.map((x) => (x.id === id ? { ...x, status } : x)), audit: [entry(verbs.payout[status], p ? `${p.brandName}, ${dollars(p.amountUsd)}` : id, reason), ...get().audit] })
      },
      setRefundStatus: (id, status, reason) => {
        const r = get().refunds.find((x) => x.id === id)
        set({ refunds: get().refunds.map((x) => (x.id === id ? { ...x, status } : x)), audit: [entry(verbs.refund[status], r ? `#${r.reference}, ${dollars(r.amountUsd)}` : id, reason), ...get().audit] })
      },
      reviewCampaign: (id, decision, reason) => {
        const c = get().campaigns.find((x) => x.id === id)
        set({ campaigns: get().campaigns.map((x) => (x.id === id ? { ...x, status: decision, rejectionReason: decision === "rejected" ? reason : undefined } : x)), audit: [entry(decision === "active" ? "Approved campaign" : "Rejected campaign", c?.name ?? id, reason), ...get().audit] })
      },
      setPrice: (type, priceUsd, reason) => {
        const before = get().pricing[type]
        set({ pricing: { ...get().pricing, [type]: priceUsd }, audit: [entry("Changed ad pricing", `${campaignTypes[type].name}: $${(before / 100).toFixed(2)} → $${(priceUsd / 100).toFixed(2)}`, reason), ...get().audit] })
      },
      requestAdjustment: (brandName, amountUsd, reason) =>
        set({ adjustments: [{ id: `adj_${Date.now().toString(36)}`, at: new Date().toISOString(), brandName, amountUsd, reason, requestedBy: adminUser.name, status: "pending" }, ...get().adjustments], audit: [entry("Ledger adjustment requested", `${brandName}, ${amountUsd >= 0 ? "+" : "−"}$${(Math.abs(amountUsd) / 100).toFixed(2)}`, reason), ...get().audit] }),
      decideAdjustment: (id, decision, reason) => {
        const a = get().adjustments.find((x) => x.id === id)
        set({ adjustments: get().adjustments.map((x) => (x.id === id ? { ...x, status: decision, decidedBy: adminUser.name } : x)), audit: [entry(decision === "approved" ? "Approved ledger adjustment" : "Rejected ledger adjustment", a ? a.brandName : id, reason), ...get().audit] })
      },
    }),
    { name: "nocturne-admin", storage: createJSONStorage(() => localStorage), skipHydration: true },
  ),
)
