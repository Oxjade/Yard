"use client"

import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"
import type { CurrencyCode } from "@/config/markets"
import { adminUser, auditLog as seedAudit, brandApplications, disputes as seedDisputes, moderationQueue, payouts as seedPayouts, platformUsers, refunds as seedRefunds, type AuditEntry, type BrandApplication, type Dispute, type ModerationItem, type Payout, type PlatformUser, type Refund } from "@/lib/data/admin"
import { campaignTypes, campaigns as seedCampaigns, type Campaign, type CampaignType } from "@/lib/data/ads"
import { convert } from "@/lib/money"
import { applyReturnDecision } from "./orders"
import { useStudio } from "./studio"

/**
 * Admin Control Center state for the frontend phase. Every decision appends an audit
 * entry with the actor and the reason; nothing financial is edited in place. Ledger
 * adjustments are requests that a second admin must approve.
 */

export type AdjustmentRequest = { id: string; at: string; brandName: string; amountUsd: number; reason: string; requestedBy: string; status: "pending" | "approved" | "rejected"; decidedBy?: string; decidedAt?: string }

/** A campaign decision over the budget limit, sent to a second admin to confirm. */
export type CampaignDecisionRequest = { id: string; campaignId: string; decision: "active" | "rejected"; reason: string; requestedBy: string; at: string; status: "pending" | "withdrawn" | "decided" }

/** Audit actions for campaign decisions sent to a second admin (the Advertising page reads them back). */
export const campaignRequestActions = { approve: "Requested campaign approval", reject: "Requested campaign rejection", withdraw: "Withdrew campaign decision request" } as const

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
  campaignRequests: CampaignDecisionRequest[]
  disputes: Dispute[]
  /** Operational actions taken in this browser, keyed by job / webhook / session / member id. */
  ops: { retriedJobs: string[]; replayedWebhooks: string[]; revokedSessions: string[]; mfaRequired: string[] }
  log: (action: string, target: string, reason?: string) => void
  setApplicationStatus: (id: string, status: BrandApplication["status"], reason: string) => void
  setModerationStatus: (id: string, status: ModerationItem["status"], reason: string) => void
  setUserStatus: (id: string, status: PlatformUser["status"], reason: string) => void
  setPayoutStatus: (id: string, status: Payout["status"], reason: string) => void
  /**
   * A brand's payout request from Studio: joins the Finance queue as "awaiting approval" with the
   * exact amount the brand confirmed, in its own currency. Idempotent by id, so a repeat submit
   * never creates two. Returns false when that request already exists.
   */
  requestPayout: (p: { id: string; brandId: string; brandName: string; amount: number; currency: CurrencyCode; method: string; orders?: number }) => boolean
  /**
   * Approving or declining a refund also records the decision on the order itself (the brand's
   * copy in Studio and the shopper's), so every surface reads the same outcome.
   */
  setRefundStatus: (id: string, status: Refund["status"], reason: string) => void
  /** Approving with a future start schedules the campaign. A Studio brand's own copy of the campaign follows. */
  reviewCampaign: (id: string, decision: "active" | "rejected", reason: string) => void
  /**
   * Sends a campaign decision to a second admin (budgets over the limit). Records the request and
   * its audit entry; the campaign stays in review. Returns false when the campaign isn't in review
   * or a request for it is already waiting.
   */
  requestCampaignDecision: (id: string, decision: "active" | "rejected", reason: string) => boolean
  /** Takes back a waiting request, so the campaign can be decided afresh. Returns false when none is waiting. */
  withdrawCampaignDecision: (id: string, reason: string) => boolean
  setPrice: (type: CampaignType, priceUsd: number, reason: string) => void
  requestAdjustment: (brandName: string, amountUsd: number, reason: string) => void
  /** Returns false (and changes nothing) when the approver is the person who requested it — the two-person rule. */
  decideAdjustment: (id: string, decision: "approved" | "rejected", reason: string) => boolean
  submitDisputeEvidence: (id: string, note: string) => void
  retryJob: (id: string, label: string, reason: string) => void
  replayWebhook: (id: string, label: string, reason: string) => void
  revokeSession: (id: string, label: string, reason: string) => void
  requireMfa: (memberId: string, name: string, reason: string) => void
}

