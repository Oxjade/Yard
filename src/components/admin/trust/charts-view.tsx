"use client"

import { useId } from "react"
import {
  ArrowClockwiseIcon,
  CheckIcon,
  EyeIcon,
  FlagIcon,
  InfoIcon,
  LockSimpleIcon,
  LockSimpleOpenIcon,
  RankingIcon,
  SealCheckIcon,
  SnowflakeIcon,
  XCircleIcon,
} from "@phosphor-icons/react"
import { motion } from "motion/react"
import { Button } from "@/components/ui/button"
import { DataTable, type Column, type RowAction } from "@/components/dashboard/data-table"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { StatCard } from "@/components/dashboard/insight/stat-card"
import { AdminAreaChart } from "@/components/admin/ui/area-chart"
import { RingGauge, SplitBar } from "@/components/admin/ui/gauge"
import { Reveal, RevealItem } from "@/components/admin/ui/motion"
import { Panel } from "@/components/admin/ui/panel"
import { Segmented, segmentedTabId } from "@/components/admin/ui/segmented"
import { DetailSection, DetailSheet, EmptyLine, Facts, insetClass } from "@/components/admin/marketplace/detail-sheet"
import { formatDate, relDays } from "@/components/admin/marketplace/format"
import { AdminPageHead, PanelRail, StatRow } from "@/components/admin/marketplace/page-head"
import { InPageLinks, useSearchParam, writeParams } from "@/components/admin/marketplace/url-state"
import { useLast } from "@/components/admin/marketplace/use-last"
import { useNow } from "@/hooks/use-now"
import { adminKeys, getChartFlag, getChartsOverview, listChartFlags, listSponsored } from "@/lib/api/admin"
import type { ChartFlagDto, ChartsOverviewDto, FreezeDto, SponsoredRowDto } from "@/lib/api/contracts/admin"
import { useApi } from "@/lib/api/use-api"
import { formatNumber, formatPercent } from "@/lib/money"
import type { AdminPermission } from "@/lib/permissions"
import { useRealtimeEvent } from "@/lib/realtime/use-realtime"
import { cn } from "@/lib/utils"
import { LoadError, ServerActivity, TrustActionBar, TrustGate, useAdminSession, useServerDecision, type TrustAction } from "./shared"

/*
 * Admin › Charts (§6.3, §8.1): is each board counting real interest? Flags are computed by the
 * detectors; a freeze needs a second admin. Public pages never say a brand is flagged.
 */

type Tab = "overview" | "flags" | "frozen" | "sponsored"
const TABS: { value: Tab; label: string; permission: AdminPermission }[] = [
  { value: "overview", label: "Overview", permission: "charts.review" },
  { value: "flags", label: "Flags", permission: "charts.review" },
  { value: "frozen", label: "Frozen", permission: "charts.review" },
  { value: "sponsored", label: "Sponsored", permission: "sponsored.view" },
]
const isTab = (v: string | null): v is Tab => TABS.some((t) => t.value === v)
const n = (v: number) => formatNumber(Math.round(v))
const pct = (v: number) => formatPercent(v, 1)
type Tone = "attention" | "info" | "muted" | "danger" | "success" | "neutral"
const severityTone: Record<string, Tone> = { high: "danger", medium: "attention", low: "muted" }
const flagStatus: Record<string, { label: string; tone: Tone }> = {
  open: { label: "Open", tone: "attention" },
  cleared: { label: "Cleared", tone: "success" },
  confirmed: { label: "Confirmed", tone: "muted" },
  frozen: { label: "Frozen", tone: "info" },
}
const autoAction: Record<string, string> = { none: "Listed for review", excluded_signals: "Signals excluded", held_from_charts: "Held from every board" }
function freezeStatus(f: FreezeDto): { label: string; tone: Tone } {
  if (f.status === "pending_approval") return { label: "Waiting for a second admin", tone: "attention" }
  if (f.status === "active") return { label: f.until ? `Frozen until ${formatDate(f.until)}` : "Frozen", tone: "info" }
  return { label: "Lifted", tone: "muted" }
}

