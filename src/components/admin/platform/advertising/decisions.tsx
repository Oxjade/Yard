"use client"

import { useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { ReasonDialog } from "@/components/admin/ui/reason-dialog"
import { brandById } from "@/lib/data"
import { STUDIO_BRAND_ID } from "@/lib/data/brands"
import { campaignDates, type Campaign } from "@/lib/data/ads"
import { useNow } from "@/hooks/use-now"
import { campaignRequestActions, pendingCampaignRequest, useAdmin } from "@/lib/stores/admin"
import { formatDay, formatRange, usd } from "../format"
import { useDialogReturn } from "../ready"
import { placementRules, SECOND_APPROVER_OVER_CENTS } from "./placements"

export type Decision = "active" | "rejected"

/** Over the limit, the reviewing admin can only send the decision to a second admin. */
export const REQUEST_APPROVE = campaignRequestActions.approve
export const REQUEST_REJECT = campaignRequestActions.reject
/** The requesting admin can take a request back while it waits; the campaign is then decided afresh. */
export const WITHDRAW_REQUEST = campaignRequestActions.withdraw
export const DECISION_ACTIONS = ["Approved campaign", "Approved campaign (scheduled)", "Rejected campaign"]
export const needsSecond = (c: Campaign) => c.budget > SECOND_APPROVER_OVER_CENTS

/**
 * Every campaign the platform knows about. The Studio store puts a brand's submission in the
 * review store as it's sent, so this is the review store's list.
 */
export function useAllCampaigns() {
  return useAdmin((s) => s.campaigns)
}

/** Campaigns whose decision has been sent to a second admin, and which way. */
export function useRequested(campaigns: Campaign[]) {
  const audit = useAdmin((s) => s.audit)
  const requests = useAdmin((s) => s.campaignRequests)
  return useMemo(() => {
    const m = new Map<string, Decision>()
    for (const c of campaigns) {
      if (c.status !== "in_review") continue
      const d = pendingCampaignRequest({ audit, campaignRequests: requests }, c)
      if (d) m.set(c.id, d)
    }
    return m
  }, [audit, requests, campaigns])
}

/** Takes back a request for a second approval: recorded, and the campaign can be decided again. */
export function withdrawRequest(c: Campaign, decision: Decision) {
  return useAdmin.getState().withdrawCampaignDecision(c.id, `Withdrew the request to ${decision === "active" ? "approve" : "reject"} it`)
}

/**
 * Records the decision: the review store's status, reason and audit entry. The store brings a
 * Studio brand's own copy of the campaign in step, and the merchant's notification comes from the
 * store events (approved, scheduled or rejected).
 */
function applyDecision(c: Campaign, decision: Decision, reason: string) {
  useAdmin.getState().reviewCampaign(c.id, decision, reason)
  return useAdmin.getState().campaigns.find((x) => x.id === c.id) ?? c
}

type Pending = { campaign: Campaign; decision: Decision; second: boolean }

/**
 * The approve / reject flow shared by the review queue and the campaigns table: a reason
 * dialog that states the consequence, then the decision. Budgets over the limit go to a
 * second admin instead, as the Sensitive actions policy requires.
 */
export function useCampaignDecision() {
  const [pending, setPending] = useState<Pending | null>(null)
  const [open, setOpen] = useState(false)
  // When the decided row leaves the queue, focus lands on the next decision, or the queue itself.
  const focus = useDialogReturn(["#review-queue li button:not([disabled])", "#ad-sections [role=tab][aria-selected=true]"])
  // The decided campaign, while its card animates out: its own buttons are still on the page
  // for a moment, so focus skips them for the next campaign's.
  const leaving = useRef<string | null>(null)

  function onCloseAutoFocus(e: Event) {
    const id = leaving.current
    leaving.current = null
    if (!id) return focus.onCloseAutoFocus(e)
    e.preventDefault()
    const next = document.querySelector<HTMLElement>(`#review-queue li:not(#review-${CSS.escape(id)}) button:not([disabled])`) ?? document.querySelector<HTMLElement>("#ad-sections [role=tab][aria-selected=true]")
    next?.focus()
  }

  function ask(campaign: Campaign, decision: Decision) {
    setPending({ campaign, decision, second: needsSecond(campaign) })
    focus.openFrom(() => setOpen(true))
  }

  const c = pending?.campaign
  const brand = c ? (brandById.get(c.brandId)?.name ?? "The brand") : ""
  const studio = c?.brandId === STUDIO_BRAND_ID
  // The brand's calendar days, as Studio and the merchant's notification give them.
  const now = useNow(60_000)
  const win = c && now !== null ? campaignDates(c, now) : null
  const where = c ? c.placements.map((p) => placementRules[p].name).join(", ") : ""

  const copy = !pending || !c || !win
    ? null
    : pending.second
      ? {
          title: `Ask a second admin to ${pending.decision === "active" ? "approve" : "reject"} ${c.name}`,
          description: `The budget is ${usd(c.budget)}, over the ${usd(SECOND_APPROVER_OVER_CENTS)} limit, so another admin with campaign review rights has to confirm from their own sign-in, which works once multiple admin accounts are connected. It stays in review until then, ${brand} isn't told yet, and you can withdraw the request.`,
          confirmLabel: "Send for a second approval",
          destructive: false,
        }
      : pending.decision === "active"
        ? {
            title: `Approve ${c.name}`,
            description: `${brand}, ${usd(c.budget)}, ${formatRange(`${win.start}T12:00:00Z`, `${win.end}T12:00:00Z`)}. Placements: ${where}, with the Sponsored label in every slot.${studio ? ` ${brand} sees the decision in Studio.` : ""}`,
            confirmLabel: "Approve campaign",
            destructive: false,
          }
        : {
            title: `Reject ${c.name}`,
            description: `${brand} sees your reason${studio ? " in Studio" : ""}. The slot is released and the ${usd(c.budget)} booking is marked for a full refund, which is sent once a payment provider is connected.`,
            confirmLabel: "Reject campaign",
            destructive: true,
          }

  function confirm(reason: string) {
    if (!pending) return
    const { campaign, decision, second } = pending
    if (second) {
      if (useAdmin.getState().requestCampaignDecision(campaign.id, decision, reason)) toast("Sent for a second approval", { description: `${campaign.name} stays in review until another admin confirms. Recorded in the audit log.` })
      else toast.info(`${campaign.name} already has a request waiting, or has been decided`, { description: "Nothing new was recorded." })
      return
    }
    const after = applyDecision(campaign, decision, reason)
    leaving.current = campaign.id
    if (decision === "rejected") {
      toast("Campaign rejected", { description: "Recorded in the audit log with your reason." })
      return
    }
    const { start } = campaignDates(campaign, Date.now())
    // What was recorded, not that shoppers see it: the page note says when that happens.
    toast.success("Campaign approved", { description: `${after.status === "scheduled" ? `Scheduled to start on ${formatDay(`${start}T12:00:00Z`)}.` : "Marked active from today."} Recorded in the audit log.` })
  }

  const dialog = copy ? (
    <ReasonDialog
      key={`${pending?.campaign.id}-${pending?.decision}`}
      open={open}
      onOpenChange={setOpen}
      title={copy.title}
      description={copy.description}
      confirmLabel={copy.confirmLabel}
      destructive={copy.destructive}
      onConfirm={confirm}
      onCloseAutoFocus={onCloseAutoFocus}
    />
  ) : null

  return { ask, dialog }
}