const verbs = {
  brand: { pending_review: "Returned brand to review", verified: "Verified brand", restricted: "Restricted brand", suspended: "Suspended brand" },
  moderation: { open: "Reopened report", removed: "Removed listing", dismissed: "Dismissed report", escalated: "Escalated to legal" },
  user: { active: "Reinstated account", restricted: "Restricted account", suspended: "Suspended account" },
  payout: { scheduled: "Released payout", awaiting_approval: "Sent payout for approval", processing: "Approved payout", paid: "Marked payout as paid", held: "Held payout" },
  refund: { requested: "Reopened refund request", approved: "Approved refund", issued: "Issued refund", declined: "Declined refund" },
} as const

const dollars = (cents: number) => "$" + (cents / 100).toFixed(2)

let auditSeq = 0
function entry(action: string, target: string, reason?: string, subjectId?: string): AuditEntry {
  auditSeq += 1
  return { id: `au_${Date.now().toString(36)}_${Math.round(performance.now())}_${auditSeq}`, at: new Date().toISOString(), actor: adminUser.name, role: adminUser.role, action, target, reason, ip: "local", subjectId }
}

const campaignTarget = (c: Pick<Campaign, "name" | "id">) => `${c.name} (${c.id})`

/**
 * The decision a campaign's waiting second-approval request asks for, or null when none is
 * waiting. Stored requests decide; a campaign with none falls back to its newest request or
 * withdrawal in the audit log (requests sent before they were stored).
 */
export function pendingCampaignRequest(s: Pick<AdminState, "campaignRequests" | "audit">, c: Pick<Campaign, "id" | "name">): "active" | "rejected" | null {
  const stored = s.campaignRequests.filter((x) => x.campaignId === c.id)
  if (stored.length) return stored.find((x) => x.status === "pending")?.decision ?? null
  const actions: string[] = Object.values(campaignRequestActions)
  const last = s.audit.find((a) => actions.includes(a.action) && (a.subjectId === c.id || a.target === campaignTarget(c)))
  if (!last || last.action === campaignRequestActions.withdraw) return null
  return last.action === campaignRequestActions.approve ? "active" : "rejected"
}

/** What another store saved in this browser, read straight from storage (for a one-off migration). */
export function readSaved<T>(name: string): Partial<T> | null {
  try {
    const raw = localStorage.getItem(name)
    return raw ? ((JSON.parse(raw) as { state?: Partial<T> }).state ?? null) : null
  } catch {
    return null
  }
}