export function ChartsView() {
  return (
    <Reveal ssrVisible className="@container grid gap-3">
      <AdminPageHead
        title="Charts"
        description="Whether every board counts genuine interest: excluded signals, the detectors' flags and brands frozen off the charts."
        note="Boards include a labelled sample baseline in this build. Flags are computed by Yard's detectors from real signal events; nothing here is seeded as a flag."
      />
      <TrustGate feature="Charts" anyOf={["charts.review", "sponsored.view"]}>
        <ChartsBody />
      </TrustGate>
    </Reveal>
  )
}

function ChartsBody() {
  const qid = useId()
  const { can, reason } = useAdminSession()
  const linked = useSearchParam("tab")
  // Chart integrity notifications link to ?flag=<id> (C's detectors).
  const flagLink = useSearchParam("flag")
  const first = TABS.find((t) => can(t.permission))?.value ?? "overview"
  const tab: Tab = isTab(linked) ? linked : flagLink ? "flags" : first
  const allowed = can(TABS.find((t) => t.value === tab)!.permission)
  const reviewer = can("charts.review")
  const overview = useApi(reviewer ? adminKeys.chartsOverview : null, getChartsOverview, { refreshInterval: 60_000 })
  const flags = useApi(reviewer && tab !== "sponsored" ? adminKeys.chartFlags("all") : null, () => listChartFlags("all"), { refreshInterval: 60_000 })
  useRealtimeEvent("moderation.counts", () => {
    void overview.revalidate()
    void flags.revalidate()
  })
  const { ask, dialog } = useServerDecision(() => document.getElementById(segmentedTabId(qid, tab)))
  const o = overview.data
  const ready = !!o

  return (
    <div className="grid gap-3">
      {reviewer ? (
        <InPageLinks>
          <StatRow label="Charts integrity figures">
            <RevealItem className="min-w-0">
              <StatCard surface="admin" variant={ready && o?.flags.open ? "brand" : "default"} icon={FlagIcon} label="Open flags" value={o?.flags.open ?? 0} format={n} hint={o ? `${n(o.flags.high)} high severity` : "Computed by the detectors"} href="/admin/charts?tab=flags#charts-panel" hrefLabel="Show flags" ready={ready} className="h-full" />
            </RevealItem>
            <RevealItem className="min-w-0">
              <StatCard surface="admin" variant={ready && o?.flags.pendingFreeze ? "brand" : "default"} icon={SnowflakeIcon} label="Freezes to approve" value={o?.flags.pendingFreeze ?? 0} format={n} hint="Needs a second admin" href="/admin/charts?tab=frozen#charts-panel" hrefLabel="Show freezes" ready={ready} className="h-full" />
            </RevealItem>
            <RevealItem className="min-w-0">
              <StatCard surface="admin" icon={LockSimpleIcon} label="Frozen brands" value={o?.flags.frozen ?? 0} format={n} hint="Off every board" href="/admin/charts?tab=frozen#charts-panel" hrefLabel="Show frozen brands" ready={ready} className="h-full" />
            </RevealItem>
            <RevealItem className="min-w-0">
              <StatCard surface="admin" icon={SealCheckIcon} label="Verified signals" value={o?.verifiedShare ?? 0} format={(v) => (o?.verifiedShare == null ? "No signals" : pct(v))} hint="Counted, last 7 days" href="/admin/charts#charts-panel" hrefLabel="Show the overview" ready={ready} className="h-full" />
            </RevealItem>
          </StatRow>
        </InPageLinks>
      ) : null}

      {o ? <SignalNotes o={o} /> : null}

      <Panel id="charts-panel" title="Chart integrity" description="Boards, flags, freezes and sponsored placements. Every decision asks for a reason." className="scroll-mt-24 rounded-[20px]" bodyClassName="px-0 pb-0 md:px-0 md:pb-0">
        <PanelRail value={tab}>
          <Segmented
            label="Chart integrity"
            size="sm"
            value={tab}
            onChange={(t) => writeParams({ tab: t === first ? null : t, case: null })}
            loading={reviewer && !flags.data && tab !== "sponsored"}
            idBase={qid}
            panelId={`${qid}-panel`}
            options={TABS.map((t) => ({ value: t.value, label: t.label, count: t.value === "flags" ? flags.data?.counts.open : t.value === "frozen" ? flags.data?.freezes.filter((f) => f.status === "pending_approval").length : undefined }))}
          />
        </PanelRail>
        <div id={`${qid}-panel`} role="tabpanel" aria-labelledby={segmentedTabId(qid, tab)} className="border-t border-[var(--admin-hairline)] p-3 sm:p-4 md:p-5">
          {!allowed ? (
            <EmptyLine>{reason(TABS.find((t) => t.value === tab)!.permission)?.replace(/\.$/, "")} to open this tab.</EmptyLine>
          ) : tab === "overview" ? (
            overview.error && !o ? <LoadError error={overview.error} onRetry={() => void overview.revalidate()} what="the overview" /> : <Overview o={o} ask={ask} />
          ) : tab === "sponsored" ? (
            <Sponsored />
          ) : flags.error && !flags.data ? (
            <LoadError error={flags.error} onRetry={() => void flags.revalidate()} what="the flags" />
          ) : tab === "flags" ? (
            <Flags items={flags.data?.items} ask={ask} />
          ) : (
            <Freezes items={flags.data?.freezes} ask={ask} />
          )}
        </div>
      </Panel>
      {dialog}
    </div>
  )
}

