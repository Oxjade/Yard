"use client"

import { useMemo } from "react"
import { AnimatePresence, motion } from "motion/react"
import { WarningIcon as AlertTriangle, ArrowUUpLeftIcon, CheckIcon as Check, MegaphoneIcon as Megaphone, UsersIcon as Users, XIcon } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/dashboard/empty-state"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { Bone } from "@/components/feedback/skeletons"
import { useAsyncAction } from "@/hooks/use-async-action"
import { Panel } from "@/components/admin/ui/panel"
import { springs } from "@/components/admin/ui/motion"
import { brandById, productById } from "@/lib/data"
import { campaignDates, campaignTypes, type Campaign, type CampaignType } from "@/lib/data/ads"
import { useNow } from "@/hooks/use-now"
import { spring } from "@/lib/motion"
import { useAdmin } from "@/lib/stores/admin"
import { cn } from "@/lib/utils"
import { formatRange, recordTime, usd } from "../format"
import { CreativePreview } from "./creative-preview"
import { audienceLabel, resolveCreative } from "./creative"
import { DECISION_ACTIONS, needsSecond, useRequested, withdrawRequest, type Decision } from "./decisions"
import { placementRules, secondApproverLabel } from "./placements"

type Check = { label: string; ok: boolean; detail?: string }

/**
 * Pre-flight checks for one campaign, computed from the catalogue and the other bookings. Slot
 * clashes compare the brands' calendar days counted from `now` (campaignDates), the dates the
 * queue shows and Studio booked.
 */
function checksFor(c: Campaign, all: Campaign[], pricing: Record<CampaignType, number>, now: number): Check[] {
  const brand = brandById.get(c.brandId)
  const creative = resolveCreative(c)
  const target = c.targetIds[0] ?? ""
  const destinationOk = target.startsWith("p_") ? productById.get(target)?.status === "published" : !!creative.image
  const t = campaignTypes[c.type]
  const rate = pricing[c.type] * (t.unit === "day" ? c.days : 1)
  const win = campaignDates(c, now)
  const clashes = c.placements.filter((p) => {
    const others = all
      .filter((o) => o.id !== c.id && (o.status === "active" || o.status === "scheduled") && o.placements.includes(p))
      .filter((o) => {
        const w = campaignDates(o, now)
        return w.start <= win.end && w.end >= win.start
      })
    return others.length >= placementRules[p].maxPerView
  })
  return [
    { label: "Sponsored label on every placement", ok: true },
    { label: target.startsWith("p_") ? "Product is published" : "Destination is live", ok: destinationOk, detail: destinationOk ? undefined : "The promoted page isn't published yet." },
    { label: "Brand is verified", ok: !!brand?.verified, detail: brand?.verified ? undefined : "Verification is still in review." },
    { label: "Slot is free for these dates", ok: clashes.length === 0, detail: clashes.length ? `${placementRules[clashes[0]].name} is fully booked.` : undefined },
    { label: "Booked at the rate card price", ok: rate === c.budget, detail: rate === c.budget ? undefined : `Booked at ${usd(c.budget)}; today's rate is ${usd(rate)}. The brand keeps the price it booked.` },
    { label: "No second approver needed", ok: !needsSecond(c), detail: needsSecond(c) ? `${secondApproverLabel}, so a second admin confirms the decision.` : undefined },
  ]
}

/** One business day to decide: the same words in the metric hint and the queue. */
export const DECIDE_WITHIN = "Decide within 1 business day"

function startLabel(days: number) {
  if (days < 0) return { text: "Start date passed", tone: "danger" as const }
  if (days === 0) return { text: "Starts today", tone: "attention" as const }
  if (days === 1) return { text: "Starts tomorrow", tone: "attention" as const }
  if (days === 2) return { text: "Starts in 2 days", tone: "attention" as const }
  return { text: `Starts in ${days} days`, tone: "muted" as const }
}

/**
 * A decision sent to a second admin: what it waits on, said plainly (this build has one admin
 * account), and the way back out, so the campaign is never stuck.
 */
