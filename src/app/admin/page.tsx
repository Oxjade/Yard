"use client"

import { useId, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AnimatePresence, motion } from "motion/react"
import { toast } from "sonner"
import {
  SealCheckIcon as BadgeCheck,
  MoneyIcon as Banknote,
  ChartLineUpIcon,
  CoinsIcon,
  FlagIcon as Flag,
  HourglassIcon,
  MegaphoneIcon as Megaphone,
  ArrowCounterClockwiseIcon as RotateCcw,
  ShoppingCartIcon,
} from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { SampleDataNote } from "@/components/dashboard/page-header"
import { ArrowLink } from "@/components/dashboard/insight/arrow-link"
import { BarChart, type BarDatum } from "@/components/dashboard/insight/bar-chart"
import { CountUp } from "@/components/dashboard/insight/count-up"
import { addDays, buckets, change, longDate, periodWindows, rangeLabel, shortDate, slices, today, weekdayByWeek, weekdays, type Bucket } from "@/components/dashboard/insight/derive"
import { DeltaChip } from "@/components/dashboard/insight/delta-chip"
import { DonutChart, type DonutSegment } from "@/components/dashboard/insight/donut-chart"
import { Heatmap, PeakSwatch } from "@/components/dashboard/insight/heatmap"
import { InsightCard, InsightEmphasis } from "@/components/dashboard/insight/insight-card"
import { Segmented as Switch } from "@/components/dashboard/insight/segmented"
import { SignalList } from "@/components/dashboard/insight/signal-list"
import { StatCard } from "@/components/dashboard/insight/stat-card"
import { useEntrance } from "@/components/dashboard/insight/use-entrance"
import { RingGauge } from "@/components/admin/ui/gauge"
import { Reveal, RevealItem, springs } from "@/components/admin/ui/motion"
import { Panel } from "@/components/admin/ui/panel"
import { ReasonDialog } from "@/components/admin/ui/reason-dialog"
import { notifyRefundDecision, refundAudience } from "@/components/admin/marketplace/notify"
import { Segmented, segmentedTabId } from "@/components/admin/ui/segmented"
import { useHydrated } from "@/hooks/use-hydrated"
import { chartEasing, chartIn } from "@/lib/motion"
import { adminUser, failedJobs, healthServices, platformOverview, transactions, webhookFailures, type Refund } from "@/lib/data/admin"
import { campaignTypes, type CampaignType } from "@/lib/data/ads"
import { merchantOrders } from "@/lib/data/orders"
import { convert, formatMoney, formatNumber, formatPercent } from "@/lib/money"
import { useAdmin } from "@/lib/stores/admin"
import { cn } from "@/lib/utils"

const usd = (n: number) => formatMoney(Math.round(n), "USD", { compact: true })
const usdFull = (n: number) => formatMoney(Math.round(n), "USD")
/** Whole dollars, for headline figures where cents are noise. */
const usdWhole = (n: number) => formatMoney(Math.round(n / 100) * 100, "USD")
const int = (n: number) => formatNumber(Math.round(n))

type Period = "7d" | "30d" | "90d"
const periodDays: Record<Period, number> = { "7d": 7, "30d": 30, "90d": 90 }

/** p95 latency targets per service, the same ones the Health page measures against. */
const latencyTarget: Record<string, number> = { API: 400, "Database (primary)": 50, Search: 200, "Media storage": 300, "Background jobs": 1_500, "Payment webhooks": 800 }
/** Audit actions the Health page records when an engineer retries a job or replays a webhook. */
const RETRY_ACTION = "Retried background job"
const REPLAY_ACTION = "Replayed webhook"

/** The chips lift and press as one element with the link, so each chip is a single tab stop. */
const MotionLink = motion.create(Link)

/**
 * Every brand's sample orders per day, in USD cents: GMV and order count for every order that
 * was not cancelled, and commission only on sales that stand (refunds reverse it), so the
 * commission card, the volume chart and the revenue mix all add up to the same figures.
 */
function platformDaily(days: number) {
  const byDate = new Map<string, { gmv: number; orders: number; commission: number }>()
  for (const o of merchantOrders) {
    if (o.status === "cancelled") continue
    const date = o.placedAt.slice(0, 10)
    const e = byDate.get(date) ?? { gmv: 0, orders: 0, commission: 0 }
    e.gmv += convert(o.total, o.currency, "USD")
    e.orders += 1
    if (o.status !== "refunded") e.commission += convert(o.commission, o.currency, "USD")
    byDate.set(date, e)
  }
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(today, i - days + 1)
    return { date, ...(byDate.get(date) ?? { gmv: 0, orders: 0, commission: 0 }) }
  })
}

