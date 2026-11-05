"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AnimatePresence, motion } from "motion/react"
import { toast } from "sonner"
import { AlertTriangle, ArrowUpRight, BadgeCheck, Banknote, Flag, Megaphone, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SampleDataNote } from "@/components/dashboard/page-header"
import { AdminAreaChart } from "@/components/admin/ui/area-chart"
import { RingGauge, SplitBar } from "@/components/admin/ui/gauge"
import { KpiCard, Sparkline } from "@/components/admin/ui/kpi"
import { Reveal, RevealItem, springs } from "@/components/admin/ui/motion"
import { Panel } from "@/components/admin/ui/panel"
import { ReasonDialog } from "@/components/admin/ui/reason-dialog"
import { Segmented } from "@/components/admin/ui/segmented"
import { useHydrated } from "@/hooks/use-hydrated"
import { adminUser, failedJobs, healthServices, platformOverview, transactions, webhookFailures } from "@/lib/data/admin"
import { campaignTypes } from "@/lib/data/ads"
import { platformDailyGmvUsd } from "@/lib/data/analytics"
import { rand } from "@/lib/data/seed"
import { formatMoney, formatNumber, formatPercent } from "@/lib/money"
import { useAdmin } from "@/lib/stores/admin"
import { cn } from "@/lib/utils"

const usd = (n: number) => formatMoney(Math.round(n), "USD", { compact: true })
const usdFull = (n: number) => formatMoney(Math.round(n), "USD")
const int = (n: number) => formatNumber(Math.round(n))

type Period = "7d" | "30d" | "90d"
const periodDays: Record<Period, number> = { "7d": 7, "30d": 30, "90d": 90 }

/** A gently rising sample series for counts we don't have daily history for. */
function growth(key: string, end: number, points = 30, spread = 0.12) {
  return Array.from({ length: points }, (_, i) => Math.round(end * (1 - spread + (spread * i) / (points - 1)) * (0.985 + rand(`${key}-${i}`) * 0.03)))
}

function relTime(iso: string) {
  const mins = Math.round((new Date("2026-11-05T12:00:00Z").getTime() - new Date(iso).getTime()) / 60000)
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
  const now = hydrated ? new Date() : null
  const hour = now?.getHours() ?? 12
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"
  const chips = [
    { href: "/admin/brands", label: "Brands to review", count: pendingBrands, icon: BadgeCheck },
    { href: "/admin/finance", label: "Payouts to approve", count: payouts, icon: Banknote },
    { href: "/admin/finance", label: "Refund requests", count: refunds, icon: RotateCcw },
    { href: "/admin/advertising", label: "Campaigns in review", count: campaigns, icon: Megaphone },
    { href: "/admin/products", label: "Listings flagged", count: moderation, icon: Flag },
  ]
  const total = chips.reduce((s, c) => s + c.count, 0)

  return (
    <RevealItem as="section" aria-labelledby="cc-title" className="admin-panel admin-panel-glow overflow-hidden">
      <div className="relative grid gap-6 p-5 md:p-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <SampleDataNote />
            <span className="text-[12px] text-ink-3 tabular">
              {now ? now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }) : " "}
            </span>
          </div>
          <h1 id="cc-title" className="font-label mt-4 text-[clamp(1.5rem,2.6vw,2rem)] leading-tight text-ink">
            {hydrated ? `${greeting}, ${adminUser.name.split(" ")[0]}` : `Welcome back, ${adminUser.name.split(" ")[0]}`}
          </h1>
          <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-ink-2">
            {hydrated ? (total ? `${total} decisions are waiting on the platform team. Everything else is running.` : "Nothing is waiting on you. Everything is running.") : " "}
          </p>
        </div>
        <nav aria-label="Needs a decision" className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {chips.map((c) => (
            <motion.div key={c.label} whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }} transition={springs.tactile}>
              <Link
                href={c.href}
                className={cn(
                  "group flex h-12 w-full items-center gap-2.5 rounded-[10px] border pr-2 pl-3 text-[12.5px] transition-colors duration-200",
                  hydrated && c.count ? "border-[var(--admin-hairline-strong)] bg-white/[0.03] text-ink hover:border-acid/50" : "border-[var(--admin-hairline)] text-ink-2 hover:text-ink",
                )}
              >
                <c.icon className="size-4 text-ink-3 transition-colors group-hover:text-ink" />
                {c.label}
                <span className={cn("ml-auto inline-flex h-6 min-w-6 items-center justify-center rounded-md px-1.5 text-[12px] font-semibold tabular", hydrated && c.count ? "bg-acid text-obsidian" : "bg-white/6 text-ink-3")}>
                  {hydrated ? c.count : 0}
                </span>
              </Link>
            </motion.div>
          ))}
        </nav>
      </div>
    </RevealItem>
  )
}