/** The two plain notes the overview must always show when they apply (§8.1, §10). */
function SignalNotes({ o }: { o: ChartsOverviewDto }) {
  const notes = [
    o.ipSignal === "unavailable" ? "IP signal: unavailable — set YARD_TRUSTED_PROXY_HOPS behind a proxy. Without it, Yard can't see client IPs, so the IP-based detectors stay off." : null,
    "Order signals: not connected (no payment provider). Sales count only from the labelled sample baseline until payments are confirmed.",
  ].filter(Boolean) as string[]
  return (
    <ul className="grid gap-1.5 px-1">
      {notes.map((t) => (
        <li key={t} className="flex items-start gap-2 text-[12px] leading-snug text-ink-2">
          <InfoIcon className="mt-0.5 size-3.5 shrink-0 text-ink-3" aria-hidden />
          {t}
        </li>
      ))}
    </ul>
  )
}

type Ask = ReturnType<typeof useServerDecision>["ask"]

function Overview({ o, ask }: { o?: ChartsOverviewDto; ask: Ask }) {
  const { reason } = useAdminSession()
  const r = reason("charts.review")
  if (!o)
    return (
      <div aria-busy role="status" className="grid gap-2 @xl:grid-cols-2 @5xl:grid-cols-3">
        <span className="sr-only">Loading the boards</span>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="skeleton h-[132px] rounded-[12px]" />
        ))}
      </div>
    )
  return (
    <div className="grid gap-5">
      <ul className="grid gap-2 @xl:grid-cols-2 @5xl:grid-cols-3" aria-label="Boards">
        {o.boards.map((b) => {
          const over = b.excludedShare > o.threshold
          return (
            <li key={b.chart} className={cn("admin-inset p-3.5", (over || b.openFlags > 0) && "border-acid/30")}>
              <div className="flex items-center justify-between gap-2">
                <p className="flex min-w-0 items-center gap-2 text-[13px] text-ink">
                  <span aria-hidden className={cn("inline-flex size-2 shrink-0 rounded-full", over || b.openFlags ? "bg-acid" : "bg-violet")} />
                  <span className="truncate">{b.label}</span>
                </p>
                <StatusBadge tone={b.openFlags ? "attention" : "muted"}>{b.openFlags ? `${b.openFlags} open ${b.openFlags === 1 ? "flag" : "flags"}` : "No open flags"}</StatusBadge>
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2">
                <div>
                  <dt className="text-[11px] text-ink-3">Cohort</dt>
                  <dd className="font-metric mt-1 text-[1.25rem] text-ink">{b.cohort == null ? "None" : n(b.cohort)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-ink-3">Excluded</dt>
                  <dd className={cn("font-metric mt-1 text-[1.25rem]", over ? "text-acid" : "text-ink")}>{b.totalEvents ? pct(b.excludedShare) : "None"}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-ink-3">Signals, 7 days</dt>
                  <dd className="font-metric mt-1 text-[1.25rem] text-ink">{n(b.totalEvents)}</dd>
                </div>
              </dl>
              <div className="mt-3">
                <div className="h-1 overflow-hidden rounded-full bg-white/[0.06]" role="meter" aria-valuemin={0} aria-valuemax={1} aria-valuenow={b.excludedShare} aria-label={`${b.label}: excluded share against a ${pct(o.threshold)} threshold`}>
                  <motion.div className={cn("h-full origin-left rounded-full", over ? "bg-acid" : "bg-purple")} initial={{ scaleX: 0 }} animate={{ scaleX: Math.max(0.03, Math.min(1, b.excludedShare / (o.threshold * 2))) }} transition={{ type: "spring", stiffness: 110, damping: 20, delay: 0.15 }} />
                </div>
                <p className="mt-1.5 text-[11px] text-ink-3 tabular">
                  {over ? "Over" : "Under"} the {pct(o.threshold)} threshold{b.edition ? `, edition ${formatDate(b.edition)}` : ", no edition yet"}
                </p>
              </div>
            </li>
          )
        })}
      </ul>

      <div className="grid gap-5 @5xl:grid-cols-[2fr_1fr]">
        <section aria-label="Excluded share by day" className="grid gap-2">
          <h3 className="font-label text-[13px] text-ink">Excluded signals by day</h3>
          <p className="text-[12px] text-ink-3">Share of chart signals excluded as self, restricted, anonymous or suspicious, against the {pct(o.threshold)} threshold.</p>
          <AdminAreaChart data={o.daily.map((d) => ({ date: d.date, excluded: d.excludedShare, threshold: d.threshold }))} primary={{ key: "excluded", label: "Excluded share" }} secondary={{ key: "threshold", label: "Threshold" }} format={(v) => formatPercent(v, 0)} height={220} />
        </section>
        <section aria-label="Signal quality" className="grid content-start gap-4">
          <div className="flex items-center gap-4">
            <RingGauge value={o.verifiedShare ?? 0} threshold={1 - o.threshold} label="Verified signals" sublabel="Verified signals" size={124} />
            <p className="text-[12px] leading-snug text-ink-2">{o.totals.total ? `${n(o.totals.counted)} of ${n(o.totals.total)} signals counted in the last 7 days.` : "No signals in the last 7 days yet."}</p>
          </div>
          <div className="grid gap-2">
            <h3 className="font-label text-[13px] text-ink">Organic and sponsored surface</h3>
            <SplitBar
              segments={[
                { label: "Organic entries, Top brands", value: o.surface.organic, tone: "purple" },
                { label: "Sponsored slots (sample campaigns)", value: o.surface.sponsored, tone: "grey" },
              ]}
            />
            <p className="text-[11.5px] text-ink-3">Sponsored brands sit in their own strip after rank 10 and are never ranked.</p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-10 justify-self-start sm:h-9"
            disabled={!!r}
            title={r}
            onClick={() =>
              void ask({
                action: "recompute-charts",
                body: { id: "all" },
                title: "Recompute every board now?",
                description: "Drops the cached boards so the next view computes them from the current signals and flags. Nobody is notified; your reason stays in the audit log.",
                fieldLabel: "Reason, for the audit log",
                confirmLabel: "Recompute now",
                done: "Charts recomputing",
              })
            }
          >
            <ArrowClockwiseIcon aria-hidden /> Recompute now
          </Button>
        </section>
      </div>
    </div>
  )
}