function Waiting({ campaign, decision }: { campaign: Campaign; decision: Decision }) {
  // False when there's no waiting request to take back (already withdrawn, say in another tab).
  const withdraw = useAsyncAction(() => withdrawRequest(campaign, decision))
  async function onWithdraw() {
    if (!(await withdraw.run())) return
    // The approve and reject buttons come back in this card; focus the first of them.
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`#review-${campaign.id} [data-decide]`)?.focus())
  }
  return (
    <div className="mt-3 border-t border-[var(--admin-hairline)] pt-3 @5xl:mt-auto">
      <p className="flex items-start gap-2 text-[12px] text-ink">
        <Users className="mt-0.5 size-3.5 shrink-0 text-violet" aria-hidden />
        <span>
          Waiting for a second admin to {decision === "active" ? "approve" : "reject"} it.
          <span className="mt-0.5 block text-[11px] leading-snug text-ink-3">
            You sent it, so you can&apos;t confirm it yourself. Another admin confirms from their own sign-in once multiple admin accounts are connected; until then it stays in review.
          </span>
        </span>
      </p>
      <Button size="sm" variant="secondary" className="mt-3 h-10 w-full sm:h-8" loading={withdraw.pending} onClick={() => void onWithdraw()} aria-label={`Withdraw the request for ${campaign.name}`}>
        <ArrowUUpLeftIcon aria-hidden /> Withdraw request
      </Button>
    </div>
  )
}

function Fact({ label, children, title }: { label: string; children: React.ReactNode; title?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-ink-3">{label}</dt>
      <dd className="mt-0.5 truncate text-[13px] text-ink tabular" title={title}>{children}</dd>
    </div>
  )
}

/**
 * Campaigns waiting for a decision, soonest start first: the creative exactly as shoppers will
 * see it (always labelled Sponsored), what was booked, the pre-flight checks, and the decision.
 */