/* ── Decision queue: the work, with the actions inline ──────────────── */

type QueueTab = "brands" | "payouts" | "refunds" | "campaigns" | "moderation"

function DecisionQueue() {
  const router = useRouter()
  const hydrated = useHydrated()
  const [tab, setTab] = useState<QueueTab>("payouts")
  const [confirm, setConfirm] = useState<null | { kind: "payout-approve" | "payout-release" | "refund-issue"; id: string; title: string; description: string; label: string }>(null)
  const applications = useAdmin((s) => s.applications)
  const payouts = useAdmin((s) => s.payouts)
  const refunds = useAdmin((s) => s.refunds)
  const campaigns = useAdmin((s) => s.campaigns)
  const moderation = useAdmin((s) => s.moderation)
  const setPayoutStatus = useAdmin((s) => s.setPayoutStatus)
  const setRefundStatus = useAdmin((s) => s.setRefundStatus)

  const lists = {
    brands: applications.filter((a) => a.status === "pending_review"),
    payouts: payouts.filter((p) => p.status === "awaiting_approval" || p.status === "held" || p.status === "scheduled").slice(0, 6),
    refunds: refunds.filter((r) => r.status === "requested").slice(0, 6),
    campaigns: campaigns.filter((c) => c.status === "in_review"),
    moderation: moderation.filter((m) => m.status === "open" || m.status === "escalated"),
  }
  const count = (k: QueueTab) => (hydrated ? (k === "payouts" ? lists.payouts.filter((p) => p.status !== "scheduled").length : lists[k].length) : 0)

  const rows: { id: string; title: string; meta: string; amount?: string; badge?: { text: string; tone: "acid" | "danger" | "muted" | "purple" }; action: React.ReactNode }[] =
    tab === "brands"
      ? lists.brands.map((a) => ({ id: a.id, title: a.brandName, meta: `${a.country}, ${a.products} products, KYC ${a.kyc.replace("_", " ")}`, badge: { text: `${a.risk} risk`, tone: a.risk === "high" ? "danger" : a.risk === "medium" ? "acid" : "muted" }, action: <Button size="xs" variant="secondary" onClick={() => router.push("/admin/brands")}>Review</Button> }))
      : tab === "payouts"
        ? lists.payouts.map((p) => ({
            id: p.id,
            title: p.brandName,
            meta: p.status === "held" ? `Held: ${p.holdReason}` : `${p.method}, ${p.orders} orders`,
            amount: usdFull(p.amountUsd),
            badge: { text: p.status.replace("_", " "), tone: p.status === "held" ? "danger" : p.status === "awaiting_approval" ? "acid" : "purple" },
            action:
              p.status === "awaiting_approval" ? (
                <Button size="xs" variant="primary" onClick={() => setConfirm({ kind: "payout-approve", id: p.id, title: `Approve payout to ${p.brandName}`, description: `${usdFull(p.amountUsd)} via ${p.method}. The transfer is sent by the provider; the ledger records it when the provider confirms.`, label: "Approve payout" })}>Approve</Button>
              ) : p.status === "held" ? (
                <Button size="xs" variant="secondary" onClick={() => setConfirm({ kind: "payout-release", id: p.id, title: `Release held payout to ${p.brandName}`, description: `This payout is held: ${p.holdReason} Release it only once the reason is resolved.`, label: "Release payout" })}>Release</Button>
              ) : (
                <span className="text-[11px] text-ink-3">Scheduled</span>
              ),
          }))
        : tab === "refunds"
          ? lists.refunds.map((r) => ({
              id: r.id,
              title: `#${r.reference}, ${r.brandName}`,
              meta: `${r.customer}: ${r.reason}`,
              amount: usdFull(r.amountUsd),
              action: <Button size="xs" variant="secondary" onClick={() => setConfirm({ kind: "refund-issue", id: r.id, title: `Issue refund for #${r.reference}`, description: `${usdFull(r.amountUsd)} back to ${r.customer}. Sent once with idempotency key ${r.idempotencyKey}, so a retry can never refund twice. Commission is reversed pro rata.`, label: "Issue refund" })}>Issue</Button>,
            }))
          : tab === "campaigns"
            ? lists.campaigns.map((c) => ({ id: c.id, title: c.name, meta: `${campaignTypes[c.type].name}, ${c.days} days`, amount: usdFull(c.budget), badge: { text: "in review", tone: "acid" }, action: <Button size="xs" variant="secondary" onClick={() => router.push("/admin/advertising")}>Review</Button> }))
            : lists.moderation.map((m) => ({ id: m.id, title: m.title, meta: `${m.brandName}: ${m.reportedBy}`, badge: { text: m.reason.replace("_", " "), tone: m.reason === "counterfeit" || m.reason === "ip_complaint" ? "danger" : "acid" }, action: <Button size="xs" variant="secondary" onClick={() => router.push("/admin/products")}>Open</Button> }))

  const badgeTone = { acid: "border-acid/45 text-acid", danger: "border-danger/45 text-danger", muted: "border-white/10 text-ink-3", purple: "border-purple bg-purple/20 text-ink" }

  function run(reason: string) {
    if (!confirm) return
    if (confirm.kind === "payout-approve") setPayoutStatus(confirm.id, "processing", reason)
    if (confirm.kind === "payout-release") setPayoutStatus(confirm.id, "scheduled", reason)
    if (confirm.kind === "refund-issue") setRefundStatus(confirm.id, "issued", reason)
    toast(confirm.kind === "refund-issue" ? "Refund issued" : confirm.kind === "payout-approve" ? "Payout approved" : "Payout released", { description: "Recorded in the audit log." })
  }

  return (
    <Panel
      title="Decision queue"
      description="Work that needs a person. Every action asks for a reason and lands in the audit log."
      className="xl:col-span-8"
      bodyClassName="px-0 pb-0 md:px-0 md:pb-0"
    >
      <div className="rail overflow-x-auto px-4 pb-3 md:px-5">
        <Segmented
          label="Queue"
          size="sm"
          value={tab}
          onChange={setTab}
          options={[
            { value: "payouts", label: "Payouts", count: count("payouts") },
            { value: "refunds", label: "Refunds", count: count("refunds") },
            { value: "brands", label: "Brands", count: count("brands") },
            { value: "campaigns", label: "Campaigns", count: count("campaigns") },
            { value: "moderation", label: "Moderation", count: count("moderation") },
          ]}
        />
      </div>
      <div className="min-h-[300px] border-t border-[var(--admin-hairline)]">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.ul key={tab} className="admin-divide" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={springs.pill}>
            {rows.length === 0 ? (
              <li className="flex flex-col items-center justify-center px-6 py-16 text-center">
                <p className="text-[13px] text-ink">Queue clear</p>
                <p className="mt-1 text-[12px] text-ink-2">Nothing here needs a decision right now.</p>
              </li>
            ) : (
              rows.map((r) => (
                <motion.li key={r.id} layout transition={springs.pill} className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.02] md:px-5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-[13px] text-ink">{r.title}</p>
                      {r.badge ? <span className={cn("inline-flex h-5 items-center rounded-[5px] border px-1.5 text-[10.5px] font-medium", badgeTone[r.badge.tone])}>{r.badge.text.charAt(0).toUpperCase() + r.badge.text.slice(1)}</span> : null}
                    </div>
                    <p className="mt-0.5 truncate text-[12px] text-ink-3">{r.meta}</p>
                  </div>
                  {r.amount ? <p className="hidden text-[13px] text-ink tabular sm:block">{r.amount}</p> : null}
                  <div className="shrink-0">{r.action}</div>
                </motion.li>
              ))
            )}
          </motion.ul>
        </AnimatePresence>
      </div>
      <ReasonDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)} title={confirm?.title ?? ""} description={confirm?.description ?? ""} confirmLabel={confirm?.label ?? "Confirm"} onConfirm={run} />
    </Panel>
  )
}