function flagDecisions(ask: Ask, me: string | undefined) {
  return {
    clear: (f: ChartFlagDto) =>
      ask({
        action: "decide-chart-flag",
        body: { id: f.id, outcome: "clear" },
        title: `Clear the ${f.detectorLabel.toLowerCase()} flag on ${f.brand.name}?`,
        description: `Its ${n(f.excludedEvents)} excluded signals count again, and ${f.brand.name} can return to the boards at the next recompute. ${f.brand.name} isn't told; your reason stays in the audit log.`,
        fieldLabel: "Reason, for the audit log",
        confirmLabel: "Clear flag",
        done: "Flag cleared",
      }),
    confirm: (f: ChartFlagDto) =>
      ask({
        action: "decide-chart-flag",
        body: { id: f.id, outcome: "confirm" },
        title: `Confirm the ${f.detectorLabel.toLowerCase()} flag on ${f.brand.name}?`,
        description: `The flagged signals stay excluded. A hold from every board ends, so ${f.brand.name} ranks on its genuine signals. Request a freeze to keep it off the charts. Your reason stays in the audit log.`,
        fieldLabel: "Reason, for the audit log",
        confirmLabel: "Confirm flag",
        done: "Flag confirmed",
      }),
    request: (brand: ChartFlagDto["brand"], days: 7 | 14 | 30, flagId?: string) =>
      ask({
        action: "request-chart-freeze",
        body: { id: brand.id, days, ...(flagId ? { flagId } : {}) },
        title: `Request a ${days}-day Charts freeze for ${brand.name}?`,
        description: `A second admin with the freeze permission must approve it before anything changes. Once approved, ${brand.name} leaves every board and is told it's paused because of unusual activity, not your reason.`,
        fieldLabel: "Reason, for the second admin and the audit log",
        confirmLabel: "Request freeze",
        destructive: true,
        done: "Freeze requested",
      }),
    approve: (z: FreezeDto) =>
      ask({
        action: "approve-chart-freeze",
        body: { id: z.id },
        title: `Approve the Charts freeze on ${z.brand.name}?`,
        description: `${z.requestedBy.name} asked for it: ${z.reason} ${z.brand.name} leaves every board${z.until ? ` until ${formatDate(z.until)}` : ""} and is told it's paused because of unusual activity.`,
        fieldLabel: "Reason, for the audit log",
        confirmLabel: "Approve freeze",
        destructive: true,
        warning: z.requestedBy.id === me ? "You requested this freeze, so Yard will refuse it: it needs a second admin." : undefined,
        done: "Freeze approved",
      }),
    lift: (z: FreezeDto) =>
      ask({
        action: "lift-chart-freeze",
        body: { id: z.id },
        title: z.status === "pending_approval" ? `Withdraw the freeze request for ${z.brand.name}?` : `Lift the Charts freeze on ${z.brand.name}?`,
        description: z.status === "pending_approval" ? "Nothing changed on the boards yet, so withdrawing only closes the request. Your reason stays in the audit log." : `${z.brand.name} can rank again at the next recompute and is told the pause ended. Your reason stays in the audit log.`,
        fieldLabel: "Reason, for the audit log",
        confirmLabel: z.status === "pending_approval" ? "Withdraw request" : "Lift freeze",
        done: z.status === "pending_approval" ? "Freeze request withdrawn" : "Freeze lifted",
      }),
  }
}

