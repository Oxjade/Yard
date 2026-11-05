"use client"

import { useMemo, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { toast } from "sonner"
import { WarningIcon as AlertTriangle, CheckIcon as Check, MegaphoneIcon as Megaphone, UsersIcon as Users } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/dashboard/empty-state"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { brandById, productById } from "@/lib/data"
import { campaignTypes, type Campaign, type CampaignType } from "@/lib/data/ads"
import { useAdmin } from "@/lib/stores/admin"
import { cn } from "@/lib/utils"
import { campaignWindow, formatDay, formatRange, recordTime, usd } from "../format"
import { PlatformPanel } from "../panel"
import { ReasonDialog, type ReasonAction } from "../reason-dialog"
import { CreativePreview } from "./creative-preview"
import { audienceLabel, resolveCreative } from "./creative"
import { placementRules, SECOND_APPROVER_OVER_CENTS, secondApproverLabel } from "./placements"

const REJECT_REASONS = [
  "Image quality is too low",
  "Misleading claim in the creative",
  "Prohibited item",
  "Possible IP or counterfeit risk",
  "Too much text on the image",
  "Destination doesn't match the creative",
  "Price or stock doesn't match the listing",
]

const APPROVE_REASONS = ["Creative, destination and dates checked", "Meets the ad policy; label visible in every slot"]

/** Over the limit, the reviewing admin can only send the decision to a second admin. */
const REQUEST_APPROVE = "Requested campaign approval"
const REQUEST_REJECT = "Requested campaign rejection"
const requestTarget = (c: Campaign) => `${c.name} (${c.id})`
const needsSecond = (c: Campaign) => c.budget > SECOND_APPROVER_OVER_CENTS

type Decision = "active" | "rejected"
type Check = { label: string; ok: boolean; detail?: string }

/** Pre-flight checks for one campaign, computed from the catalogue and the other bookings. */
function checksFor(c: Campaign, all: Campaign[], pricing: Record<CampaignType, number>): Check[] {
  const brand = brandById.get(c.brandId)
  const creative = resolveCreative(c)
  const target = c.targetIds[0] ?? ""
  const destinationOk = target.startsWith("p_") ? productById.get(target)?.status === "published" : !!creative.image
  const t = campaignTypes[c.type]
  const rate = pricing[c.type] * (t.unit === "day" ? c.days : 1)
  const win = campaignWindow(c.startDaysFromToday, c.days)
  const clashes = c.placements.filter((p) => {
    const others = all.filter((o) => o.id !== c.id && (o.status === "active" || o.status === "scheduled") && o.placements.includes(p)).filter((o) => {
      const w = campaignWindow(o.startDaysFromToday, o.days)
      return w.start <= win.end && w.end >= win.start
    })
    return others.length >= placementRules[p].maxPerView
  })
  return [
    { label: "Sponsored label on every placement", ok: true },
    { label: target.startsWith("p_") ? "Product is published" : "Destination is live", ok: destinationOk, detail: destinationOk ? undefined : "The promoted page isn't published yet." },
    { label: "Brand is verified", ok: !!brand?.verified, detail: brand?.verified ? undefined : "Verification is still in review." },
    { label: "Slot is free for these dates", ok: clashes.length === 0, detail: clashes.length ? `${placementRules[clashes[0]].name} is fully booked.` : undefined },
    { label: "Paid the rate card price", ok: rate === c.budget, detail: rate === c.budget ? undefined : `Booked at ${usd(c.budget)}; today's rate is ${usd(rate)}. The brand keeps the price it paid.` },
    { label: "One admin can decide", ok: !needsSecond(c), detail: needsSecond(c) ? `${secondApproverLabel}, so a second admin confirms the decision.` : undefined },
  ]
}

function startLabel(days: number) {
  if (days <= 0) return { text: "Start date passed", tone: "danger" as const }
  if (days === 1) return { text: "Starts tomorrow", tone: "attention" as const }
  if (days === 2) return { text: "Starts in 2 days", tone: "attention" as const }
  return { text: `Starts in ${days} days`, tone: "muted" as const }
}

export function ReviewQueue() {
  const campaigns = useAdmin((s) => s.campaigns)
  const pricing = useAdmin((s) => s.pricing)
  const audit = useAdmin((s) => s.audit)
  const reviewCampaign = useAdmin((s) => s.reviewCampaign)
  const log = useAdmin((s) => s.log)
  const [pending, setPending] = useState<{ id: string; decision: Decision; second: boolean; action: ReasonAction } | null>(null)
  const [open, setOpen] = useState(false)

  const queue = useMemo(() => campaigns.filter((c) => c.status === "in_review").sort((a, b) => a.startDaysFromToday - b.startDaysFromToday), [campaigns])
  const recent = useMemo(() => audit.filter((a) => a.action === "Approved campaign" || a.action === "Rejected campaign").slice(0, 3), [audit])
  /** Decisions sent to a second admin, newest first, by campaign. */
  const requested = useMemo(() => {
    const m = new Map<string, Decision>()
    for (const c of queue) {
      const a = audit.find((x) => (x.action === REQUEST_APPROVE || x.action === REQUEST_REJECT) && x.target === requestTarget(c))
      if (a) m.set(c.id, a.action === REQUEST_APPROVE ? "active" : "rejected")
    }
    return m
  }, [audit, queue])

  function ask(c: Campaign, decision: Decision) {
    const brand = brandById.get(c.brandId)?.name ?? "the brand"
    const win = campaignWindow(c.startDaysFromToday, c.days)
    const facts = [
      { label: "Brand", value: brand },
      { label: "Budget", value: usd(c.budget) },
      { label: "Dates", value: formatRange(win.start, win.end) },
      { label: "Placements", value: c.placements.map((p) => placementRules[p].name).join(", ") },
    ]
    if (needsSecond(c)) {
      setPending({
        id: c.id,
        decision,
        second: true,
        action: {
          title: `Ask a second admin to ${decision === "active" ? "approve" : "reject"} “${c.name}”`,
          body: `The budget is over ${usd(SECOND_APPROVER_OVER_CENTS)}, so another admin with campaign review rights confirms. It stays in review until then, and ${brand} isn't told yet.`,
          confirmLabel: "Send to a second admin",
          tone: "primary",
          presets: decision === "active" ? APPROVE_REASONS : REJECT_REASONS,
          facts,
        },
      })
      setOpen(true)
      return
    }
    setPending({
      id: c.id,
      decision,
      second: false,
      action:
        decision === "active"
          ? {
              title: `Approve “${c.name}”`,
              body: `It goes live on ${formatDay(win.start)} with the Sponsored label in every slot. The brand is told straight away.`,
              confirmLabel: "Approve campaign",
              tone: "primary",
              presets: APPROVE_REASONS,
              facts,
            }
          : {
              title: `Reject “${c.name}”`,
              body: `${brand} sees your reason and gets a full refund of ${usd(c.budget)}. The booking is released so the slot can be sold again.`,
              confirmLabel: "Reject campaign",
              tone: "destructive",
              presets: REJECT_REASONS,
              facts,
            },
    })
    setOpen(true)
  }

  async function confirm(reason: string) {
    if (!pending) return
    const c = campaigns.find((x) => x.id === pending.id)
    if (!c) return
    if (pending.second) {
      log(pending.decision === "active" ? REQUEST_APPROVE : REQUEST_REJECT, requestTarget(c), reason)
      toast.success("Sent to a second admin", { description: `${c.name} stays in review until another admin confirms. Recorded in the audit log.` })
      return
    }
    reviewCampaign(c.id, pending.decision, reason)
    if (pending.decision === "active") {
      const start = campaignWindow(c.startDaysFromToday, c.days).start
      const when = c.startDaysFromToday <= 0 ? "is live now" : `goes live on ${formatDay(start)}`
      toast.success("Campaign approved", { description: `${c.name} ${when} with the Sponsored label. Recorded in the audit log.` })
    } else toast.success("Campaign rejected", { description: "The brand has your reason and a full refund. Recorded in the audit log." })
  }

  return (
    <PlatformPanel
      title="Review queue"
      description="Approve within one business day. Anything that starts in under 48 hours is marked. The brand sees the reason for every rejection."
      action={<StatusBadge tone={queue.length ? "attention" : "muted"}>{queue.length ? `${queue.length} to review` : "Clear"}</StatusBadge>}
      flush
    >
      <ul className="divide-y divide-line-soft border-t border-line-soft">
        <AnimatePresence initial={false} mode="popLayout">
          {queue.map((c, i) => {
            const t = campaignTypes[c.type]
            const brand = brandById.get(c.brandId)
            const win = campaignWindow(c.startDaysFromToday, c.days)
            const start = startLabel(c.startDaysFromToday)
            const checks = checksFor(c, campaigns, pricing)
            const failing = checks.filter((x) => !x.ok).length
            const sent = requested.get(c.id)
            return (
              <motion.li key={c.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: 24 }} transition={{ type: "spring", stiffness: 420, damping: 36 }} className="grid grid-cols-[104px_minmax(0,1fr)] gap-x-3 gap-y-4 p-4 sm:grid-cols-[148px_minmax(0,1fr)] sm:gap-x-4 xl:grid-cols-[176px_minmax(0,1fr)_320px] xl:gap-6">
                <CreativePreview campaign={c} eager={i === 0} className="w-full sm:row-span-2 xl:row-span-1" sizes="(min-width: 1280px) 176px, (min-width: 640px) 148px, 104px" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[11px] text-ink-3">{brand?.name ?? "Unknown brand"}</p>
                      <h3 className="mt-0.5 text-[15px] font-medium leading-snug text-ink">{c.name}</h3>
                    </div>
                    <StatusBadge tone={start.tone}>{start.text}</StatusBadge>
                  </div>

                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5 sm:gap-x-4 sm:gap-y-3">
                    <div className="min-w-0">
                      <dt className="text-[11px] text-ink-3">Type</dt>
                      <dd className="mt-0.5 text-[13px] text-ink">{t.name}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-[11px] text-ink-3">Budget</dt>
                      <dd className="mt-0.5 text-[13px] text-ink tabular">
                        {usd(c.budget)} <span className="text-ink-3">for {c.days} {c.days === 1 ? "day" : "days"}</span>
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-[11px] text-ink-3">Dates</dt>
                      <dd className="mt-0.5 text-[13px] text-ink tabular">{formatRange(win.start, win.end)}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-[11px] text-ink-3">Audience</dt>
                      <dd className="mt-0.5 truncate text-[13px] text-ink" title={audienceLabel(c)}>{audienceLabel(c)}</dd>
                    </div>
                  </dl>

                  <div className="mt-3">
                    <p className="text-[11px] text-ink-3">Placements</p>
                    <ul className="mt-1 flex flex-wrap gap-1.5">
                      {c.placements.map((p) => (
                        <li key={p} className="inline-flex h-6 items-center rounded-[5px] border border-line px-2 text-[11px] text-ink-2">
                          {placementRules[p].name}, position {placementRules[p].positions.join(" or ")}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="col-span-2 flex min-w-0 flex-col rounded-md border border-line-soft bg-surface/50 p-3 sm:col-span-1">
                  <p className="text-[11px] text-ink-3">{failing ? `${failing} ${failing === 1 ? "check needs" : "checks need"} a look` : "All checks passed"}</p>
                  <ul className="mt-2 grid gap-1.5" aria-label="Checks">
                    {checks.map((x) => (
                      <li key={x.label} className="flex items-start gap-2 text-[12px]">
                        {x.ok ? <Check className="mt-0.5 size-3.5 shrink-0 text-violet" aria-hidden /> : <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-acid" aria-hidden />}
                        <span className={cn(x.ok ? "text-ink-2" : "text-ink")}>
                          <span className="sr-only">{x.ok ? "Passed: " : "Check: "}</span>
                          {x.label}
                          {x.detail ? <span className="block text-[11px] text-ink-3">{x.detail}</span> : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {sent ? (
                    <div className="mt-3 border-t border-line-soft pt-3 xl:mt-auto">
                      <p className="flex items-start gap-2 text-[12px] text-ink">
                        <Users className="mt-0.5 size-3.5 shrink-0 text-violet" aria-hidden />
                        <span>
                          Waiting for a second admin to {sent === "active" ? "approve" : "reject"} it.
                          <span className="block text-[11px] text-ink-3">You sent it, so you can&apos;t confirm it yourself.</span>
                        </span>
                      </p>
                    </div>
                  ) : (
                    <div className="mt-3 flex items-center gap-2 border-t border-line-soft pt-3 xl:mt-auto">
                      <Button size="sm" variant="secondary" className="flex-1" onClick={() => ask(c, "active")}>
                        <Check aria-hidden /> Approve
                      </Button>
                      <Button size="sm" variant="ghost" className="flex-1" onClick={() => ask(c, "rejected")}>Reject</Button>
                    </div>
                  )}
                </div>
              </motion.li>
            )
          })}
        </AnimatePresence>
      </ul>
      {queue.length === 0 ? (
        <div className="p-4 pt-0">
          <EmptyState icon={Megaphone} title="Review queue clear" body="New campaigns land here as soon as a brand books a slot. Nothing is waiting on you." className="py-10" />
        </div>
      ) : null}
      {recent.length ? (
        <div className="border-t border-line-soft px-4 py-3">
          <p className="text-[11px] text-ink-3">Recent decisions</p>
          <ul className="mt-1 divide-y divide-line-soft">
            {recent.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline gap-x-2 py-2 text-[12px]">
                <StatusBadge tone={a.action === "Approved campaign" ? "success" : "danger"}>{a.action === "Approved campaign" ? "Approved" : "Rejected"}</StatusBadge>
                <span className="min-w-0 flex-1 truncate text-ink">{a.target}</span>
                <span className="text-[11px] text-ink-3" title={recordTime(a.at).title}>
                  {a.actor}, {recordTime(a.at).label.toLowerCase()}
                </span>
                {a.reason ? <span className="basis-full truncate text-[11px] text-ink-3">{a.reason}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <ReasonDialog action={pending?.action ?? null} open={open} onOpenChange={setOpen} onConfirm={confirm} />
    </PlatformPanel>
  )
}