function relTime(iso: string) {
  const mins = Math.round((new Date(`${today}T12:00:00Z`).getTime() - new Date(iso).getTime()) / 60000)
  if (mins < 60) return "Just now"
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`
  const d = Math.round(mins / 1440)
  return d === 1 ? "Yesterday" : `${d} days ago`
}

/* ── Command strip: who, when, and what needs a decision ─────────────── */

function CommandStrip() {
  const hydrated = useHydrated()
  const pendingBrands = useAdmin((s) => s.applications.filter((a) => a.status === "pending_review").length)
  const refunds = useAdmin((s) => s.refunds.filter((r) => r.status === "requested").length)
  const payouts = useAdmin((s) => s.payouts.filter((p) => p.status === "awaiting_approval" || p.status === "held").length)
  const campaigns = useAdmin((s) => s.campaigns.filter((c) => c.status === "in_review").length)
  const moderation = useAdmin((s) => s.moderation.filter((m) => m.status === "open" || m.status === "escalated").length)
  // The greeting follows the viewer's clock; the date is the sample data's today, the day every figure on the page counts up to.
  const hour = hydrated ? new Date().getHours() : 12
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"
  const chips = [
    { href: "/admin/brands", label: "Brands to review", count: pendingBrands, icon: BadgeCheck },
    { href: "/admin/finance?tab=payouts", label: "Payouts to approve", count: payouts, icon: Banknote },
    { href: "/admin/finance?tab=refunds", label: "Refund requests", count: refunds, icon: RotateCcw },
    { href: "/admin/advertising", label: "Campaigns in review", count: campaigns, icon: Megaphone },
    { href: "/admin/products", label: "Listings flagged", count: moderation, icon: Flag },
  ]
  const total = chips.reduce((s, c) => s + c.count, 0)

  return (
    <RevealItem as="section" aria-labelledby="cc-title" className="admin-panel overflow-hidden rounded-[20px]">
      <div className="relative grid gap-6 p-5 md:p-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <SampleDataNote />
            <span className="text-[12px] text-ink-3 tabular">{longDate(today)}</span>
          </div>
          <h1 id="cc-title" className="font-label mt-4 text-[clamp(1.5rem,2.6vw,2rem)] leading-tight text-ink">
            {hydrated ? `${greeting}, ${adminUser.name.split(" ")[0]}` : `Welcome back, ${adminUser.name.split(" ")[0]}`}
          </h1>
          <p className="mt-2 min-h-5 max-w-xl text-[13px] leading-relaxed text-ink-2">
            {hydrated ? (total ? `${total} ${total === 1 ? "decision is" : "decisions are"} waiting on the platform team.` : "Nothing is waiting on a decision.") : <span aria-hidden className="skeleton inline-block h-3.5 w-72 max-w-full rounded align-middle" />}
          </p>
        </div>
        {/* Five chips: one row on wide screens, three over two at medium widths (on a six-column
            grid, so both rows fill the width), two columns with the last chip spanning both on
            small ones, and one column on phones. */}
        <nav aria-label="Needs a decision" className="grid grid-cols-1 gap-2 @lg:grid-cols-2 @2xl:grid-cols-6 @5xl:grid-cols-5">
          {chips.map((c, i) => (
            <MotionLink
              key={c.label}
              href={c.href}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.97 }}
              transition={springs.tactile}
              className={cn(
                "group flex h-12 w-full items-center gap-2.5 rounded-xl border pr-2 pl-3 text-[12.5px] transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet @5xl:col-span-1",
                i < 3 ? "@2xl:col-span-2" : i === 3 ? "@2xl:col-span-3" : "@lg:col-span-2 @2xl:col-span-3",
                hydrated && c.count ? "border-[var(--admin-hairline-strong)] bg-white/[0.03] text-ink hover:border-acid/50" : "border-[var(--admin-hairline)] text-ink-2 hover:text-ink",
              )}
            >
              <c.icon className="size-4 shrink-0 text-ink-3 transition-colors group-hover:text-ink" />
              <span className="min-w-0 truncate">{c.label}</span>
              {hydrated ? (
                <span className={cn("ml-auto inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full border px-1.5 text-[12px] font-semibold tabular", c.count ? "border-acid/45 text-acid" : "border-white/10 text-ink-3")}>{c.count}</span>
              ) : (
                <span aria-hidden className="skeleton ml-auto inline-block h-6 w-6 shrink-0 rounded-full" />
              )}
            </MotionLink>
          ))}
        </nav>
      </div>
    </RevealItem>
  )
}

/* ── Decision queue: the work, with the actions inline ──────────────── */

/** Who hears that a refund is approved, in Finance's words (the shopper when the order is theirs, the Studio brand). */
function approvalAudience(r: Refund) {
  const { shopper, merchant } = refundAudience(r)
  if (!shopper && !merchant) return ""
  const who = shopper && merchant ? `${r.customer} and ${r.brandName} are notified` : shopper ? `${r.customer} is notified in their account` : `${r.brandName} is notified in Studio`
  return ` ${who} that it's approved; your reason stays in the audit log.`
}

const ordersText = (n: number) => `${formatNumber(n)} ${n === 1 ? "order" : "orders"}`

type QueueTab = "brands" | "payouts" | "refunds" | "campaigns" | "moderation"