function freezeActions(z: FreezeDto | null, d: ReturnType<typeof flagDecisions>, me: string | undefined, reason: (p: AdminPermission) => string | undefined): TrustAction[] {
  if (!z || z.status === "lifted") return []
  const r = reason("charts.freeze")
  const out: TrustAction[] = [{ key: "lift", label: z.status === "pending_approval" ? "Withdraw request" : "Lift freeze", icon: LockSimpleOpenIcon, variant: "secondary", onSelect: () => void d.lift(z), disabledReason: r }]
  if (z.status === "pending_approval") out.push({ key: "approve", label: "Approve freeze", icon: SnowflakeIcon, variant: "destructive", onSelect: () => void d.approve(z), disabledReason: r ?? (z.requestedBy.id === me ? "You requested it. Needs a second admin." : undefined) })
  return out
}

function Flags({ items, ask }: { items?: ChartFlagDto[]; ask: Ask }) {
  const { reason, admin } = useAdminSession()
  const caseParam = useSearchParam("case")
  const flagParam = useSearchParam("flag")
  const caseId = caseParam ?? flagParam
  const d = flagDecisions(ask, admin?.id)
  const r = reason("charts.review")
  const open = (f: ChartFlagDto) => writeParams({ case: f.id })
  const columns: Column<ChartFlagDto>[] = [
    {
      key: "brand",
      header: "Brand",
      sortValue: (f) => f.brand.name,
      cell: (f) => (
        <button type="button" onClick={() => open(f)} className="group block max-w-full min-w-0 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-violet">
          <span className="block max-w-[40vw] truncate font-medium text-ink group-hover:text-violet sm:max-w-[220px]">{f.brand.name}</span>
          <span className="block max-w-[40vw] truncate text-[11.5px] text-ink-3 sm:max-w-[220px]">{f.detectorLabel}</span>
        </button>
      ),
    },
    { key: "severity", header: "Severity", sortValue: (f) => ({ high: 0, medium: 1, low: 2 })[f.severity], cell: (f) => <StatusBadge tone={severityTone[f.severity]}>{f.severity.charAt(0).toUpperCase() + f.severity.slice(1)}</StatusBadge> },
    { key: "window", header: "Window", hideBelow: "lg", cell: (f) => <span className="whitespace-nowrap text-ink-2">{formatDate(f.windowStart)} to {formatDate(f.windowEnd)}</span> },
    { key: "excluded", header: "Excluded", align: "right", hideBelow: "md", sortValue: (f) => f.excludedEvents, cell: (f) => <span className="tabular text-ink">{n(f.excludedEvents)}</span> },
    { key: "auto", header: "Auto-action", hideBelow: "lg", cell: (f) => <span className="whitespace-nowrap text-ink-2">{autoAction[f.autoAction]}</span> },
    { key: "status", header: "Status", hideBelow: "sm", cell: (f) => <StatusBadge tone={flagStatus[f.status]?.tone ?? "neutral"}>{flagStatus[f.status]?.label ?? f.status}</StatusBadge> },
  ]
  const rowActions: RowAction<ChartFlagDto>[] = [
    { label: "Open flag", icon: EyeIcon, onSelect: open },
    { label: "Clear flag", icon: CheckIcon, separatorBefore: true, hidden: (f) => f.status !== "open", disabled: () => !!r, disabledReason: () => r, onSelect: (f) => void d.clear(f) },
    { label: "Confirm flag", icon: XCircleIcon, hidden: (f) => f.status !== "open", disabled: () => !!r, disabledReason: () => r, onSelect: (f) => void d.confirm(f) },
  ]
  return (
    <>
      <DataTable
        label="Chart flags"
        rows={items ?? []}
        columns={columns}
        getId={(f) => f.id}
        loading={!items}
        search={{ placeholder: "Search brand or detector", text: (f) => `${f.brand.name} ${f.detectorLabel}` }}
        rowActions={rowActions}
        empty={{ title: "No flags", body: "The detectors haven't flagged any brand. Flags appear here as soon as one fires." }}
        minWidth={300}
      />
      <FlagSheet id={items?.some((f) => f.id === caseId) ? caseId : null} d={d} onOpenChange={(o) => !o && writeParams({ case: null, flag: null })} />
    </>
  )
}