export function ReviewQueue({ campaigns, ready, onDecide }: { campaigns: Campaign[]; ready: boolean; onDecide: (c: Campaign, d: Decision) => void }) {
  const pricing = useAdmin((s) => s.pricing)
  const audit = useAdmin((s) => s.audit)
  const queue = useMemo(() => campaigns.filter((c) => c.status === "in_review").sort((a, b) => a.startDaysFromToday - b.startDaysFromToday), [campaigns])
  const requested = useRequested(queue)
  const recent = useMemo(() => audit.filter((a) => DECISION_ACTIONS.includes(a.action)).slice(0, 3), [audit])
  // Dates are the brand's calendar days from today, as Studio and the merchant's notification give
  // them ("Starts tomorrow" counts from the same day). The queue renders once the store has loaded.
  const now = useNow(60_000)
  const shown = ready && now !== null

  return (
    <Panel
      id="review-queue"
      title="Review queue"
      description={`${DECIDE_WITHIN}. Anything that starts within 48 hours is marked, and the brand sees the reason for every rejection.`}
      action={ready ? <StatusBadge tone={queue.length ? "attention" : "muted"}>{queue.length ? `${queue.length} to review` : "Clear"}</StatusBadge> : <Bone className="h-6 w-20 rounded-[5px]" />}
      className="scroll-mt-24 rounded-[20px]"
      bodyClassName="px-0 pb-0 md:px-0 md:pb-0"
    >
      {!shown ? (
        <div aria-hidden className="grid grid-cols-[104px_minmax(0,1fr)] gap-4 border-t border-[var(--admin-hairline)] p-4 sm:grid-cols-[148px_minmax(0,1fr)] md:px-5 @5xl:grid-cols-[176px_minmax(0,1fr)_320px]">
          <Bone className="aspect-[4/5] w-full rounded-lg" />
          <div className="grid content-start gap-3">
            <Bone className="h-3 w-24" />
            <Bone className="h-5 w-48 max-w-full" />
            <Bone className="mt-2 h-12 w-full" />
          </div>
          <Bone className="col-span-2 h-56 w-full rounded-[10px] sm:col-span-1" />
        </div>
      ) : (
        <ul className="admin-divide border-t border-[var(--admin-hairline)]">
          <AnimatePresence initial={false} mode="popLayout">
            {queue.map((c, i) => {
              const t = campaignTypes[c.type]
              const brand = brandById.get(c.brandId)
              const win = campaignDates(c, now)
              const start = startLabel(c.startDaysFromToday)
              const checks = checksFor(c, campaigns, pricing, now)
              const failing = checks.filter((x) => !x.ok).length
              const sent = requested.get(c.id)
              return (
                <motion.li
                  key={c.id}
                  id={`review-${c.id}`}
                  layout
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: 16, transition: { duration: 0.16 } }}
                  transition={spring.layout}
                  className="grid scroll-mt-24 grid-cols-[96px_minmax(0,1fr)] content-start gap-x-3 gap-y-4 p-4 sm:grid-cols-[148px_minmax(0,1fr)] sm:grid-rows-[auto_auto_1fr] sm:gap-x-4 md:px-5 @5xl:grid-cols-[176px_minmax(0,1fr)_320px] @5xl:grid-rows-[auto_1fr] @5xl:gap-x-6"
                >
                  {/* Phones: the creative and title side by side, then the facts and checks full width.
                      Wider: the creative holds the first column; on the widest, checks take a third. */}
                  <CreativePreview campaign={c} eager={i === 0} className="w-full sm:row-span-3 @5xl:row-span-2" sizes="(min-width: 1280px) 176px, (min-width: 640px) 148px, 96px" />
                  <div className="flex min-w-0 flex-col items-start gap-2 @xl:flex-row @xl:flex-wrap @xl:justify-between">
                    <div className="min-w-0">
                      <p className="text-[11px] text-ink-3">{brand?.name ?? "Unknown brand"}</p>
                      <h3 className="font-label mt-1 text-[15px] leading-snug text-ink">{c.name}</h3>
                    </div>
                    <StatusBadge tone={start.tone}>{start.text}</StatusBadge>
                  </div>

                  <div className="col-span-2 min-w-0 sm:col-span-1 sm:col-start-2">
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-3 sm:gap-x-4">
                      <Fact label="Type">{t.name}</Fact>
                      <Fact label="Budget">
                        {usd(c.budget)} <span className="text-ink-3">for {c.days} {c.days === 1 ? "day" : "days"}</span>
                      </Fact>
                      <Fact label="Dates">{formatRange(`${win.start}T12:00:00Z`, `${win.end}T12:00:00Z`)}</Fact>
                      <Fact label="Audience" title={audienceLabel(c)}>{audienceLabel(c)}</Fact>
                    </dl>

                    <div className="mt-4">
                      <p className="text-[11px] text-ink-3">Placements</p>
                      <ul className="mt-1.5 flex flex-wrap gap-1.5">
                        {c.placements.map((p) => (
                          <li key={p} className="inline-flex h-6 items-center rounded-full border border-[var(--admin-hairline-strong)] px-2.5 text-[11px] text-ink-2">
                            {placementRules[p].name}, position {placementRules[p].positions.join(" or ")}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <div className="admin-inset col-span-2 flex min-w-0 flex-col p-3 sm:col-span-1 sm:col-start-2 @5xl:col-start-3 @5xl:row-span-2 @5xl:row-start-1">
                    <p className={cn("text-[12px]", failing ? "text-acid" : "text-ink-2")}>{failing ? `${failing} ${failing === 1 ? "check needs" : "checks need"} a look` : "All checks passed"}</p>
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
                      <Waiting campaign={c} decision={sent} />
                    ) : (
                      <div className="mt-3 grid grid-cols-2 gap-2 border-t border-[var(--admin-hairline)] pt-3 @5xl:mt-auto">
                        <Button size="sm" variant="secondary" data-decide className="h-10 sm:h-8" onClick={() => onDecide(c, "active")} aria-label={`Approve ${c.name}`}>
                          <Check aria-hidden /> Approve
                        </Button>
                        <Button size="sm" variant="destructive" className="h-10 sm:h-8" onClick={() => onDecide(c, "rejected")} aria-label={`Reject ${c.name}`}>
                          <XIcon aria-hidden /> Reject
                        </Button>
                      </div>
                    )}
                  </div>
                </motion.li>
              )
            })}
          </AnimatePresence>
        </ul>
      )}
      {ready && queue.length === 0 ? (
        <div className="px-4 pb-4 md:px-5">
          <EmptyState icon={Megaphone} title="Review queue clear" body="New campaigns land here as soon as a brand books a slot. Nothing is waiting on you." className="py-10" />
        </div>
      ) : null}
      {ready && recent.length ? (
        <div className="border-t border-[var(--admin-hairline)] px-4 py-3 md:px-5">
          <p className="text-[11px] text-ink-3">Recent decisions</p>
          <ul className="mt-1 admin-divide">
            <AnimatePresence initial={false}>
              {recent.map((a) => {
                const approved = a.action.startsWith("Approved")
                const when = recordTime(a.at, now)
                return (
                  <motion.li key={a.id} layout initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={springs.pill} className="grid gap-x-3 gap-y-0.5 py-2 text-[12px] sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-baseline">
                    <span className="flex min-w-0 items-center gap-2">
                      <StatusBadge tone={approved ? "success" : "danger"}>{approved ? (a.action.includes("scheduled") ? "Approved, scheduled" : "Approved") : "Rejected"}</StatusBadge>
                      <span className="min-w-0 truncate text-ink sm:hidden">{a.target}</span>
                    </span>
                    <span className="hidden min-w-0 truncate text-ink sm:block">
                      {a.target}
                      {a.reason ? <span className="text-ink-3">. {a.reason}</span> : null}
                    </span>
                    <span className="text-[11px] text-ink-3" title={when.title}>
                      {a.actor}, {when.label.toLowerCase()}
                    </span>
                    {a.reason ? <span className="truncate text-[11px] text-ink-3 sm:hidden">{a.reason}</span> : null}
                  </motion.li>
                )
              })}
            </AnimatePresence>
          </ul>
        </div>
      ) : null}
    </Panel>
  )
}
