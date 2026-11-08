"use client"

import { useId } from "react"
import {
  ArrowClockwiseIcon,
  CaretRightIcon,
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
import { chartBoardLabels, type ChartFlagDto, type ChartHoldDto, type ChartsOverviewDto, type FreezeDto, type SponsoredRowDto } from "@/lib/api/contracts/admin"
import { useApi } from "@/lib/api/use-api"
import { formatNumber, formatPercent } from "@/lib/money"
import type { AdminPermission } from "@/lib/permissions"
import { cn } from "@/lib/utils"
import { LoadError, NotInQueue, ServerActivity, TrustActionBar, TrustGate, sheetTrack, useAdminSession, useQueueFigures, useQueueLive, useServerDecision, type TrustAction } from "./shared"

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
  // Only flags an earlier build froze on approval: approvals now leave flags open.
  frozen: { label: "Frozen", tone: "info" },
}
/** Clear or Confirm applies: an open flag, or one an earlier build froze once no freeze is in force. */
const decidable = (f: ChartFlagDto) => f.status === "open" || (f.status === "frozen" && f.freeze?.status !== "active")
/** "both" for two, "all 3" from three up. */
const allOf = (k: number) => (k === 2 ? "both are" : `all ${k} are`)
const autoAction: Record<string, string> = { none: "Listed for review", excluded_signals: "Signals excluded", held_from_charts: "Held from every board" }
function freezeStatus(f: FreezeDto): { label: string; tone: Tone } {
  if (f.status === "pending_approval") return { label: "Waiting for a second admin", tone: "attention" }
  if (f.status === "active") return { label: f.until ? `Frozen until ${formatDate(f.until)}` : "Frozen", tone: "info" }
  // Its days ran out: the boards no longer apply it (C reads only freezes still in force).
  if (f.status === "expired") return { label: f.until ? `Ended ${formatDate(f.until)}` : "Ended", tone: "muted" }
  // A request closed before anyone approved it never froze anything: it was withdrawn, not lifted.
  return f.approvedBy ? { label: "Lifted", tone: "muted" } : { label: "Withdrawn", tone: "muted" }
}
const approvedWords = (z: FreezeDto) => z.approvedBy?.name ?? (z.status === "pending_approval" ? "Nobody yet" : "Not approved")
/** A flag's window: one date when it starts and ends on the same day. */
const windowWords = (f: { windowStart: string; windowEnd: string }) => (f.windowStart === f.windowEnd ? formatDate(f.windowStart) : `${formatDate(f.windowStart)} to ${formatDate(f.windowEnd)}`)
const periodWords: Record<string, string> = { daily: "daily", weekly: "weekly", monthly: "monthly" }
/** A board scope in words: "global" says nothing; "city:lagos" reads "Lagos". */
function scopeWords(scope: string) {
  if (scope === "global") return ""
  return scope
    .split("|")
    .map((part) => part.replace(/^(city|country|category):/, "").replace(/-/g, " "))
    .map((w) => (w.length === 2 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(", ")
}

/** The ranking formula's symbols (§6.3) in words; p_ is a percentile within the board, w_ the weight applied. */
const COMPONENT_WORDS: Record<string, string> = {
  O: "orders", G: "sales value", F: "net follows", rf: "follower growth", V: "views", WL: "wishlists", E: "messages and post opens", DS: "drop sell-through", RP: "repeat customers",
  R: "reminders", gF: "follow momentum", gV: "view momentum", gWL: "wishlist momentum", gO: "order momentum", gE: "engagement momentum", Q: "quality factor", S: "score",
  value: "ranked value", totalFollowers: "total followers", sellThrough: "sell-through", velocity: "sales velocity",
}
function componentWords(c: Record<string, number>) {
  const word = (k: string) => (k.startsWith("p_") ? `${COMPONENT_WORDS[k.slice(2)] ?? k.slice(2)} percentile` : k.startsWith("w_") ? `${COMPONENT_WORDS[k.slice(2)] ?? k.slice(2)} weight` : (COMPONENT_WORDS[k] ?? k))
  const show = (k: string, v: number) => (k.startsWith("p_") || k.startsWith("w_") || k === "Q" || k === "S" ? v.toFixed(2) : Number.isInteger(v) ? formatNumber(v) : v.toFixed(2))
  const order = (k: string) => (k === "S" ? 0 : k === "Q" ? 1 : k.startsWith("p_") ? 3 : k.startsWith("w_") ? 4 : 2)
  const list = Object.entries(c).sort(([a], [b]) => order(a) - order(b))
  return list.length ? list.slice(0, 8).map(([k, v]) => `${word(k).replace(/^./, (x) => x.toUpperCase())} ${show(k, v)}`).join(", ") : "No components"
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
  useQueueLive(() => {
    void overview.revalidate()
    void flags.revalidate()
  })
  const { ask, dialog } = useServerDecision(() => document.getElementById(segmentedTabId(qid, tab)))
  const o = overview.data
  const figures = useQueueFigures(o, overview.error)
  const ready = figures.ready

  return (
    <div className="grid gap-3">
      {reviewer ? (
        <InPageLinks>
          <StatRow label="Charts integrity figures">
            <RevealItem className="min-w-0">
              <StatCard surface="admin" variant={ready && o?.flags.open ? "brand" : "default"} icon={FlagIcon} label="Open flags" value={o?.flags.open ?? 0} format={figures.format(n)} hint={figures.hint(o ? `${n(o.flags.high)} high severity` : "Computed by the detectors")} href="/admin/charts?tab=flags#charts-panel" hrefLabel="Show flags" ready={ready} className="h-full" />
            </RevealItem>
            <RevealItem className="min-w-0">
              <StatCard surface="admin" variant={ready && o?.flags.pendingFreeze ? "brand" : "default"} icon={SnowflakeIcon} label="Freezes to approve" value={o?.flags.pendingFreeze ?? 0} format={figures.format(n)} hint={figures.hint("Needs a second admin")} href="/admin/charts?tab=frozen#charts-panel" hrefLabel="Show freezes" ready={ready} className="h-full" />
            </RevealItem>
            <RevealItem className="min-w-0">
              <StatCard surface="admin" icon={LockSimpleIcon} label="Frozen brands" value={o?.flags.frozen ?? 0} format={figures.format(n)} hint={figures.hint("Off every board")} href="/admin/charts?tab=frozen#charts-panel" hrefLabel="Show frozen brands" ready={ready} className="h-full" />
            </RevealItem>
            <RevealItem className="min-w-0">
              <StatCard surface="admin" icon={SealCheckIcon} label="Verified signals" value={o?.verifiedShare ?? 0} format={figures.format((v) => (o?.verifiedShare == null ? "No signals" : pct(v)))} hint={figures.hint("Counted, last 7 days")} href="/admin/charts#charts-panel" hrefLabel="Show the overview" ready={ready} className="h-full" />
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
            <Flags items={flags.data?.items} holds={flags.data?.holds} ask={ask} />
          ) : (
            <Freezes items={flags.data?.freezes} holds={flags.data?.holds} ask={ask} />
          )}
        </div>
      </Panel>
      {dialog}
    </div>
  )
}

/** The two plain notes the overview must always show when they apply (§8.1, §10). */
function SignalNotes({ o }: { o: ChartsOverviewDto }) {
  const hops = `${o.proxyHops} trusted proxy ${o.proxyHops === 1 ? "hop" : "hops"}`
  const notes = [
    o.ipSignal === "unavailable"
      ? "IP signal: unavailable — set YARD_TRUSTED_PROXY_HOPS behind a proxy. Without it Yard can't see client IPs, so the IP-based detectors are off now; flags they raised earlier, while it was set, are still listed."
      : `IP signal: on — Yard reads client IPs through ${hops} (YARD_TRUSTED_PROXY_HOPS=${o.proxyHops}), so the IP cap and IP concentration detector run. Addresses are kept only as monthly hashes.`,
    "Order signals: not connected (no payment provider). Sales count only from the labelled sample baseline until payments are confirmed.",
  ]
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
      <p className="text-[12.5px] text-ink-2">{boardSummary(o)}</p>
      <Holds holds={o.holds} compact />
      <ul className="grid gap-2 @xl:grid-cols-2 @5xl:grid-cols-3" aria-label="Boards">
        {o.boards.map((b) => {
          const over = b.totalEvents > 0 && b.excludedShare > o.threshold
          return (
            <li key={b.chart} className="admin-inset p-3.5">
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 truncate text-[13px] text-ink">{b.label}</p>
                <StatusBadge tone={b.openFlags ? "neutral" : "muted"}>{b.openFlags ? `${b.openFlags} open ${b.openFlags === 1 ? "flag" : "flags"}` : "No open flags"}</StatusBadge>
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2">
                <div>
                  <dt className="text-[11px] text-ink-3">Cohort</dt>
                  {b.cohort == null ? <dd className="mt-1.5 text-[12.5px] text-ink-3">No edition yet</dd> : <dd className="font-metric mt-1 text-[1.25rem] text-ink">{n(b.cohort)}</dd>}
                </div>
                <div>
                  <dt className="text-[11px] text-ink-3">Excluded</dt>
                  {b.totalEvents ? <dd className="font-metric mt-1 text-[1.25rem] text-ink">{pct(b.excludedShare)}</dd> : <dd className="mt-1.5 text-[12.5px] text-ink-3">No signals yet</dd>}
                </div>
                <div>
                  <dt className="text-[11px] text-ink-3">Signals, 7 days</dt>
                  <dd className="font-metric mt-1 text-[1.25rem] text-ink">{n(b.totalEvents)}</dd>
                </div>
              </dl>
              <div className="mt-3">
                <div className="h-1 overflow-hidden rounded-full bg-white/[0.06]" role="meter" aria-valuemin={0} aria-valuemax={1} aria-valuenow={b.excludedShare} aria-label={`${b.label}: excluded share against a ${pct(o.threshold)} threshold`}>
                  <motion.div className={cn("h-full origin-left rounded-full", over ? "bg-ink" : "bg-ink-3")} initial={{ scaleX: 0 }} animate={{ scaleX: Math.max(0.03, Math.min(1, b.excludedShare / (o.threshold * 2))) }} transition={{ type: "spring", stiffness: 110, damping: 20, delay: 0.15 }} />
                </div>
                <p className="mt-1.5 text-[11px] text-ink-3 tabular">
                  {b.totalEvents ? `${over ? "Over" : "Under"} the ${pct(o.threshold)} threshold` : "Nothing to measure yet"}{b.edition ? `, edition ${formatDate(b.edition)}` : ", no edition yet"}
                </p>
              </div>
            </li>
          )
        })}
      </ul>

      <div className="grid gap-5 @5xl:grid-cols-[2fr_1fr]">
        <section aria-label="Excluded share by day" className="grid gap-2">
          <h3 className="font-label text-[13px] text-ink">Excluded signals by day</h3>
          <p className="text-[12px] text-ink-3">Share of chart signals excluded as self, restricted, anonymous or suspicious, against the {pct(o.threshold)} threshold. Days with no signals are gaps, not 0%.</p>
          <DailyExcluded o={o} />
        </section>
        <section aria-label="Signal quality" className="grid content-start gap-4">
          <div className="flex items-center gap-4">
            <RingGauge value={o.verifiedShare ?? 0} label="Verified signals" sublabel="Verified signals" size={124} />
            <div className="grid gap-1">
              <p className="text-[12px] leading-snug text-ink-2">{o.totals.total ? `${n(o.totals.counted)} of ${n(o.totals.total)} signals counted in the last 7 days.` : "No signals in the last 7 days yet."}</p>
              <p className="text-[11.5px] leading-snug text-ink-3">
                {o.verifiedShare == null ? "" : o.verifiedShare < 1 - o.threshold ? `Below ${pct(1 - o.threshold)}: excluded signals are over the ${pct(o.threshold)} threshold. ` : `At or above ${pct(1 - o.threshold)}, inside the ${pct(o.threshold)} threshold. `}
                Seeded sample signals count toward it.
              </p>
            </div>
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

/** One line above the tiles: how many boards are over the threshold (boards with no signals apart). */
function boardSummary(o: ChartsOverviewDto) {
  const measured = o.boards.filter((b) => b.totalEvents > 0)
  const over = measured.filter((b) => b.excludedShare > o.threshold).length
  const idle = o.boards.length - measured.length
  const head = measured.length ? `${over} of ${measured.length} ${measured.length === 1 ? "board" : "boards"} over the ${pct(o.threshold)} threshold in the last 7 days` : "No board has signals in the last 7 days"
  return idle && measured.length ? `${head}; ${idle} ${idle === 1 ? "has" : "have"} no signals yet.` : `${head}.`
}

/**
 * The 14-day excluded-share chart. Days before the first signal are left out (with a note), and a
 * day with no signals in between is a gap, so an empty day never reads as a clean 0%.
 */
function DailyExcluded({ o }: { o: ChartsOverviewDto }) {
  const first = o.daily.findIndex((d) => d.total > 0)
  if (first < 0) return <EmptyLine>No chart signals in the last 14 days, so there&apos;s nothing to chart yet.</EmptyLine>
  const days = o.daily.slice(first)
  // recharts draws a null as a gap; the chart's row type only names numbers, hence the cast.
  const rows = days.map((d) => ({ date: d.date, excluded: d.excludedShare as unknown as number, threshold: d.threshold }))
  return (
    <div className="grid gap-1.5">
      <AdminAreaChart data={rows} primary={{ key: "excluded", label: "Excluded share" }} secondary={{ key: "threshold", label: "Threshold" }} format={(v) => (v == null || Number.isNaN(v) ? "No signals" : formatPercent(v, 0))} height={220} />
      {first > 0 ? <p className="text-[11.5px] text-ink-3">No signals before {formatDate(o.daily[first].date)}.</p> : null}
    </div>
  )
}

const plural = (k: number, one: string, many: string) => (k === 1 ? one : many)
/** A detector label inside a sentence: "Coordinated ring" → "coordinated ring", but "IP concentration" keeps its acronym. */
const lc = (s: string) => (/^[A-Z]{2}/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1))
const listWords = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`)

/** What deciding this one flag does to its brand's hold (C's rule: held while ANY open high flag holds it). */
function holdAfter(f: ChartFlagDto) {
  if (!f.hold.holding) return f.severity === "high" ? "" : `This ${f.severity}-severity flag doesn't hold ${f.brand.name} from the boards.`
  if (!f.hold.others.length) return `It's the last flag holding ${f.brand.name}, so ${f.brand.name} returns to the boards at the next recompute.`
  const others = f.hold.others.map((x) => lc(x.detectorLabel))
  return `${f.brand.name} stays off every board: its ${listWords(others)} ${plural(others.length, "flag", "flags")} still ${plural(others.length, "holds", "hold")} it until ${plural(others.length, "that one is", "those are")} cleared or confirmed too.`
}

/**
 * Brands held from every public board and the flags holding each (§6.3; the rule itself is C's and
 * unchanged): every listed flag must be cleared or confirmed before the brand returns.
 */
function Holds({ holds, compact = false, onOpen }: { holds?: ChartHoldDto[]; compact?: boolean; onOpen?: (flagId: string) => void }) {
  if (!holds) return compact ? null : <div className="skeleton h-24 rounded-[12px]" aria-hidden />
  if (!holds.length)
    return compact ? null : <p className="text-[12px] text-ink-3">No brand is held from the boards right now. A high-severity flag holds its brand until it&apos;s cleared or confirmed.</p>
  return (
    <section aria-label="Brands held from the boards" className="grid gap-2.5 rounded-[12px] border border-[var(--admin-hairline)] p-3 sm:p-3.5">
      <div className="grid gap-1">
        <h3 className="font-label text-[13px] text-ink">
          {holds.length} {plural(holds.length, "brand is", "brands are")} held from every public board
        </h3>
        <p className="text-[12px] leading-snug text-ink-3">
          A brand stays off the boards while any open high-severity flag holds it. Clearing a flag counts its excluded signals again; confirming keeps them excluded. Either way the brand returns only once every flag below it is decided, at the next recompute.
        </p>
      </div>
      <ul className="grid gap-2 @3xl:grid-cols-2 @6xl:grid-cols-3">
        {holds.map((h) => (
          <li key={h.brand.id} className="admin-inset grid gap-2 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="min-w-0 truncate text-[13px] font-medium text-ink">{h.brand.name}</p>
              <StatusBadge tone={h.frozen ? "info" : "neutral"}>{h.frozen ? "Also frozen" : `Held since ${formatDate(h.since)}`}</StatusBadge>
            </div>
            <p className="text-[12px] text-ink-2">
              {h.flags.length === 1 ? "1 open flag holds it. Deciding it re-lists the brand." : `${h.flags.length} open flags hold it. Deciding one leaves the other${h.flags.length > 2 ? "s" : ""} holding it.`}
            </p>
            {compact ? (
              <p className="text-[11.5px] text-ink-3">{listWords(h.flags.map((f) => f.detectorLabel))}</p>
            ) : (
              <ul className="grid gap-1">
                {h.flags.map((f) => (
                  <li key={f.id}>
                    <button
                      type="button"
                      onClick={() => onOpen?.(f.id)}
                      aria-label={`Open the ${lc(f.detectorLabel)} flag on ${h.brand.name}`}
                      className="group flex min-h-10 w-full items-center gap-2 rounded-md px-2 text-left text-[12.5px] text-ink outline-none hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-violet sm:min-h-9"
                    >
                      <span className="min-w-0 flex-1 truncate underline decoration-white/25 underline-offset-[3px] group-hover:decoration-white/60">{f.detectorLabel}</span>
                      <span className="shrink-0 text-[11.5px] text-ink-3 tabular">{n(f.excludedEvents)} excluded</span>
                      <CaretRightIcon aria-hidden className="size-3.5 shrink-0 text-ink-3 group-hover:text-ink" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {compact ? (
        <button type="button" onClick={() => writeParams({ tab: "flags", case: null })} className="min-h-10 justify-self-start rounded-md text-left text-[12px] text-ink-2 underline-offset-2 outline-none hover:text-ink hover:underline focus-visible:ring-2 focus-visible:ring-violet sm:min-h-0">
          Show the flags holding them
        </button>
      ) : null}
    </section>
  )
}

function flagDecisions(ask: Ask, me: string | undefined, holds?: ChartHoldDto[]) {
  // Open flags holding the brand right now (they keep holding it after a freeze ends).
  const holding = (brandId: string) => holds?.find((h) => h.brand.id === brandId)?.flags.length ?? 0
  const flagsWords = (k: number) => (k === 1 ? "open flag" : `${k} open flags`)
  return {
    clear: (f: ChartFlagDto) =>
      ask({
        action: "decide-chart-flag",
        body: { id: f.id, outcome: "clear" },
        title: `Clear the ${lc(f.detectorLabel)} flag on ${f.brand.name}?`,
        description: `The signals this flag excluded count again. ${holdAfter(f)} ${f.brand.name} isn't told; your reason stays in the audit log.`,
        fieldLabel: "Reason, for the audit log",
        confirmLabel: "Clear flag",
        done: "Flag cleared",
      }),
    confirm: (f: ChartFlagDto) =>
      ask({
        action: "decide-chart-flag",
        body: { id: f.id, outcome: "confirm" },
        title: `Confirm the ${lc(f.detectorLabel)} flag on ${f.brand.name}?`,
        description: `The flagged signals stay excluded and ${f.brand.name} ranks on its genuine signals only. ${holdAfter(f)} Request a freeze to keep it off the charts. Your reason stays in the audit log.`,
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
        description: `${z.requestedBy.name} asked for it: "${z.reason.replace(/[.!?]+$/, "")}." ${z.brand.name} leaves every board${z.until ? ` until ${formatDate(z.until)}` : ""} and is told it's paused because of unusual activity.${
          holding(z.brand.id)
            ? ` Its ${flagsWords(holding(z.brand.id))} ${holding(z.brand.id) === 1 ? "stays" : "stay"} open: when the freeze ends, ${z.brand.name} stays off the boards until ${holding(z.brand.id) === 1 ? "it is" : allOf(holding(z.brand.id))} cleared or confirmed.`
            : ""
        }`,
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
        description:
          z.status === "pending_approval"
            ? "Nothing changed on the boards yet, so withdrawing only closes the request. Your reason stays in the audit log."
            : holding(z.brand.id)
              ? `${z.brand.name} still stays off the boards: its ${flagsWords(holding(z.brand.id))} ${holding(z.brand.id) === 1 ? "holds" : "hold"} it until ${holding(z.brand.id) === 1 ? "it is" : allOf(holding(z.brand.id))} cleared or confirmed, and it isn't told the pause ended until then. Your reason stays in the audit log.`
              : `${z.brand.name} can rank again at the next recompute and is told the pause ended. Your reason stays in the audit log.`,
        fieldLabel: "Reason, for the audit log",
        confirmLabel: z.status === "pending_approval" ? "Withdraw request" : "Lift freeze",
        done: z.status === "pending_approval" ? "Freeze request withdrawn" : "Freeze lifted",
      }),
  }
}

function freezeActions(z: FreezeDto | null, d: ReturnType<typeof flagDecisions>, me: string | undefined, reason: (p: AdminPermission) => string | undefined): TrustAction[] {
  if (!z || z.status === "lifted" || z.status === "expired") return []
  const r = reason("charts.freeze")
  const out: TrustAction[] = [{ key: "lift", label: z.status === "pending_approval" ? "Withdraw request" : "Lift freeze", icon: LockSimpleOpenIcon, variant: "secondary", onSelect: () => void d.lift(z), disabledReason: r }]
  if (z.status === "pending_approval") out.push({ key: "approve", label: "Approve freeze", icon: SnowflakeIcon, variant: "destructive", onSelect: () => void d.approve(z), disabledReason: r ?? (z.requestedBy.id === me ? "You requested it. Needs a second admin." : undefined) })
  return out
}

function Flags({ items, holds, ask }: { items?: ChartFlagDto[]; holds?: ChartHoldDto[]; ask: Ask }) {
  const { reason, admin } = useAdminSession()
  const caseParam = useSearchParam("case")
  const flagParam = useSearchParam("flag")
  const caseId = caseParam ?? flagParam
  const d = flagDecisions(ask, admin?.id, holds)
  const missing = !!caseId && !!items && !items.some((f) => f.id === caseId)
  const r = reason("charts.review")
  const open = (f: ChartFlagDto) => writeParams({ case: f.id })
  const columns: Column<ChartFlagDto>[] = [
    {
      key: "brand",
      header: "Brand",
      sortValue: (f) => f.brand.name,
      cell: (f) => (
        <button type="button" onClick={() => open(f)} className="group block min-h-10 max-w-full min-w-0 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-violet">
          <span className="block max-w-[40vw] truncate font-medium text-ink group-hover:text-violet sm:max-w-[220px]">{f.brand.name}</span>
          <span className="block max-w-[40vw] truncate text-[11.5px] text-ink-3 sm:max-w-[220px]">
            {f.detectorLabel}
            <span className="lg:hidden">{f.hold.holding ? ", holding the brand" : ""}</span>
          </span>
        </button>
      ),
    },
    { key: "severity", header: "Severity", sortValue: (f) => ({ high: 0, medium: 1, low: 2 })[f.severity], cell: (f) => <StatusBadge tone={severityTone[f.severity]}>{f.severity.charAt(0).toUpperCase() + f.severity.slice(1)}</StatusBadge> },
    { key: "window", header: "Window", hideBelow: "lg", cell: (f) => <span className="whitespace-nowrap text-ink-2">{windowWords(f)}</span> },
    { key: "excluded", header: "Excluded", align: "right", hideBelow: "md", sortValue: (f) => f.excludedEvents, cell: (f) => <span className="tabular text-ink">{n(f.excludedEvents)}</span> },
    { key: "auto", header: "Auto-action", hideBelow: "lg", cell: (f) => <span className="whitespace-nowrap text-ink-2">{autoWords(f)}</span> },
    { key: "status", header: "Status", hideBelow: "sm", cell: (f) => <StatusBadge tone={flagStatus[f.status]?.tone ?? "neutral"}>{flagStatus[f.status]?.label ?? f.status}</StatusBadge> },
  ]
  const rowActions: RowAction<ChartFlagDto>[] = [
    { label: "Open flag", icon: EyeIcon, onSelect: open },
    { label: "Clear flag", icon: CheckIcon, separatorBefore: true, hidden: (f) => !decidable(f), disabled: () => !!r, disabledReason: () => r, onSelect: (f) => void d.clear(f) },
    { label: "Confirm flag", icon: XCircleIcon, hidden: (f) => !decidable(f), disabled: () => !!r, disabledReason: () => r, onSelect: (f) => void d.confirm(f) },
  ]
  return (
    <div className="grid gap-3">
      <Holds holds={holds} onOpen={(id) => writeParams({ case: id })} />
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
      {missing ? (
        <DetailSheet open onOpenChange={(o) => !o && writeParams({ case: null, flag: null })} title="Flag not found">
          <NotInQueue what="flag" href="/admin/charts?tab=flags" queue="the flags" />
        </DetailSheet>
      ) : null}
    </div>
  )
}

/** The auto-action in words, with whether the hold still applies (a decided flag holds nothing). */
function autoWords(f: ChartFlagDto) {
  if (f.hold.holding) return f.hold.others.length ? `Holding, with ${f.hold.others.length} other ${plural(f.hold.others.length, "flag", "flags")}` : "Holding the brand"
  if (f.autoAction === "held_from_charts") {
    const on = f.decidedAt ? ` ${formatDate(f.decidedAt)}` : ""
    if (f.status === "cleared") return `Was holding, cleared${on}`
    if (f.status === "confirmed") return `Was holding, confirmed${on}`
    return "Held until decided; no longer holding"
  }
  return autoAction[f.autoAction]
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
  if (f && decidable(f)) {
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
      description={f ? windowWords(f) : undefined}
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
              { label: "Auto-action", value: autoWords(f) },
            ]}
          />
          <DetailSection className={sheetTrack} title="Hold on the boards">
            <HoldNote f={f} />
          </DetailSection>
          <DetailSection className={sheetTrack} title="Evidence" aside={<span className="text-[11px] text-ink-3">Counts and ratios only</span>}>
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
          <DetailSection className={sheetTrack} title="Ranking components" aside={<span className="text-[11px] text-ink-3">Admin only</span>}>
            {f.components.length ? (
              <ul className={cn("divide-y divide-white/[0.07] text-[12px]", insetClass)}>
                {f.components.slice(0, 6).map((c) => (
                  <li key={`${c.chart}-${c.period}-${c.scope}-${c.edition}`} className="grid gap-1 px-3 py-2">
                    <p className="flex justify-between gap-2 text-ink">
                      <span>
                        #{c.rank} on {chartBoardLabels[c.chart] ?? c.chart.replace(/_/g, " ")}, {periodWords[c.period] ?? c.period}
                        {scopeWords(c.scope) ? ` (${scopeWords(c.scope)})` : ""}
                      </span>
                      <span className="text-ink-3 tabular">{formatDate(c.edition)}</span>
                    </p>
                    <p className="text-ink-3 tabular">{componentWords(c.components)}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyLine>{f.brand.name} isn&apos;t on a recent edition, so there are no components to show.</EmptyLine>
            )}
          </DetailSection>
          <DetailSection title="Activity" className={sheetTrack}>
            <ServerActivity subjectIds={[f.id, f.brand.id]} extra={[{ at: f.createdAt, label: "Flag raised by the detector", detail: f.detectorLabel }]} />
          </DetailSection>
        </>
      )}
    </DetailSheet>
  )
}

/** Which flags hold this brand, what deciding this one does, and the ring caveat (C's request). */
function HoldNote({ f }: { f: ChartFlagDto }) {
  const lines: React.ReactNode[] = []
  if (f.hold.holding) {
    lines.push(
      f.hold.others.length ? (
        <>
          This flag holds {f.brand.name} off every public board, and so {plural(f.hold.others.length, "does", "do")} its open{" "}
          {listWords(f.hold.others.map((o) => lc(o.detectorLabel)))} {plural(f.hold.others.length, "flag", "flags")}.{" "}
          {f.brand.name} returns only when {allOf(f.hold.others.length + 1)} cleared or confirmed.
        </>
      ) : (
        <>This is the only open flag holding {f.brand.name}. Clearing or confirming it re-lists {f.brand.name} at the next recompute.</>
      ),
    )
    lines.push(<>Clear: the signals it excluded count again. Confirm: they stay excluded and {f.brand.name} ranks on its genuine signals only.</>)
  } else if (f.status === "open") {
    lines.push(<>This {f.severity}-severity flag doesn&apos;t hold {f.brand.name} from the boards{f.autoAction === "excluded_signals" ? "; its signals are excluded while it's open" : "; it's listed for review only"}.</>)
  } else if (f.status === "frozen") {
    lines.push(
      f.freeze?.status === "active" ? (
        <>An earlier build marked this flag frozen when the freeze on {f.brand.name} was approved. The freeze keeps {f.brand.name} off every board; clear or confirm this flag once it ends.</>
      ) : (
        <>An earlier build marked this flag frozen when a freeze was approved, and no freeze is in force now, so it doesn&apos;t hold {f.brand.name}. Nobody has cleared or confirmed it: do that to close it.</>
      ),
    )
  } else {
    const when = f.decidedAt ? ` on ${formatDate(f.decidedAt)}` : ""
    lines.push(<>{f.status === "cleared" ? "Cleared" : "Confirmed"}{when}, so this flag no longer holds {f.brand.name}.{f.hold.others.length ? ` Its open ${listWords(f.hold.others.map((o) => lc(o.detectorLabel)))} ${plural(f.hold.others.length, "flag still holds", "flags still hold")} it.` : ""}</>)
  }
  if (f.freeze?.status === "active" && f.hold.holding)
    lines.push(<>A Charts freeze is in force too{f.freeze.until ? ` until ${formatDate(f.freeze.until)}` : ""}. When it ends, {f.brand.name} stays off the boards until its open flags are cleared or confirmed.</>)
  if (f.detector === "coordinated_ring")
    lines.push(
      <>
        A coordinated ring holds every brand it followed{f.ringPeers.length ? <> ({listWords(f.ringPeers.map((b) => b.name))} {plural(f.ringPeers.length, "is", "are")} flagged and held the same way)</> : null}. A ring can follow a brand that had no part in it, so check each brand&apos;s evidence before you confirm.
      </>,
    )
  return (
    <div className="grid gap-1.5 text-[12.5px] leading-snug text-ink-2">
      {lines.map((l, i) => (
        <p key={i}>{l}</p>
      ))}
    </div>
  )
}

function Freezes({ items, holds, ask }: { items?: FreezeDto[]; holds?: ChartHoldDto[]; ask: Ask }) {
  const { reason, admin } = useAdminSession()
  const d = flagDecisions(ask, admin?.id, holds)
  const r = reason("charts.freeze")
  const columns: Column<FreezeDto>[] = [
    { key: "brand", header: "Brand", cell: (z) => <span className="block max-w-[40vw] truncate font-medium text-ink sm:max-w-[220px]">{z.brand.name}</span> },
    { key: "status", header: "Status", cell: (z) => <StatusBadge tone={freezeStatus(z).tone}>{freezeStatus(z).label}</StatusBadge> },
    { key: "by", header: "Requested by", hideBelow: "md", cell: (z) => <span className="whitespace-nowrap text-ink-2">{z.requestedBy.name}</span> },
    { key: "approved", header: "Approved by", hideBelow: "lg", cell: (z) => <span className={cn("whitespace-nowrap", z.approvedBy ? "text-ink-2" : "text-ink-3")}>{approvedWords(z)}</span> },
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