function FlagSheet({ id, d, onOpenChange }: { id: string | null; d: ReturnType<typeof flagDecisions>; onOpenChange: (o: boolean) => void }) {
  const shown = useLast(id)
  const now = useNow(60_000)
  const { reason, admin } = useAdminSession()
  const q = useApi(shown ? adminKeys.chartFlag(shown) : null, () => getChartFlag(shown!))
  const f = q.data
  if (!shown) return null
  const r = reason("charts.review")
  const actions: TrustAction[] = []
  if (f?.status === "open") {
    actions.push({ key: "confirm", label: "Confirm", icon: XCircleIcon, variant: "secondary", onSelect: () => void d.confirm(f), disabledReason: r })
    actions.push({ key: "clear", label: "Clear flag", icon: CheckIcon, variant: "secondary", onSelect: () => void d.clear(f), disabledReason: r })
  }
  if (f && !f.freeze)
    actions.push({ key: "freeze", label: "Request freeze", icon: SnowflakeIcon, variant: "destructive", disabledReason: reason("charts.freeze"), menu: ([7, 14, 30] as const).map((days) => ({ label: `Freeze for ${days} days`, onSelect: () => void d.request(f.brand, days, f.id) })) })
  if (f?.freeze) actions.push(...freezeActions(f.freeze, d, admin?.id, reason))
  return (
    <DetailSheet
      open={!!id}
      onOpenChange={onOpenChange}
      title={f ? `${f.detectorLabel} on ${f.brand.name}` : "Chart flag"}
      description={f ? `${formatDate(f.windowStart)} to ${formatDate(f.windowEnd)}` : undefined}
      badges={
        f ? (
          <>
            <StatusBadge tone={severityTone[f.severity]}>{f.severity.charAt(0).toUpperCase() + f.severity.slice(1)} severity</StatusBadge>
            <StatusBadge tone={flagStatus[f.status]?.tone ?? "neutral"}>{flagStatus[f.status]?.label}</StatusBadge>
            {f.freeze ? <StatusBadge tone={freezeStatus(f.freeze).tone}>{freezeStatus(f.freeze).label}</StatusBadge> : null}
          </>
        ) : null
      }
      actions={f && actions.length ? <TrustActionBar note="Every decision needs a reason and is recorded in the audit log. A freeze needs a second admin." actions={actions} /> : undefined}
    >
      {q.error && !f ? (
        <LoadError error={q.error} onRetry={() => void q.revalidate()} what="this flag" />
      ) : !f ? (
        <div aria-busy role="status" className="grid gap-2">
          <span className="sr-only">Loading the flag</span>
          <div className="skeleton h-20 rounded-[10px]" />
          <div className="skeleton h-32 rounded-[10px]" />
        </div>
      ) : (
        <>
          <Facts
            items={[
              { label: "Brand", value: f.brand.name },
              { label: "Raised", value: relDays(f.createdAt, now) },
              { label: "Excluded signals", value: <span className="tabular">{n(f.excludedEvents)}</span> },
              { label: "Auto-action", value: autoAction[f.autoAction] },
            ]}
          />
          <DetailSection title="Evidence" aside={<span className="text-[11px] text-ink-3">Counts and ratios only</span>}>
            {f.evidence.length ? (
              <blockquote className="grid gap-1 rounded-[10px] border-l-2 border-violet/60 bg-white/[0.02] px-3 py-2.5 text-[13px] text-ink-2">
                {f.evidence.map((e) => (
                  <p key={e.label}>
                    <span className="text-ink-3">{e.label}: </span>
                    <span className="tabular">{e.value}</span>
                  </p>
                ))}
              </blockquote>
            ) : (
              <EmptyLine>The detector stored no evidence for this flag.</EmptyLine>
            )}
          </DetailSection>
          <DetailSection title="Ranking components" aside={<span className="text-[11px] text-ink-3">Admin only</span>}>
            {f.components.length ? (
              <ul className={cn("divide-y divide-white/[0.07] text-[12px]", insetClass)}>
                {f.components.slice(0, 6).map((c) => (
                  <li key={`${c.chart}-${c.period}-${c.scope}-${c.edition}`} className="grid gap-1 px-3 py-2">
                    <p className="flex justify-between gap-2 text-ink">
                      <span>
                        #{c.rank} on {c.chart.replace(/_/g, " ")}, {c.period}
                        {c.scope !== "global" ? ` (${c.scope})` : ""}
                      </span>
                      <span className="text-ink-3 tabular">{formatDate(c.edition)}</span>
                    </p>
                    <p className="text-ink-3 tabular">
                      {Object.entries(c.components)
                        .slice(0, 8)
                        .map(([k, v]) => `${k} ${v.toFixed(2)}`)
                        .join(", ") || "No components"}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyLine>{f.brand.name} isn&apos;t on a recent edition, so there are no components to show.</EmptyLine>
            )}
          </DetailSection>
          <DetailSection title="Activity">
            <ServerActivity subjectIds={[f.id, f.brand.id]} extra={[{ at: f.createdAt, label: "Flag raised by the detector", detail: f.detectorLabel }]} />
          </DetailSection>
        </>
      )}
    </DetailSheet>
  )
}

function Freezes({ items, ask }: { items?: FreezeDto[]; ask: Ask }) {
  const { reason, admin } = useAdminSession()
  const d = flagDecisions(ask, admin?.id)
  const r = reason("charts.freeze")
  const columns: Column<FreezeDto>[] = [
    { key: "brand", header: "Brand", cell: (z) => <span className="block max-w-[40vw] truncate font-medium text-ink sm:max-w-[220px]">{z.brand.name}</span> },
    { key: "status", header: "Status", cell: (z) => <StatusBadge tone={freezeStatus(z).tone}>{freezeStatus(z).label}</StatusBadge> },
    { key: "by", header: "Requested by", hideBelow: "md", cell: (z) => <span className="whitespace-nowrap text-ink-2">{z.requestedBy.name}</span> },
    { key: "approved", header: "Approved by", hideBelow: "lg", cell: (z) => <span className="whitespace-nowrap text-ink-2">{z.approvedBy?.name ?? "Nobody yet"}</span> },
    { key: "reason", header: "Reason", className: "hidden xl:table-cell", cell: (z) => <span className="block max-w-[260px] truncate text-ink-2">{z.reason}</span> },
  ]
  const rowActions: RowAction<FreezeDto>[] = [
    { label: "Approve freeze", icon: SnowflakeIcon, destructive: true, hidden: (z) => z.status !== "pending_approval", disabled: (z) => !!r || z.requestedBy.id === admin?.id, disabledReason: (z) => r ?? (z.requestedBy.id === admin?.id ? "You requested it. Needs a second admin." : undefined), onSelect: (z) => void d.approve(z) },
    { label: "Lift freeze", icon: LockSimpleOpenIcon, hidden: (z) => z.status !== "active", disabled: () => !!r, disabledReason: () => r, onSelect: (z) => void d.lift(z) },
    { label: "Withdraw request", icon: XCircleIcon, hidden: (z) => z.status !== "pending_approval", disabled: () => !!r, disabledReason: () => r, onSelect: (z) => void d.lift(z) },
  ]
  return (
    <DataTable
      label="Charts freezes"
      rows={items ?? []}
      columns={columns}
      getId={(z) => z.id}
      loading={!items}
      rowActions={rowActions}
      empty={{ title: "No freezes", body: "Request a freeze from a flag. It takes effect once a second admin approves it." }}
      minWidth={300}
    />
  )
}

function Sponsored() {
  const q = useApi(adminKeys.sponsored, listSponsored)
  const columns: Column<SponsoredRowDto>[] = [
    { key: "campaign", header: "Campaign", cell: (s) => <span className="block min-w-0"><span className="block max-w-[40vw] truncate font-medium text-ink sm:max-w-[240px]">{s.name}</span><span className="block text-[11.5px] text-ink-3">{s.brand.name}</span></span> },
    { key: "status", header: "Status", cell: (s) => <StatusBadge tone={s.status === "active" ? "success" : "muted"}>{s.status.charAt(0).toUpperCase() + s.status.slice(1).replace(/_/g, " ")}</StatusBadge> },
    { key: "where", header: "Placements", hideBelow: "md", cell: (s) => <span className="text-ink-2">{s.placements.join(", ").replace(/-/g, " ")}</span> },
  ]
  if (q.error && !q.data) return <LoadError error={q.error} onRetry={() => void q.revalidate()} what="sponsored placements" />
  return (
    <div className="grid gap-3">
      <p className="flex items-start gap-2 text-[12px] text-ink-2">
        <RankingIcon className="mt-0.5 size-3.5 shrink-0 text-ink-3" aria-hidden />
        Read-only. Sponsored brands show in a separate strip after rank 10 and never change a rank. These are the sample campaigns from Advertising.
      </p>
      <DataTable label="Sponsored placements" rows={q.data?.items ?? []} columns={columns} getId={(s) => s.campaignId} loading={!q.data} empty={{ title: "No sponsored brands", body: "Sponsored-brand campaigns from Advertising appear here." }} minWidth={300} />
    </div>
  )
}

