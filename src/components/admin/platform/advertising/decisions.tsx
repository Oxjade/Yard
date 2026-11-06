"use client"

import { useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { ReasonDialog } from "@/components/admin/ui/reason-dialog"
import { brandById } from "@/lib/data"
import { STUDIO_BRAND_ID } from "@/lib/data/brands"
import type { Campaign } from "@/lib/data/ads"
import { useAdmin } from "@/lib/stores/admin"
import { useNotifications } from "@/lib/stores/notifications"
import { useStudio } from "@/lib/stores/studio"
import { campaignWindow, formatDay, formatRange, usd } from "../format"
import { useDialogReturn } from "../ready"
import { placementRules, SECOND_APPROVER_OVER_CENTS } from "./placements"

export type Decision = "active" | "rejected"

/** Over the limit, the reviewing admin can only send the decision to a second admin. */
export const REQUEST_APPROVE = "Requested campaign approval"
export const REQUEST_REJECT = "Requested campaign rejection"
/** The requesting admin can take a request back while it waits; the campaign is then decided afresh. */
export const WITHDRAW_REQUEST = "Withdrew campaign decision request"
export const DECISION_ACTIONS = ["Approved campaign", "Approved campaign (scheduled)", "Rejected campaign"]
const requestTarget = (c: Campaign) => `${c.name} (${c.id})`
export const needsSecond = (c: Campaign) => c.budget > SECOND_APPROVER_OVER_CENTS

/**
 * Every campaign the platform knows about: the review store's, plus any the Studio brand has
 * submitted in this browser that the review store hasn't seen yet. Without the second half, a
 * "Campaign submitted for review" notification would open a queue that doesn't list it.
 */
export function useAllCampaigns() {
  const admin = useAdmin((s) => s.campaigns)
  const studio = useStudio((s) => s.campaigns)
  return useMemo(() => {
    const known = new Set(admin.map((c) => c.id))
    return [...admin, ...studio.filter((c) => !known.has(c.id) && c.status !== "draft")]
  }, [admin, studio])
}

/** Campaigns whose decision has been sent to a second admin, and which way. */
export function useRequested(campaigns: Campaign[]) {
  const audit = useAdmin((s) => s.audit)
  return useMemo(() => {
    const m = new Map<string, Decision>()
    for (const c of campaigns) {
      if (c.status !== "in_review") continue
      // The newest request or withdrawal for this campaign decides (the audit log is newest first).
      const a = audit.find((x) => (x.action === REQUEST_APPROVE || x.action === REQUEST_REJECT || x.action === WITHDRAW_REQUEST) && (x.subjectId === c.id || x.target === requestTarget(c)))
      if (a && a.action !== WITHDRAW_REQUEST) m.set(c.id, a.action === REQUEST_APPROVE ? "active" : "rejected")
    }
    return m
  }, [audit, campaigns])
}

/** Takes back a request for a second approval: logged, and the campaign can be decided again. */
export function withdrawRequest(c: Campaign, decision: Decision) {
  useAdmin.getState().log(WITHDRAW_REQUEST, requestTarget(c), `Withdrew the request to ${decision === "active" ? "approve" : "reject"} it`)
}

/**
 * Records the decision in the review store (status, reason, audit entry) and, for the Studio
 * brand, mirrors the outcome onto its own copy of the campaign so Studio's Advertising page
 * and the notification it receives agree.
 */
function applyDecision(c: Campaign, decision: Decision, reason: string) {
  const admin = useAdmin.getState()
  if (!admin.campaigns.some((x) => x.id === c.id)) useAdmin.setState({ campaigns: [c, ...admin.campaigns] })
  useAdmin.getState().reviewCampaign(c.id, decision, reason)
  const after = useAdmin.getState().campaigns.find((x) => x.id === c.id) ?? c
  if (c.brandId === STUDIO_BRAND_ID) {
    const studio = useStudio.getState()
    const mine = studio.campaigns.find((x) => x.id === c.id)
    if (mine) studio.upsertCampaign({ ...mine, status: after.status, rejectionReason: after.rejectionReason })
    // Approved and active or rejected, the merchant notification comes from the store events;
    // approved with a future start ("scheduled") has to be announced here.
    if (after.status === "scheduled") {
      const start = campaignWindow(c.startDaysFromToday, c.days).start
      useNotifications.getState().push({
        eventKey: `m:campaign:${c.id}:scheduled`,
        audience: "merchant",
        category: "campaign_review",
        title: `Campaign approved: ${c.name}`,
        body: `It's scheduled to start on ${formatDay(start)}, always labelled Sponsored.`,
        href: "/studio/advertising",
        at: new Date().toISOString(),
      })
    }
  }
  return after
}

type Pending = { campaign: Campaign; decision: Decision; second: boolean }

/**
 * The approve / reject flow shared by the review queue and the campaigns table: a reason
 * dialog that states the consequence, then the decision. Budgets over the limit go to a
 * second admin instead, as the Sensitive actions policy requires.
 */
export function useCampaignDecision() {
  const log = useAdmin((s) => s.log)
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
  const win = c ? campaignWindow(c.startDaysFromToday, c.days) : null
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
            description: `${brand}, ${usd(c.budget)}, ${formatRange(win.start, win.end)}. Placements: ${where}, with the Sponsored label in every slot.${studio ? ` ${brand} sees the decision in Studio.` : ""}`,
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
      log(decision === "active" ? REQUEST_APPROVE : REQUEST_REJECT, requestTarget(campaign), reason)
      toast("Sent for a second approval", { description: `${campaign.name} stays in review until another admin confirms. Recorded in the audit log.` })
      return
    }
    const after = applyDecision(campaign, decision, reason)
    leaving.current = campaign.id
    if (decision === "rejected") {
      toast("Campaign rejected", { description: "Recorded in the audit log with your reason." })
      return
    }
    const start = campaignWindow(campaign.startDaysFromToday, campaign.days).start
    // What was recorded, not that shoppers see it: the page note says when that happens.
    toast.success("Campaign approved", { description: `${after.status === "scheduled" ? `Scheduled to start on ${formatDay(start)}.` : "Marked active from today."} Recorded in the audit log.` })
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