/* ── Audit trail: live, read-only ────────────────────────────────────── */

function AuditTrail() {
  const audit = useAdmin((s) => s.audit)
  return (
    <Panel title="Audit trail" description="Every decision, who made it and why. Read-only." href="/admin/security" hrefLabel="Full log" className="xl:col-span-7">
      <ol className="relative flex min-w-0 flex-col gap-0.5">
        <span className="absolute top-2 bottom-2 left-[15px] w-px bg-[var(--admin-hairline)]" aria-hidden />
        <AnimatePresence initial={false}>
          {audit.slice(0, 6).map((a) => (
            <motion.li key={a.id} layout initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={springs.pill} className="relative flex gap-3 rounded-lg py-2 pr-2">
              <span className="relative z-10 mt-0.5 inline-flex size-[31px] shrink-0 items-center justify-center rounded-full border border-[var(--admin-hairline-strong)] bg-[#0c0c0c] text-[10.5px] font-semibold text-ink">
                {a.actor.split(" ").map((x) => x[0]).join("")}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-ink">
                  <span className="text-ink">{a.actor}</span> <span className="text-ink-2">{a.action.charAt(0).toLowerCase() + a.action.slice(1)}</span>
                </p>
                <p className="mt-0.5 truncate text-[12px] text-ink-3">{a.target}{a.reason ? `. ${a.reason}` : ""}</p>
              </div>
              <span className="shrink-0 pt-0.5 text-[11px] text-ink-3 tabular">{relTime(a.at)}</span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
    </Panel>
  )
}

/* ── Page ─────────────────────────────────────────────────────────────── */

export default function AdminOverviewPage() {
  const [period, setPeriod] = useState<Period>("30d")
  const payoutsState = useAdmin((s) => s.payouts)
  const refundsState = useAdmin((s) => s.refunds)
  const hydrated = useHydrated()
  const o = platformOverview()

  const series = useMemo(() => platformDailyGmvUsd(180), [])
  const days = periodDays[period]
  const cur = series.slice(-days)
  const prev = series.slice(-days * 2, -days)
  const sum = (rows: typeof series, k: "gmv" | "orders" | "commission") => rows.reduce((s, r) => s + r[k], 0)
  const gmv = sum(cur, "gmv")
  const gmvPrev = sum(prev, "gmv")
  const orders = sum(cur, "orders")
  const ordersPrev = sum(prev, "orders")
  const commission = sum(cur, "commission")
  const commissionPrev = sum(prev, "commission")
  const chart = series.slice(-Math.max(days, 14))
  const d = (a: number, b: number) => (b ? (a - b) / b : null)

  const pendingPayoutsUsd = (hydrated ? payoutsState : []).filter((p) => p.status !== "paid").reduce((s, p) => s + p.amountUsd, 0) || o.pendingPayoutsUsd
  const refundRequests = hydrated ? refundsState.filter((r) => r.status === "requested").length : o.refundRequests

  const charges = transactions.filter((t) => t.type === "charge")
  const byProvider = (["paystack", "flutterwave", "stripe"] as const).map((p) => ({ p, n: charges.filter((c) => c.provider === p).length, ok: charges.filter((c) => c.provider === p && c.status === "succeeded").length }))
  const degraded = healthServices.filter((s) => s.status !== "operational")

  return (
    <Reveal className="grid gap-4 md:gap-5">
      <CommandStrip />

      {/* Headline metrics */}
      <div className="grid gap-4 md:gap-5 xl:grid-cols-12">
        <KpiCard
          size="lg"
          glow
          className="xl:col-span-5"
          label={`Gross merchandise value, last ${days} days`}
          value={gmv}
          format={usdFull}
          delta={d(gmv, gmvPrev)}
          hint={`vs previous ${days} days`}
          spark={chart.map((r) => r.gmv)}
        >
          <Segmented label="Period" size="sm" value={period} onChange={setPeriod} options={[{ value: "7d", label: "7 days" }, { value: "30d", label: "30 days" }, { value: "90d", label: "90 days" }]} />
        </KpiCard>
        <div className="grid grid-cols-2 gap-4 md:gap-5 xl:col-span-7">
          <KpiCard label="Platform revenue" value={commission + o.adRevenueUsd * (days / 90)} format={usd} delta={d(commission, commissionPrev)} hint="commission + ads" spark={chart.map((r) => r.commission)} />
          <KpiCard label="Orders" value={orders} format={int} delta={d(orders, ordersPrev)} hint={`${o.ordersToday} today`} spark={chart.map((r) => r.orders)} sparkTone="grey" />
          <KpiCard label="Pending payouts" value={pendingPayoutsUsd} format={usd} hint="to 14 brands" attention spark={growth("payouts", pendingPayoutsUsd, 14, 0.3)} sparkTone="acid" />
          <KpiCard label="Refund requests" value={refundRequests} format={int} hint="awaiting a decision" attention={refundRequests > 0} spark={growth("refunds", Math.max(1, refundRequests), 14, 0.5)} sparkTone="acid" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:gap-5 lg:grid-cols-4">
        <KpiCard size="sm" label="Registered users" value={o.users} format={int} delta={0.064} spark={growth("users", o.users)} sparkTone="grey" />
        <KpiCard size="sm" label="Active brands" value={o.brands} format={int} hint={`${o.pendingBrands} awaiting review`} spark={growth("brands", o.brands, 30, 0.4)} sparkTone="grey" />
        <KpiCard size="sm" label="Live products" value={o.products} format={int} delta={0.112} spark={growth("products", o.products, 30, 0.3)} sparkTone="grey" />
        <KpiCard size="sm" label="Active campaigns" value={o.activeCampaigns} format={int} hint={`${o.campaignsInReview} in review`} spark={growth("campaigns", o.activeCampaigns, 30, 0.5)} sparkTone="grey" />
      </div>

      {/* GMV chart + payments */}
      <div className="grid gap-4 md:gap-5 xl:grid-cols-12">
        <Panel
          title="Marketplace volume"
          description="Daily GMV across every brand in USD, with the commission it earned."
          className="xl:col-span-8"
          action={<span className="hidden text-[12px] text-ink-3 sm:inline">Last {Math.max(days, 14)} days</span>}
        >
          <div className="mb-4 grid grid-cols-3 gap-3">
            {[
              { label: "GMV", value: usdFull(gmv) },
              { label: "Average order", value: usdFull(orders ? gmv / orders : 0) },
              { label: "Take rate", value: formatPercent(gmv ? commission / gmv : 0, 1) },
            ].map((s) => (
              <div key={s.label} className="admin-inset px-3 py-2.5">
                <p className="text-[11px] text-ink-3">{s.label}</p>
                <p className="font-metric mt-1.5 text-xl text-ink">{s.value}</p>
              </div>
            ))}
          </div>
          <AdminAreaChart data={chart} primary={{ key: "gmv", label: "GMV" }} secondary={{ key: "commission", label: "Commission" }} format={usd} height={260} />
        </Panel>

        <Panel title="Payments" description="Success is counted only when the provider's webhook is verified." className="xl:col-span-4" href="/admin/finance" hrefLabel="Finance">
          <div className="flex items-center gap-5">
            <RingGauge value={o.paymentSuccess} threshold={0.97} label="Payment success" sublabel="success" />
            <div className="min-w-0 flex-1">
              <p className="text-[12px] text-ink-2">Target 97% or better. Under it, the ring turns yellow and on-call is paged.</p>
            </div>
          </div>
          <div className="mt-5 grid gap-2.5">
            {byProvider.map((p) => (
              <div key={p.p} className="admin-inset flex items-center justify-between gap-3 px-3 py-2">
                <span className="text-[12.5px] capitalize text-ink">{p.p}</span>
                <span className="flex items-center gap-3 text-[12px] tabular">
                  <span className="text-ink-3">{p.n} charges</span>
                  <span className={cn(p.n && p.ok / p.n < 0.97 ? "text-acid" : "text-ink")}>{p.n ? formatPercent(p.ok / p.n, 1) : "—"}</span>
                </span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {/* Decisions + health */}
      <div className="grid gap-4 md:gap-5 xl:grid-cols-12">
        <DecisionQueue />
        <Panel title="System health" description="Live service status and the incidents that need an engineer." className="xl:col-span-4" href="/admin/health" hrefLabel="Health">
          <ul className="grid gap-1">
            {healthServices.map((s) => {
              const slo = s.name === "Background jobs" ? 1500 : s.name === "Payment webhooks" ? 800 : 400
              const ratio = Math.min(1, s.latencyP95 / slo)
              const bad = s.status !== "operational"
              return (
                <li key={s.name} className="rounded-lg px-2 py-2 transition-colors hover:bg-white/[0.02]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-[12.5px] text-ink">
                      <span className="relative flex size-2">
                        {bad ? <span className="absolute inline-flex size-full animate-ping rounded-full bg-acid/70" /> : null}
                        <span className={cn("relative inline-flex size-2 rounded-full", bad ? "bg-acid" : "bg-violet")} />
                      </span>
                      {s.name}
                    </span>
                    <span className="text-[11px] text-ink-3 tabular">p95 {s.latencyP95}ms, {formatPercent(s.uptime, 2)} up</span>
                  </div>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.06]">
                    <motion.div className={cn("h-full rounded-full", bad ? "bg-acid" : "bg-purple")} initial={{ width: 0 }} animate={{ width: `${Math.max(4, ratio * 100)}%` }} transition={{ type: "spring", stiffness: 110, damping: 20, delay: 0.2 }} />
                  </div>
                </li>
              )
            })}
          </ul>
          {degraded.length || failedJobs.length || webhookFailures.length ? (
            <Link href="/admin/health" className="admin-inset mt-4 flex items-start gap-2.5 border-acid/30 p-3 transition-colors hover:border-acid/60">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-acid" />
              <span className="text-[12.5px] leading-snug text-ink">
                {failedJobs.length} failed background jobs and {webhookFailures.length} payment webhook failures need a look.
              </span>
              <ArrowUpRight className="ml-auto size-3.5 shrink-0 text-ink-3" />
            </Link>
          ) : null}
        </Panel>
      </div>

      {/* Audit + revenue mix */}
      <div className="grid gap-4 md:gap-5 xl:grid-cols-12">
        <AuditTrail />
        <Panel title="Revenue mix" description="Where platform revenue came from over the last 90 days." className="xl:col-span-5">
          <p className="font-metric text-[2.25rem] text-ink">{usdFull(o.revenueUsd)}</p>
          <p className="mt-1 text-[12px] text-ink-3">Commission is 5% of completed sales; ads are fixed-price placements.</p>
          <div className="mt-5">
            <SplitBar
              segments={[
                { label: "Sales commission", value: o.commissionUsd, tone: "purple" },
                { label: "Sponsored placements", value: o.adRevenueUsd, tone: "acid" },
              ]}
            />
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="admin-inset px-3 py-2.5">
              <p className="text-[11px] text-ink-3">Commission trend</p>
              <Sparkline values={series.slice(-30).map((r) => r.commission)} height={34} className="mt-2" />
            </div>
            <div className="admin-inset px-3 py-2.5">
              <p className="text-[11px] text-ink-3">Ad share of revenue</p>
              <p className="font-metric mt-2 text-xl text-ink">{formatPercent(o.revenueUsd ? o.adRevenueUsd / o.revenueUsd : 0, 1)}</p>
            </div>
          </div>
        </Panel>
      </div>
    </Reveal>
  )
}