function DecisionQueue({ className }: { className?: string }) {
  const router = useRouter()
  const hydrated = useHydrated()
  const qid = useId()
  const tabsRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  // The button that opened the dialog, so focus can go back to it (see restoreFocus).
  const opener = useRef<HTMLElement | null>(null)
  const [tab, setTab] = useState<QueueTab>("payouts")
  const [confirm, setConfirm] = useState<null | { kind: "payout-approve" | "payout-release" | "refund-approve"; id: string; title: string; description: string; label: string }>(null)
  const applications = useAdmin((s) => s.applications)
  const payouts = useAdmin((s) => s.payouts)
  const refunds = useAdmin((s) => s.refunds)
  const campaigns = useAdmin((s) => s.campaigns)
  const moderation = useAdmin((s) => s.moderation)
  const setPayoutStatus = useAdmin((s) => s.setPayoutStatus)
  const setRefundStatus = useAdmin((s) => s.setRefundStatus)

  const lists = {
    brands: applications.filter((a) => a.status === "pending_review"),
    // Only payouts that need a person: awaiting approval first, then held. Scheduled ones go out on their own.
    payouts: payouts
      .filter((p) => p.status === "awaiting_approval" || p.status === "held")
      .sort((a, b) => (a.status === b.status ? 0 : a.status === "awaiting_approval" ? -1 : 1))
      .slice(0, 6),
    refunds: refunds.filter((r) => r.status === "requested").slice(0, 6),
    campaigns: campaigns.filter((c) => c.status === "in_review"),
    moderation: moderation.filter((m) => m.status === "open" || m.status === "escalated"),
  }
  // Tab counts are the whole queue, not the six rows shown, so they agree with the command strip.
  const totals: Record<QueueTab, number> = {
    brands: lists.brands.length,
    payouts: payouts.filter((p) => p.status === "awaiting_approval" || p.status === "held").length,
    refunds: refunds.filter((r) => r.status === "requested").length,
    campaigns: lists.campaigns.length,
    moderation: lists.moderation.length,
  }
  const count = (k: QueueTab) => totals[k]
  const scheduled = payouts.filter((p) => p.status === "scheduled").length

  function ask(e: React.MouseEvent<HTMLElement>, c: NonNullable<typeof confirm>) {
    opener.current = e.currentTarget
    setConfirm(c)
  }

  // The dialog has no Radix Trigger to return to, so focus is placed here: back on the button
  // that opened it, or, when the decision removed that row, on the next decision or the tab.
  function restoreFocus(e: Event) {
    e.preventDefault()
    const next = opener.current?.isConnected
      ? opener.current
      : (panelRef.current?.querySelector<HTMLElement>("li button:not([disabled])") ?? tabsRef.current?.querySelector<HTMLElement>('[aria-selected="true"]'))
    next?.focus()
  }

  const rows: { id: string; title: string; meta: string; amount?: string; badge?: { text: string; tone: "acid" | "danger" | "muted" | "purple" }; action: React.ReactNode }[] =
    tab === "brands"
      ? lists.brands.map((a) => ({ id: a.id, title: a.brandName, meta: `${a.country}, ${a.products} products, KYC ${a.kyc.replace("_", " ")}`, badge: { text: `${a.risk} risk`, tone: a.risk === "high" ? "danger" : a.risk === "medium" ? "acid" : "muted" }, action: <Button size="xs" className="h-10 px-3.5 sm:h-7 sm:px-2.5" variant="secondary" onClick={() => router.push("/admin/brands")}>Review</Button> }))
      : tab === "payouts"
        ? lists.payouts.map((p) => ({
            id: p.id,
            title: p.brandName,
            meta: p.status === "held" ? `Held: ${p.holdReason}` : p.orders ? `${p.method}, ${ordersText(p.orders)}` : p.method,
            amount: usdFull(p.amountUsd),
            badge: { text: p.status.replace("_", " "), tone: p.status === "held" ? "danger" : p.status === "awaiting_approval" ? "acid" : "purple" },
            action:
              p.status === "awaiting_approval" ? (
                <Button size="xs" className="h-10 px-3.5 sm:h-7 sm:px-2.5" variant="primary" onClick={(e) => ask(e, { kind: "payout-approve", id: p.id, title: `Approve the payout to ${p.brandName}?`, description: `${usdFull(p.amountUsd)}${p.currency !== "USD" ? ` (${formatMoney(p.amount, p.currency)})` : ""} via ${p.method}. Approval is recorded with your name. No payments provider is connected in this build, so the transfer isn't sent; the payout shows Approval recorded and is marked completed only when a provider confirms it.`, label: "Approve payout" })}>Approve</Button>
              ) : (
                <Button size="xs" className="h-10 px-3.5 sm:h-7 sm:px-2.5" variant="secondary" onClick={(e) => ask(e, { kind: "payout-release", id: p.id, title: `Release the payout to ${p.brandName}?`, description: `It goes back on the schedule.${p.holdReason ? ` It was held because: ${p.holdReason}` : ""} Release it only once the reason is resolved.`, label: "Release payout" })}>Release</Button>
              ),
          }))
        : tab === "refunds"
          ? lists.refunds.map((r) => ({
              id: r.id,
              title: `#${r.reference}, ${r.brandName}`,
              meta: `${r.customer}: ${r.reason}`,
              amount: usdFull(r.amountUsd),
              action: <Button size="xs" className="h-10 px-3.5 sm:h-7 sm:px-2.5" variant="secondary" onClick={(e) => ask(e, { kind: "refund-approve", id: r.id, title: `Approve the ${usdFull(r.amountUsd)} refund for #${r.reference}?`, description: `${r.customer} asked for it: ${r.reason.toLowerCase()}. Approval is recorded with idempotency key ${r.idempotencyKey}, so a retry can never refund twice. No payments provider is connected in this build, so nothing is sent and no money moves yet; the brand's share and the 5% commission reverse when the provider confirms.${approvalAudience(r)} To decline with a reason, use Finance.`, label: "Approve refund" })}>Approve</Button>,
            }))
          : tab === "campaigns"
            ? lists.campaigns.map((c) => ({ id: c.id, title: c.name, meta: `${campaignTypes[c.type].name}, ${c.days} days`, amount: usdFull(c.budget), badge: { text: "in review", tone: "acid" }, action: <Button size="xs" className="h-10 px-3.5 sm:h-7 sm:px-2.5" variant="secondary" onClick={() => router.push("/admin/advertising")}>Review</Button> }))
            : lists.moderation.map((m) => ({ id: m.id, title: m.title, meta: `${m.brandName}: ${m.reportedBy}`, badge: { text: m.reason.replace("_", " "), tone: m.reason === "counterfeit" || m.reason === "ip_complaint" ? "danger" : "acid" }, action: <Button size="xs" className="h-10 px-3.5 sm:h-7 sm:px-2.5" variant="secondary" onClick={() => router.push("/admin/products")}>Open</Button> }))

  const badgeTone = { acid: "border-acid/45 text-acid", danger: "border-danger/45 text-danger", muted: "border-white/10 text-ink-3", purple: "border-purple bg-purple/20 text-ink" }

  // The same store actions and words as Finance: an approval is recorded, never sent or paid here.
  function run(reason: string) {
    if (!confirm) return
    const state = useAdmin.getState()
    if (confirm.kind === "refund-approve") {
      const r = state.refunds.find((x) => x.id === confirm.id)
      if (!r || r.status !== "requested") return void toast.info("This refund has already been decided, so nothing was approved.")
      setRefundStatus(r.id, "approved", reason)
      notifyRefundDecision(r, "approved", reason)
      toast.success(`Refund for #${r.reference} approved`, { description: "Approval recorded. Not sent: no payments provider in this build." })
      return
    }
    const p = state.payouts.find((x) => x.id === confirm.id)
    const from = confirm.kind === "payout-approve" ? "awaiting_approval" : "held"
    if (!p || p.status !== from) return void toast.info(`This payout isn't ${from === "held" ? "held" : "awaiting approval"} any more, so nothing changed.`)
    if (confirm.kind === "payout-approve") {
      setPayoutStatus(p.id, "processing", reason)
      toast.success(`Approval recorded for the payout to ${p.brandName}`, { description: "Approval recorded. Nothing is sent until a payments provider is connected." })
    } else {
      setPayoutStatus(p.id, "scheduled", reason)
      toast.success(`Payout to ${p.brandName} released`, { description: "Recorded in the audit log with your reason." })
    }
  }

  return (
    // The sidebar's "Decisions waiting" card links here; scroll-mt-24 clears the sticky top bar.
    // A flex column, so when the row is taller than the queue the footer sits on the bottom edge.
    <Panel
      id="decision-queue"
      title="Decision queue"
      description="Work that needs a person. Every action asks for a reason and lands in the audit log."
      className={cn("flex scroll-mt-24 flex-col rounded-[20px]", className)}
      bodyClassName="flex flex-1 flex-col px-0 pb-0 md:px-0 md:pb-0"
    >
      <div ref={tabsRef} className="rail shrink-0 overflow-x-auto px-4 pb-3 md:px-5">
        <Segmented
          label="Queue"
          size="sm"
          value={tab}
          onChange={setTab}
          loading={!hydrated}
          idBase={qid}
          panelId={`${qid}-panel`}
          options={[
            { value: "payouts", label: "Payouts", count: count("payouts") },
            { value: "refunds", label: "Refunds", count: count("refunds") },
            { value: "brands", label: "Brands", count: count("brands") },
            { value: "campaigns", label: "Campaigns", count: count("campaigns") },
            { value: "moderation", label: "Moderation", count: count("moderation") },
          ]}
        />
      </div>
      <div ref={panelRef} id={`${qid}-panel`} role="tabpanel" aria-labelledby={segmentedTabId(qid, tab)} className="flex min-h-52 flex-1 flex-col border-t border-[var(--admin-hairline)]">
        {/* Rows are held at 65px, so the skeleton (one row per queued item) and the list match. */}
        {!hydrated ? (
          <ul aria-hidden className="admin-divide">
            {Array.from({ length: Math.max(1, rows.length) }, (_, i) => (
              <li key={i} className="flex h-[65px] items-center gap-3 px-4 md:px-5">
                <span className="grid flex-1 gap-1.5">
                  <span className="skeleton h-3.5 w-1/3 rounded" />
                  <span className="skeleton h-3 w-1/2 rounded" />
                </span>
                <span className="skeleton h-10 w-[4.5rem] rounded-md sm:h-7" />
              </li>
            ))}
          </ul>
        ) : (
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={springs.pill} className="flex flex-1 flex-col">
              <ul className={cn("admin-divide", rows.length === 0 && "flex flex-1 flex-col")}>
                {rows.length === 0 ? (
                  <li className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
                    <p className="text-[13px] text-ink">Queue clear</p>
                    <p className="mt-1 text-[12px] text-ink-2">Nothing here needs a decision right now.</p>
                  </li>
                ) : (
                  rows.map((r) => (
                    <motion.li key={r.id} layout transition={springs.pill} className="group flex min-h-[65px] items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.02] md:px-5">
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <p className="min-w-0 truncate text-[13px] text-ink">{r.title}</p>
                          {r.badge ? <span className={cn("inline-flex h-5 shrink-0 items-center rounded-full border px-2 text-[10.5px] font-medium whitespace-nowrap", badgeTone[r.badge.tone])}>{r.badge.text.charAt(0).toUpperCase() + r.badge.text.slice(1)}</span> : null}
                        </div>
                        <p className="mt-0.5 truncate text-[12px] text-ink-3">
                          {r.amount ? <span className="mr-1.5 text-ink-2 tabular sm:hidden">{r.amount}</span> : null}
                          {r.meta}
                        </p>
                      </div>
                      {r.amount ? <p className="hidden text-[13px] text-ink tabular sm:block">{r.amount}</p> : null}
                      <div className="shrink-0 sm:flex sm:w-[4.5rem] sm:justify-end">{r.action}</div>
                    </motion.li>
                  ))
                )}
              </ul>
              {tab === "payouts" && scheduled ? (
                <p className="mt-auto border-t border-[var(--admin-hairline)] px-4 py-3 text-[12px] text-ink-3 md:px-5">
                  {scheduled === 1 ? "1 scheduled payout goes out on its own, with no decision needed." : `${scheduled} scheduled payouts go out on their own, with no decision needed.`}
                </p>
              ) : null}
            </motion.div>
          </AnimatePresence>
        )}
      </div>
      <ReasonDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)} title={confirm?.title ?? ""} description={confirm?.description ?? ""} confirmLabel={confirm?.label ?? "Confirm"} onConfirm={run} onCloseAutoFocus={restoreFocus} />
    </Panel>
  )
}