/** Campaigns Studio sent for review that the review queue saved without (before the stores kept in step). */
function joinStudioSubmissions(campaigns: Campaign[]) {
  const studio = readSaved<{ campaigns: Campaign[] }>("nocturne-studio")?.campaigns ?? []
  const missing = studio.filter((c) => c.status === "in_review" && !campaigns.some((x) => x.id === c.id))
  return missing.length ? [...missing, ...campaigns] : campaigns
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
      campaignRequests: [],
      disputes: seedDisputes,
      ops: { retriedJobs: [], replayedWebhooks: [], revokedSessions: [], mfaRequired: [] },
      log: (action, target, reason) => set({ audit: [entry(action, target, reason), ...get().audit] }),
      setApplicationStatus: (id, status, reason) => {
        const a = get().applications.find((x) => x.id === id)
        set({ applications: get().applications.map((x) => (x.id === id ? { ...x, status } : x)), audit: [entry(verbs.brand[status], a?.brandName ?? id, reason, id), ...get().audit] })
      },
      setModerationStatus: (id, status, reason) => {
        const m = get().moderation.find((x) => x.id === id)
        set({ moderation: get().moderation.map((x) => (x.id === id ? { ...x, status } : x)), audit: [entry(verbs.moderation[status], m?.title ?? id, reason, id), ...get().audit] })
      },
      setUserStatus: (id, status, reason) => {
        const u = get().users.find((x) => x.id === id)
        set({ users: get().users.map((x) => (x.id === id ? { ...x, status } : x)), audit: [entry(verbs.user[status], u ? `${u.name}, ${u.email}` : id, reason, id), ...get().audit] })
      },
      setPayoutStatus: (id, status, reason) => {
        const p = get().payouts.find((x) => x.id === id)
        set({ payouts: get().payouts.map((x) => (x.id === id ? { ...x, status, holdReason: status === "held" ? reason : undefined } : x)), audit: [entry(verbs.payout[status], p ? `${p.brandName}, ${dollars(p.amountUsd)}` : id, reason, id), ...get().audit] })
      },
      requestPayout: (p) => {
        if (get().payouts.some((x) => x.id === p.id)) return false
        const at = new Date().toISOString()
        // No admin audit entry: the brand made the request, and the audit log records admins' actions.
        // `orders`: the delivered orders the brand's available balance comes from.
        set({ payouts: [{ ...p, amountUsd: convert(p.amount, p.currency, "USD"), scheduledFor: at, status: "awaiting_approval", orders: p.orders ?? 0 }, ...get().payouts] })
        return true
      },
      setRefundStatus: (id, status, reason) => {
        const r = get().refunds.find((x) => x.id === id)
        const e = entry(verbs.refund[status], r ? `#${r.reference}, ${dollars(r.amountUsd)}` : id, reason, id)
        set({ refunds: get().refunds.map((x) => (x.id === id ? { ...x, status } : x)), audit: [e, ...get().audit] })
        // The order carries the decision too: the shopper's order and the brand's both show it.
        if (status === "approved" || status === "declined") applyReturnDecision(id.replace(/^rf_/, ""), { status, reason, by: "platform", ref: e.id })
      },
      reviewCampaign: (id, decision, reason) => {
        const c = get().campaigns.find((x) => x.id === id)
        const status = decision === "rejected" ? "rejected" : c && c.startDaysFromToday > 0 ? "scheduled" : "active"
        const rejectionReason = decision === "rejected" ? reason : undefined
        set({
          campaigns: get().campaigns.map((x) => (x.id === id ? { ...x, status, rejectionReason } : x)),
          campaignRequests: get().campaignRequests.map((x) => (x.campaignId === id && x.status === "pending" ? { ...x, status: "decided" } : x)),
          audit: [entry(decision === "active" ? (status === "scheduled" ? "Approved campaign (scheduled)" : "Approved campaign") : "Rejected campaign", c?.name ?? id, reason, id), ...get().audit],
        })
        // The Studio brand's own copy follows (in the backend phase: one row).
        const studio = useStudio.getState()
        if (c && c.brandId === studio.brandId && studio.campaigns.some((x) => x.id === id)) {
          useStudio.setState({ campaigns: studio.campaigns.map((x) => (x.id === id ? { ...x, status, rejectionReason } : x)) })
        }
      },
      requestCampaignDecision: (id, decision, reason) => {
        const c = get().campaigns.find((x) => x.id === id)
        if (!c || c.status !== "in_review" || pendingCampaignRequest(get(), c)) return false
        const at = new Date().toISOString()
        const request: CampaignDecisionRequest = { id: `cdr_${id}_${Date.now().toString(36)}`, campaignId: id, decision, reason, requestedBy: adminUser.name, at, status: "pending" }
        set({ campaignRequests: [request, ...get().campaignRequests], audit: [entry(decision === "active" ? campaignRequestActions.approve : campaignRequestActions.reject, campaignTarget(c), reason, id), ...get().audit] })
        return true
      },
      withdrawCampaignDecision: (id, reason) => {
        const c = get().campaigns.find((x) => x.id === id)
        if (!c || !pendingCampaignRequest(get(), c)) return false
        set({
          campaignRequests: get().campaignRequests.map((x) => (x.campaignId === id && x.status === "pending" ? { ...x, status: "withdrawn" } : x)),
          audit: [entry(campaignRequestActions.withdraw, campaignTarget(c), reason, id), ...get().audit],
        })
        return true
      },
      setPrice: (type, priceUsd, reason) => {
        const before = get().pricing[type]
        const unit = campaignTypes[type].unit
        set({ pricing: { ...get().pricing, [type]: priceUsd }, audit: [entry("Changed ad pricing", `${campaignTypes[type].name}: ${dollars(before)}/${unit} → ${dollars(priceUsd)}/${unit}`, reason, type), ...get().audit] })
      },
      requestAdjustment: (brandName, amountUsd, reason) =>
        set({ adjustments: [{ id: `adj_${Date.now().toString(36)}`, at: new Date().toISOString(), brandName, amountUsd, reason, requestedBy: adminUser.name, status: "pending" }, ...get().adjustments], audit: [entry("Ledger adjustment requested", `${brandName}, ${amountUsd >= 0 ? "+" : "−"}$${(Math.abs(amountUsd) / 100).toFixed(2)}`, reason), ...get().audit] }),
      decideAdjustment: (id, decision, reason) => {
        const a = get().adjustments.find((x) => x.id === id)
        if (!a || a.status !== "pending") return false
        // Two-person rule: whoever requested an adjustment cannot approve it.
        if (decision === "approved" && a.requestedBy === adminUser.name) return false
        set({ adjustments: get().adjustments.map((x) => (x.id === id ? { ...x, status: decision, decidedBy: adminUser.name, decidedAt: new Date().toISOString() } : x)), audit: [entry(decision === "approved" ? "Approved ledger adjustment" : "Rejected ledger adjustment", `${a.brandName}, ${a.amountUsd >= 0 ? "+" : "−"}${dollars(Math.abs(a.amountUsd))}`, reason, id), ...get().audit] })
        return true
      },
      submitDisputeEvidence: (id, note) => {
        const d = get().disputes.find((x) => x.id === id)
        set({ disputes: get().disputes.map((x) => (x.id === id ? { ...x, stage: "under_review" } : x)), audit: [entry("Submitted dispute evidence", d ? `#${d.reference}, ${dollars(d.amountUsd)}` : id, note, id), ...get().audit] })
      },
      retryJob: (id, label, reason) => set({ ops: { ...get().ops, retriedJobs: [...new Set([...get().ops.retriedJobs, id])] }, audit: [entry("Retried background job", label, reason, id), ...get().audit] }),
      replayWebhook: (id, label, reason) => set({ ops: { ...get().ops, replayedWebhooks: [...new Set([...get().ops.replayedWebhooks, id])] }, audit: [entry("Replayed webhook", label, reason, id), ...get().audit] }),
      revokeSession: (id, label, reason) => set({ ops: { ...get().ops, revokedSessions: [...new Set([...get().ops.revokedSessions, id])] }, audit: [entry("Revoked session", label, reason, id), ...get().audit] }),
      requireMfa: (memberId, name, reason) => set({ ops: { ...get().ops, mfaRequired: [...new Set([...get().ops.mfaRequired, memberId])] }, audit: [entry("Required MFA", name, reason, memberId), ...get().audit] }),
    }),
    {
      name: "nocturne-admin",
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      version: 4,
      migrate: (persisted) => {
        const p = (persisted ?? {}) as Partial<AdminState>
        // v3: payouts carry the amount in the brand's currency; second-approval requests are stored.
        const payouts = p.payouts?.map((x) => (typeof x.amount === "number" ? x : { ...x, amount: convert(x.amountUsd, "USD", x.currency as CurrencyCode) }))
        // v4: a Studio submission saved before the stores kept each other in step joins the review
        // queue; sample refund requests carry the same reason and time Studio shows for them.
        const campaigns = p.campaigns ? joinStudioSubmissions(p.campaigns) : undefined
        const refunds = p.refunds?.map((r) => {
          const s = seedRefunds.find((x) => x.id === r.id)
          return s && r.status === "requested" ? { ...r, reason: s.reason, requestedAt: s.requestedAt } : r
        })
        return { ...p, ...(payouts ? { payouts } : {}), ...(campaigns ? { campaigns } : {}), ...(refunds ? { refunds } : {}), campaignRequests: p.campaignRequests ?? [], disputes: p.disputes ?? seedDisputes, ops: p.ops ?? { retriedJobs: [], replayedWebhooks: [], revokedSessions: [], mfaRequired: [] } } as AdminState
      },
    },
  ),
)