/* ── Audit trail: live, read-only ────────────────────────────────────── */

function AuditTrail({ className }: { className?: string }) {
  const hydrated = useHydrated()
  const audit = useAdmin((s) => s.audit)
  return (
    <Panel title="Audit trail" description="Every decision, who made it and why. Read-only." action={<ArrowLink href="/admin/security" label="Open the full audit log" />} className={cn("rounded-[20px]", className)}>
      <ol className="relative flex min-w-0 flex-col gap-0.5">
        <span className="absolute top-2 bottom-2 left-[15px] w-px bg-[var(--admin-hairline)]" aria-hidden />
        {!hydrated
          ? [0, 1, 2, 3, 4, 5].map((i) => (
              <li key={i} aria-hidden className="relative flex h-[56px] items-center gap-3 py-2 pr-2">
                <span className="skeleton relative z-10 size-[31px] shrink-0 rounded-full" />
                <span className="grid flex-1 gap-1.5">
                  <span className="skeleton h-3.5 w-2/3 rounded" />
                  <span className="skeleton h-3 w-1/2 rounded" />
                </span>
              </li>
            ))
          : null}
        <AnimatePresence initial={false}>
          {hydrated
            ? audit.slice(0, 6).map((a) => (
                <motion.li key={a.id} layout initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={springs.pill} className="relative flex min-h-[56px] gap-3 rounded-lg py-2 pr-2">
                  <span className="relative z-10 mt-0.5 inline-flex size-[31px] shrink-0 items-center justify-center rounded-full border border-[var(--admin-hairline-strong)] bg-[#0c0c0c] text-[10.5px] font-semibold text-ink">
                    {a.actor.split(" ").map((x) => x[0]).join("")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] text-ink" title={`${a.actor} ${a.action.charAt(0).toLowerCase() + a.action.slice(1)}`}>
                      <span className="text-ink">{a.actor}</span> <span className="text-ink-2">{a.action.charAt(0).toLowerCase() + a.action.slice(1)}</span>
                    </p>
                    <p className="mt-0.5 truncate text-[12px] text-ink-3" title={`${a.target}${a.reason ? `. ${a.reason}` : ""}`}>{a.target}{a.reason ? `. ${a.reason}` : ""}</p>
                  </div>
                  <span className="shrink-0 pt-0.5 text-[11px] text-ink-3 tabular">{relTime(a.at)}</span>
                </motion.li>
              ))
            : null}
        </AnimatePresence>
      </ol>
    </Panel>
  )
}

/* ── Insight: the most urgent real issue ─────────────────────────────── */

function AdminInsight({ className }: { className?: string }) {
  const hydrated = useHydrated()
  const audit = useAdmin((s) => s.audit)
  const payouts = useAdmin((s) => s.payouts)
  const refunds = useAdmin((s) => s.refunds)
  const moderation = useAdmin((s) => s.moderation)
  const applications = useAdmin((s) => s.applications)
  const campaigns = useAdmin((s) => s.campaigns)
  const retried = failedJobs.filter((j) => audit.some((a) => a.action === RETRY_ACTION && a.target.includes(j.id))).length
  const replayed = new Set(webhookFailures.filter((w) => audit.some((a) => a.action === REPLAY_ACTION && a.target.includes(w.id))).map((w) => w.id))
  const openJobs = failedJobs.length - retried
  const openHooks = webhookFailures.filter((w) => !w.replayable || !replayed.has(w.id)).length
  const degraded = healthServices.filter((s) => s.status !== "operational")
  const waiting = payouts.filter((p) => p.status === "awaiting_approval" || p.status === "held")

  if (degraded.length || openJobs || openHooks) {
    const svc = degraded[0]
    const open = [openJobs ? `${openJobs} failed ${openJobs === 1 ? "job" : "jobs"}` : null, openHooks ? `${openHooks} payment webhook ${openHooks === 1 ? "failure" : "failures"}` : null].filter(Boolean)
    const body = open.length
      ? `${open.join(" and ")} ${open.length > 1 || openJobs + openHooks > 1 ? "are" : "is"} open. Retries and replays are idempotent and land in the audit log.`
      : "No failed jobs or webhook failures are open."
    return (
      <InsightCard
        ready={hydrated}
        // A degraded service's title comes from static health data, so it is known on the server.
        titleReady={svc ? true : hydrated}
        className={className}
        pill="Needs an engineer"
        title={
          svc ? (
            <>
              {svc.name} {svc.name.endsWith("s") ? "are" : "is"} degraded with a <InsightEmphasis>{formatPercent(svc.errorRate, 1)} error rate</InsightEmphasis> at p95 {int(svc.latencyP95)} ms.
            </>
          ) : (
            <>
              <InsightEmphasis>{openJobs + openHooks}</InsightEmphasis> background failures are waiting for a retry or a replay.
            </>
          )
        }
        body={body}
        facts={[
          { label: "Failed jobs", value: int(openJobs) },
          { label: "Webhook failures", value: int(openHooks) },
        ]}
        action={{ href: "/admin/health", label: "Open health" }}
      />
    )
  }
  if (waiting.length) {
    const total = waiting.reduce((s, p) => s + p.amountUsd, 0)
    return (
      <InsightCard
        ready={hydrated}
        className={className}
        title={
          <>
            <InsightEmphasis>{usdFull(total)}</InsightEmphasis> in payouts is waiting on a decision.
          </>
        }
        body="A payout goes out only after a person approves or releases it, and only once a payments provider is connected."
        facts={[
          { label: "Awaiting approval", value: int(waiting.filter((p) => p.status === "awaiting_approval").length) },
          { label: "Held", value: int(waiting.filter((p) => p.status === "held").length) },
        ]}
        action={{ href: "/admin/finance?tab=payouts", label: "Open payouts" }}
      />
    )
  }
  // Then whichever other queue has work in it, in the order money and trust are at stake.
  const queues = [
    { count: refunds.filter((r) => r.status === "requested").length, one: "refund request is", many: "refund requests are", body: "Approvals are recorded with an idempotency key; nothing is sent until a payments provider is connected.", href: "/admin/finance?tab=refunds", label: "Open refunds" },
    { count: moderation.filter((m) => m.status === "open" || m.status === "escalated").length, one: "flagged listing is", many: "flagged listings are", body: "Reported listings stay live until someone reviews them.", href: "/admin/products", label: "Open moderation" },
    { count: applications.filter((a) => a.status === "pending_review").length, one: "brand application is", many: "brand applications are", body: "Brands can only start selling once their application is approved.", href: "/admin/brands", label: "Open brands" },
    { count: campaigns.filter((c) => c.status === "in_review").length, one: "campaign is", many: "campaigns are", body: "Campaigns go live only after a review.", href: "/admin/advertising", label: "Open advertising" },
  ]
  const next = queues.find((q) => q.count > 0)
  if (next) {
    return (
      <InsightCard
        ready={hydrated}
        className={className}
        title={
          <>
            <InsightEmphasis>{int(next.count)}</InsightEmphasis> {next.count === 1 ? next.one : next.many} waiting on a decision.
          </>
        }
        body={next.body}
        action={{ href: next.href, label: next.label }}
      />
    )
  }
  return (
    <InsightCard ready={hydrated} className={className} title="Every service is operational and every queue is clear." body="New decisions and incidents appear here as they arrive." action={{ href: "/admin/security", label: "Open the audit log" }} />
  )
}

/* ── Page ─────────────────────────────────────────────────────────────── */

/**
 * Each service's p95 latency against its target. The bars grow from the left the first time
 * the list is seen, with a short stagger (CSS, released by useEntrance): the server HTML
 * carries the final bars, so they show without JavaScript and under reduced motion.
 */
function LatencyBars() {
  const list = useEntrance<HTMLUListElement>()
  const last = healthServices.length - 1
  return (
    <ul ref={list} data-entrance="pending" className="grid gap-1">
      {healthServices.map((s, i) => {
        const target = latencyTarget[s.name] ?? 400
        const ratio = Math.min(1, s.latencyP95 / target)
        const bad = s.status !== "operational"
        const delay = last > 0 ? Math.round((i / last) * chartIn.stagger * 1000) : 0
        return (
          <li key={s.name} className="rounded-lg px-2 py-2 transition-colors hover:bg-white/[0.02]">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-[12.5px] text-ink">
                <span className={cn("inline-flex size-2 rounded-full", bad ? "bg-acid" : "bg-violet")} aria-hidden />
                {s.name}
                {bad ? <span className="sr-only">(degraded)</span> : null}
              </span>
              <span className="text-[11px] text-ink-3 tabular">p95 {int(s.latencyP95)} ms, {formatPercent(s.uptime, 2)} up</span>
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                data-grow
                className={cn("h-full origin-left rounded-full", bad ? "bg-acid" : "bg-purple")}
                style={{ transform: `scaleX(${Math.max(0.04, ratio)})`, transition: `transform ${chartIn.duration * 1000}ms ${chartEasing} ${delay}ms` }}
              />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

export default function AdminOverviewPage() {
  const hydrated = useHydrated()
  const [period, setPeriod] = useState<Period>("30d")
  const [bucket, setBucket] = useState<Bucket>("daily")
  const payoutsState = useAdmin((s) => s.payouts)
  const campaignsState = useAdmin((s) => s.campaigns)
  const o = platformOverview()

  const series = useMemo(() => platformDaily(180), [])
  const sold = useMemo(() => merchantOrders.filter((m) => m.status !== "cancelled"), [])
  const historyStart = useMemo(() => sold.reduce((m, x) => (x.placedAt.slice(0, 10) < m ? x.placedAt.slice(0, 10) : m), today), [sold])

  const days = periodDays[period]
  const win = periodWindows(series, days, historyStart)
  const sum = (rows: typeof series, k: "gmv" | "orders" | "commission") => rows.reduce((s, r) => s + r[k], 0)
  const gmv = sum(win.current, "gmv")
  const orders = sum(win.current, "orders")
  const commission = sum(win.current, "commission")
  const gmvPrev = sum(win.previous, "gmv")
  const ordersPrev = sum(win.previous, "orders")
  const commissionPrev = sum(win.previous, "commission")
  const d = (a: number, b: number) => (win.comparable ? change(a, b) : null)
  const versus = `the ${days} days before`
  const hint = win.comparable ? `vs ${versus}` : `Order history starts ${shortDate(historyStart)}`

  const pending = payoutsState.filter((p) => p.status !== "paid")
  const pendingUsd = pending.reduce((s, p) => s + p.amountUsd, 0)
  const pendingBrands = new Set(pending.map((p) => p.brandId)).size
  const activeCampaigns = campaignsState.filter((c) => c.status === "active").length
  const inReview = campaignsState.filter((c) => c.status === "in_review").length

  /* Marketplace volume by bucket; windows end today, like the period above. */
  const spec = buckets[bucket]
  const bars: BarDatum[] = slices(series, spec.size, spec.count, historyStart).map((s) => {
    const value = sum(s.rows, "gmv")
    const n = sum(s.rows, "orders")
    return {
      key: s.from,
      // Three 30-day bars leave room for the whole range, so they never read as calendar months.
      label: bucket === "daily" ? shortDate(s.to) : bucket === "monthly" ? rangeLabel(s.from, s.to) : shortDate(s.from),
      fullLabel: bucket === "daily" ? longDate(s.to) : rangeLabel(s.from, s.to),
      value,
      delta: s.previous ? change(value, sum(s.previous, "gmv")) : null,
      meta: `${int(n)} ${n === 1 ? "order" : "orders"}, ${usd(sum(s.rows, "commission"))} commission`,
    }
  })
  const chartTotal = bars.reduce((t, b) => t + b.value, 0)
  const chartDays = spec.size * spec.count
  const chartPrev = series.slice(series.length - chartDays * 2, series.length - chartDays)
  const chartDelta = chartPrev.length === chartDays && chartPrev[0].date >= historyStart ? change(chartTotal, sum(chartPrev, "gmv")) : null

  /* Where platform revenue came from in the period: sales commission, and fixed-price ad
     placements by type, counted from the day each campaign started. */
  const mix: DonutSegment[] = (() => {
    const byType = new Map<CampaignType, number>()
    for (const c of campaignsState) {
      if (c.status !== "active" && c.status !== "completed") continue
      if (c.startDaysFromToday > 0 || c.startDaysFromToday <= -days) continue
      byType.set(c.type, (byType.get(c.type) ?? 0) + c.budget)
    }
    const ads = [...byType.entries()].sort((x, y) => y[1] - x[1])
    const top = ads.slice(0, 3).map(([t, v]) => ({ key: t, label: campaignTypes[t].name, value: v, href: "/admin/advertising" }))
    const rest = ads.slice(3).reduce((t, [, v]) => t + v, 0)
    return [{ key: "commission", label: "Sales commission", value: commission, href: "/admin/finance" }, ...top, ...(rest ? [{ key: "other-ads", label: `Other placements (${ads.length - 3})`, value: rest, href: "/admin/advertising" }] : [])]
  })()

  const heat = useMemo(() => weekdayByWeek(sold.map((x) => x.placedAt.slice(0, 10)), 13, historyStart), [sold, historyStart])
  const ordersUnit = (n: number) => `${n} ${n === 1 ? "order" : "orders"}`

  const charges = transactions.filter((t) => t.type === "charge")
  const byProvider = (["paystack", "flutterwave", "stripe"] as const).map((p) => ({ p, n: charges.filter((c) => c.provider === p).length, ok: charges.filter((c) => c.provider === p && c.status === "succeeded").length }))

  return (
    <Reveal ssrVisible className="@container grid gap-3">
      <CommandStrip />

      {/* Period */}
      <RevealItem className="flex flex-col gap-3 px-1 pt-3 @2xl:flex-row @2xl:items-end @2xl:justify-between">
        <div>
          <h2 className="font-label text-[15px] text-ink">Marketplace performance</h2>
          <p className="mt-1 text-[12px] text-ink-3">Every brand, in USD, over the last {days} days{win.comparable ? `, compared with ${versus}` : ""}.</p>
        </div>
        <Switch
          label="Period"
          value={period}
          onChange={setPeriod}
          options={[{ value: "7d", label: "7 days" }, { value: "30d", label: "30 days" }, { value: "90d", label: "90 days" }]}
          className="w-full @2xl:w-auto [&>button]:flex-1 @2xl:[&>button]:flex-none"
        />
      </RevealItem>

      {/* Headline metrics */}
      <section aria-label="Headline metrics" className="grid gap-3 @lg:grid-cols-2 @5xl:grid-cols-4">
        <RevealItem className="min-w-0">
          <StatCard surface="admin" icon={ChartLineUpIcon} label="GMV" value={gmv} format={usd} delta={d(gmv, gmvPrev)} deltaContext={versus} hint={hint} href="/admin/orders" hrefLabel="Open orders behind GMV" ready={hydrated} className="h-full" />
        </RevealItem>
        <RevealItem className="min-w-0">
          <StatCard surface="admin" icon={CoinsIcon} label="Commission earned" value={commission} format={usd} delta={d(commission, commissionPrev)} deltaContext={versus} hint="5% of sales not refunded" href="/admin/finance" hrefLabel="Open finance" ready={hydrated} className="h-full" />
        </RevealItem>
        <RevealItem className="min-w-0">
          <StatCard surface="admin" icon={ShoppingCartIcon} label="Orders" value={orders} format={int} delta={d(orders, ordersPrev)} deltaContext={versus} hint={`${int(series[series.length - 1].orders)} today`} href="/admin/orders" hrefLabel="Open orders" ready={hydrated} className="h-full" />
        </RevealItem>
        <RevealItem className="min-w-0">
          <StatCard surface="admin" variant="brand" icon={HourglassIcon} label="Pending payouts" value={pendingUsd} format={usd} hint={hydrated ? `To ${pendingBrands} ${pendingBrands === 1 ? "brand" : "brands"}` : <span aria-hidden className="skeleton inline-block h-3 w-20 rounded align-middle" />} href="/admin/finance?tab=payouts" hrefLabel="Open payouts" ready={hydrated} className="h-full" />
        </RevealItem>
      </section>

      {/* Signals, volume, revenue mix */}
      <div className="grid gap-3 @xl:grid-cols-2 @5xl:grid-cols-12">
        {/* A flex column with equal rows, so the ledger fills the card when its neighbours are taller. */}
        <Panel title="Signal ledger" description={`Last ${days} days`} className="flex flex-col rounded-[20px] @5xl:col-span-3" bodyClassName="flex flex-1 flex-col">
          <SignalList
            className="flex-1 auto-rows-fr"
            ready={hydrated}
            deltaContext={versus}
            items={[
              { key: "aov", label: "Average order value", value: usdFull(orders ? gmv / orders : 0), delta: d(orders ? gmv / orders : 0, ordersPrev ? gmvPrev / ordersPrev : 0) },
              { key: "take", label: "Take rate", value: formatPercent(gmv ? commission / gmv : 0, 1), delta: d(gmv ? commission / gmv : 0, gmvPrev ? commissionPrev / gmvPrev : 0) },
              { key: "users", label: "Registered users", value: int(o.users) },
              { key: "products", label: "Live products", value: int(o.products), hint: `from ${o.brands} brands` },
              { key: "campaigns", label: "Active campaigns", value: int(activeCampaigns), hint: inReview ? `and ${inReview} in review` : undefined },
            ]}
          />
        </Panel>

        <Panel
          title="Marketplace volume"
          description={`GMV across every brand, ${spec.window}`}
          action={<ArrowLink href="/admin/orders" label="Open all orders" />}
          className="rounded-[20px] @xl:order-first @xl:col-span-2 @5xl:order-none @5xl:col-span-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <div className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1">
              {hydrated ? (
                <>
                  <p className="font-metric text-[2rem] leading-none text-ink">
                    <CountUp value={chartTotal} format={usdWhole} />
                  </p>
                  <DeltaChip value={chartDelta} context={`the ${spec.window.replace("last ", "")} before`} />
                </>
              ) : (
                <span aria-hidden className="skeleton block h-8 w-40 rounded-md" />
              )}
            </div>
            <Switch label="Bucket size" size="sm" value={bucket} onChange={setBucket} options={(Object.keys(buckets) as Bucket[]).map((b) => ({ value: b, label: buckets[b].label }))} />
          </div>
          <BarChart key={bucket} className="mt-4" data={bars} format={usd} formatFull={usdWhole} label={`GMV by ${bucket === "daily" ? "day" : bucket === "weekly" ? "week" : "30 days"}`} deltaContext={bucket === "daily" ? "the day before" : bucket === "weekly" ? "the week before" : "the 30 days before"} height={236} />
        </Panel>

        <Panel title="Revenue mix" description={`Platform revenue, last ${days} days`} action={<ArrowLink href="/admin/finance" label="Open revenue in finance" />} className="rounded-[20px] @5xl:col-span-3">
          <DonutChart segments={mix} format={usd} formatFull={usdFull} totalLabel="Revenue" label={`Platform revenue by source, last ${days} days`} emptyCentre="No revenue" />
          <p className="mt-4 text-[11.5px] leading-snug text-ink-3">Commission is 5% of sales that were not refunded. Ads count from the day a placement starts.</p>
        </Panel>
      </div>

      {/* Decisions and the audit log they write to */}
      <div className="grid gap-3 @5xl:grid-cols-12">
        <DecisionQueue className="@5xl:col-span-8" />
        <AuditTrail className="@5xl:col-span-4" />
      </div>

      {/* Insight + weekly rhythm */}
      <div className="grid gap-3 @2xl:grid-cols-2 @5xl:grid-cols-12">
        <RevealItem className="flex min-w-0 @5xl:col-span-4">
          <AdminInsight className="w-full" />
        </RevealItem>
        <Panel title="Orders by weekday" description="Every brand. Each square is a day, last 13 weeks" className="rounded-[20px] @5xl:col-span-8">
          <Heatmap
            rows={weekdays}
            columns={heat.columns}
            cells={heat.cells}
            unit={ordersUnit}
            label="Orders per day across every brand over the last 13 weeks"
            stats={[
              { label: "Busiest weekday", value: heat.busiestWeekday ? heat.busiestWeekday.name : "None yet" },
              { label: "Weekend share", value: heat.weekendShare === null ? "None yet" : formatPercent(heat.weekendShare, 0) },
              { label: "Most in a day", value: heat.max ? (heat.peak ? <><PeakSwatch />{ordersUnit(heat.max)} on {shortDate(heat.peak.date)}</> : `${ordersUnit(heat.max)} on ${heat.maxDays} days`) : "None yet" },
            ]}
          />
        </Panel>
      </div>

      {/* Health + payments */}
      <div className="grid gap-3 @2xl:grid-cols-2 @5xl:grid-cols-12">
        <Panel title="System health" description="Live service status, measured against each service's p95 target." className="rounded-[20px] @5xl:col-span-7" action={<ArrowLink href="/admin/health" label="Open system health" />}>
          <LatencyBars />
        </Panel>
        <Panel title="Payments" description="Success is counted only when the provider's webhook is verified." className="rounded-[20px] @5xl:col-span-5" action={<ArrowLink href="/admin/finance" label="Open payments in finance" />}>
          <div className="flex items-center gap-5">
            <RingGauge value={o.paymentSuccess} threshold={0.97} label="Payment success" sublabel="success" />
            <p className="min-w-0 flex-1 text-[12px] text-ink-2">Target 97% or better. Under it, the ring turns yellow and on-call is paged.</p>
          </div>
          <div className="mt-5 grid gap-2.5">
            {byProvider.map((p) => (
              <div key={p.p} className="admin-inset flex items-center justify-between gap-3 px-3 py-2">
                <span className="text-[12.5px] text-ink capitalize">{p.p}</span>
                <span className="flex items-center gap-3 text-[12px] tabular">
                  <span className="text-ink-3">{p.n} charges</span>
                  <span className={cn(p.n && p.ok / p.n < 0.97 ? "text-acid" : "text-ink")}>{p.n ? formatPercent(p.ok / p.n, 1) : "None"}</span>
                </span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </Reveal>
  )
}
