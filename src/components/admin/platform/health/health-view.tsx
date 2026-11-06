"use client"

import { useEffect, useMemo, useState } from "react"
import { motion } from "motion/react"
import { ArrowCounterClockwiseIcon as RotateCcw, ClockCounterClockwiseIcon, HeartbeatIcon, LightningIcon, ShieldSlashIcon as ShieldOff, TimerIcon, WebhooksLogoIcon } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { SampleDataNote } from "@/components/dashboard/page-header"
import { EmptyState } from "@/components/dashboard/empty-state"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { StatCard } from "@/components/dashboard/insight/stat-card"
import { Segmented as Switch } from "@/components/dashboard/insight/segmented"
import { Bone } from "@/components/feedback/skeletons"
import { AdminAreaChart } from "@/components/admin/ui/area-chart"
import { Reveal, RevealItem } from "@/components/admin/ui/motion"
import { Panel } from "@/components/admin/ui/panel"
import { ReasonDialog } from "@/components/admin/ui/reason-dialog"
import { useAsyncAction } from "@/hooks/use-async-action"
import { useNow } from "@/hooks/use-now"
import { failedJobs, healthSeries, healthServices, webhookFailures } from "@/lib/data/admin"
import { formatPercent } from "@/lib/money"
import { useAdmin } from "@/lib/stores/admin"
import { cn } from "@/lib/utils"
import { formatDate, formatDay, int, relDay } from "../format"
import { AdminPageHead, StatRow } from "@/components/admin/marketplace/page-head"
import { focusNextEnabled, useAdminReady, useDialogReturn } from "../ready"
import { authFailures, jobHints, queues, storage } from "./sample"

/** Latency targets (p95, ms) per service; the bar under each service is measured against them. The Overview uses the same targets. */
const latencyTarget: Record<string, number> = { API: 400, "Database (primary)": 50, Search: 200, "Media storage": 300, "Background jobs": 1_500, "Payment webhooks": 800 }

/** The Overview counts open failures from these audit actions, so they stay the store's own wording. */
const RETRY_ACTION = "Retried background job"
const REPLAY_ACTION = "Replayed webhook"
const providerName = (p: string) => p.charAt(0).toUpperCase() + p.slice(1)
const ms = (n: number) => `${int(n)} ms`

/** Where focus goes when a retry or replay disables its button: the next open failure, else the trend's selected tab. */
const NEXT_OPEN_FAILURE = "#failed-jobs li button:not([disabled]), #webhooks li button:not([disabled])"
const TREND_TAB = "#api-trend [role=radio][aria-checked=true]"

/** The panels a link can open (`/admin/health#webhooks`). */
const PANELS = new Set(["services", "api-trend", "failed-jobs", "webhooks"])

/**
 * Brings the panel a link names into view once the page has its real rows, and moves focus to
 * its heading. Following a link from another screen, the browser tries the hash while the route
 * is still loading, finds no panel and stays at the top; this runs again once the rows are in, so
 * the jump lands where the rows end up.
 */
function useLinkedPanel(ready: boolean) {
  useEffect(() => {
    if (!ready) return
    const id = decodeURIComponent(window.location.hash.slice(1))
    if (!PANELS.has(id)) return
    const panel = document.getElementById(id)
    const heading = panel?.querySelector<HTMLElement>("h2")
    if (!panel || !heading) return
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    // Where the panel sits once its entrance settles: its box less any slide it's still part-way through.
    let slide = 0
    for (let el: HTMLElement | null = panel; el; el = el.parentElement) {
      const t = getComputedStyle(el).transform
      if (t && t !== "none") slide += new DOMMatrixReadOnly(t).m42
    }
    const top = panel.getBoundingClientRect().top + window.scrollY - slide - (parseFloat(getComputedStyle(panel).scrollMarginTop) || 0)
    window.scrollTo({ top: Math.max(0, top), behavior: reduce ? "auto" : "smooth" })
    // Focus without a second jump; the heading is a target, not a control, so it leaves the tab order again on blur.
    heading.setAttribute("tabindex", "-1")
    heading.addEventListener("blur", () => heading.removeAttribute("tabindex"), { once: true })
    heading.focus({ preventScroll: true })
  }, [ready])
}

type Job = (typeof failedJobs)[number]
type Hook = (typeof webhookFailures)[number]

/** Retries and replays recorded in this browser: the store's own record, plus older audit entries from before it kept one. */
function useRecorded() {
  const ops = useAdmin((s) => s.ops)
  const audit = useAdmin((s) => s.audit)
  return useMemo(() => {
    const retried = new Set(failedJobs.filter((j) => ops.retriedJobs.includes(j.id) || audit.some((a) => a.action === RETRY_ACTION && (a.subjectId === j.id || a.target.includes(j.id)))).map((j) => j.id))
    const replayed = new Set(webhookFailures.filter((w) => ops.replayedWebhooks.includes(w.id) || audit.some((a) => a.action === REPLAY_ACTION && (a.subjectId === w.id || a.target.includes(w.id)))).map((w) => w.id))
    return { retried, replayed }
  }, [ops, audit])
}

export function HealthView() {
  const ready = useAdminReady()
  const { retried, replayed } = useRecorded()
  useLinkedPanel(ready)

  const degraded = healthServices.filter((s) => s.status !== "operational")
  const operational = healthServices.length - degraded.length
  const api = healthServices.find((s) => s.name === "API")!
  const openJobs = failedJobs.length - retried.size
  const openHooks = webhookFailures.filter((w) => !w.replayable || !replayed.has(w.id)).length

  return (
    <Reveal ssrVisible className="@container grid gap-3">
      <AdminPageHead
        title="Health"
        description="Service status, the API's latency and errors, and the background work that needs an engineer."
        note="Retries and replays are recorded here and in the audit log; they run once the job runner and the payments service are connected. Latency, queue, storage and sign-in figures are sample data."
      />

      <StatRow label="Health figures">
        <RevealItem className="min-w-0">
          <StatCard surface="admin" icon={HeartbeatIcon} label="Services up" value={operational} format={(n) => `${int(n)} of ${healthServices.length}`} hint={degraded.length ? `${degraded.length} degraded: ${degraded.map((s) => s.name).join(", ")}` : "All operational"} href="#services" hrefLabel="Open services" ready={ready} className="h-full" />
        </RevealItem>
        <RevealItem className="min-w-0">
          <StatCard surface="admin" icon={TimerIcon} label="API p95 latency" value={api.latencyP95} format={ms} hint={`Latest day, target under ${ms(latencyTarget.API)}`} href="#api-trend" hrefLabel="Open the latency trend" ready={ready} className="h-full" />
        </RevealItem>
        <RevealItem className="min-w-0">
          <StatCard surface="admin" variant={ready && openJobs ? "brand" : "default"} icon={LightningIcon} label="Failed jobs" value={openJobs} format={int} hint={ready && retried.size ? `${retried.size} ${retried.size === 1 ? "retry" : "retries"} recorded` : "Out of automatic attempts"} href="#failed-jobs" hrefLabel="Open failed jobs" ready={ready} className="h-full" />
        </RevealItem>
        <RevealItem className="min-w-0">
          <StatCard surface="admin" icon={WebhooksLogoIcon} label="Webhook failures" value={openHooks} format={int} hint={ready && replayed.size ? `${replayed.size} ${replayed.size === 1 ? "replay" : "replays"} recorded` : "Payment provider events"} href="#webhooks" hrefLabel="Open webhook failures" ready={ready} className="h-full" />
        </RevealItem>
      </StatRow>

      <Services />
      <Trend />

      <div className="grid gap-3 @5xl:grid-cols-2">
        <FailedJobs retried={retried} ready={ready} />
        <WebhookFailures replayed={replayed} ready={ready} />
      </div>

      <div className="grid gap-3 @3xl:grid-cols-2 @5xl:grid-cols-3">
        <QueueDepth />
        <Storage />
        <AuthFailures className="@3xl:col-span-2 @5xl:col-span-1" />
      </div>
    </Reveal>
  )
}

/* ── Services ─────────────────────────────────────────────────────────── */

/** What we know about a degraded service's cause, when the page has evidence for it. */
const degradedCause: Record<string, string> = {
  "Background jobs": "The failed jobs below are the likely cause. Payments and checkout are not affected.",
}

function Services() {
  return (
    <Panel id="services" title="Services" description="Status, p95 latency against its target, error rate and uptime over 30 days." className="scroll-mt-24 rounded-[20px]">
      <ul className="grid gap-2 @xl:grid-cols-2 @5xl:grid-cols-3">
        {healthServices.map((s) => {
          const target = latencyTarget[s.name] ?? 500
          const ratio = Math.min(1, s.latencyP95 / target)
          const bad = s.status !== "operational"
          return (
            <li key={s.name} className={cn("admin-inset p-3.5", bad && "border-acid/30")}>
              <div className="flex items-center justify-between gap-2">
                <p className="flex min-w-0 items-center gap-2 text-[13px] text-ink">
                  <span aria-hidden className={cn("inline-flex size-2 shrink-0 rounded-full", bad ? "bg-acid" : "bg-violet")} />
                  <span className="truncate">{s.name}</span>
                </p>
                <StatusBadge tone={bad ? "attention" : "muted"}>{bad ? "Degraded" : "Operational"}</StatusBadge>
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2">
                <div>
                  <dt className="text-[11px] text-ink-3">p95</dt>
                  <dd className={cn("font-metric mt-1 text-[1.25rem]", bad ? "text-acid" : "text-ink")}>{ms(s.latencyP95)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-ink-3">Errors</dt>
                  <dd className={cn("font-metric mt-1 text-[1.25rem]", s.errorRate >= 0.01 ? "text-acid" : "text-ink")}>{formatPercent(s.errorRate, 2)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-ink-3">Uptime</dt>
                  <dd className="font-metric mt-1 text-[1.25rem] text-ink">{formatPercent(s.uptime, 2)}</dd>
                </div>
              </dl>
              <div className="mt-3">
                <div className="h-1 overflow-hidden rounded-full bg-white/[0.06]" role="meter" aria-valuemin={0} aria-valuemax={target} aria-valuenow={s.latencyP95} aria-label={`${s.name} p95 latency against a ${target} ms target`}>
                  <motion.div className={cn("h-full origin-left rounded-full", bad ? "bg-acid" : "bg-purple")} initial={{ scaleX: 0 }} animate={{ scaleX: Math.max(0.03, ratio) }} transition={{ type: "spring", stiffness: 110, damping: 20, delay: 0.15 }} />
                </div>
                <p className="mt-1.5 text-[11px] text-ink-3 tabular">Target under {ms(target)}</p>
              </div>
              {bad && degradedCause[s.name] ? <p className="mt-2 border-t border-[var(--admin-hairline)] pt-2 text-[12px] text-ink-2">{degradedCause[s.name]}</p> : null}
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}

/* ── Latency and error trend ─────────────────────────────────────────── */

type Period = "7d" | "30d" | "90d"
const periodDays: Record<Period, number> = { "7d": 7, "30d": 30, "90d": 90 }

function Trend() {
  const [period, setPeriod] = useState<Period>("30d")
  const [metric, setMetric] = useState<"latency" | "errors">("latency")
  // One 90-day series, sliced per period, so a day reads the same in every period.
  const series = useMemo(() => healthSeries(periodDays["90d"]).map((r) => ({ ...r, target: latencyTarget.API })), [])
  const data = useMemo(() => series.slice(-periodDays[period]), [series, period])
  const avg = (k: "latency" | "errors") => data.reduce((s, r) => s + r[k], 0) / Math.max(1, data.length)
  const peak = (k: "latency" | "errors") => data.reduce((m, r) => (r[k] > m[k] ? r : m), data[0])
  const latest = data[data.length - 1]
  const p = peak(metric)
  const total = data.reduce((s, r) => s + r.errors, 0)
  const over = data.filter((r) => r.latency > r.target).length

  const stats =
    metric === "latency"
      ? [
          { label: "Latest p95", value: ms(latest.latency) },
          { label: "Average", value: ms(avg("latency")) },
          { label: `Peak, ${formatDay(p.date)}`, value: ms(p.latency), attention: p.latency > latencyTarget.API },
          { label: "Days over target", value: int(over), attention: over > 0 },
        ]
      : [
          { label: "Failed requests", value: int(total) },
          { label: "Average a day", value: int(avg("errors")) },
          { label: `Peak, ${formatDay(p.date)}`, value: int(p.errors), attention: p.errors > 50 },
          { label: "Latest day", value: int(latest.errors) },
        ]

  return (
    <Panel
      id="api-trend"
      title="API latency and errors"
      description={metric === "latency" ? "Daily p95 latency across the public API, against its 400 ms target." : "Failed requests across the public API, per day."}
      action={<SampleDataNote />}
      className="scroll-mt-24 rounded-[20px]"
    >
      <div className="flex flex-col gap-3 @3xl:flex-row @3xl:items-center @3xl:justify-between">
        <Switch label="Metric" size="sm" value={metric} onChange={setMetric} options={[{ value: "latency", label: "p95 latency" }, { value: "errors", label: "Failed requests" }]} />
        <Switch label="Period" size="sm" value={period} onChange={setPeriod} options={[{ value: "7d", label: "7 days" }, { value: "30d", label: "30 days" }, { value: "90d", label: "90 days" }]} />
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-2 @3xl:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="admin-inset min-w-0 px-3 py-2.5">
            <dt className="truncate text-[11px] text-ink-3">{s.label}</dt>
            <dd className={cn("font-metric mt-1.5 text-[1.375rem]", s.attention ? "text-acid" : "text-ink")}>{s.value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4">
        {metric === "latency" ? (
          <AdminAreaChart key={`l-${period}`} data={data} primary={{ key: "latency", label: "p95 latency" }} secondary={{ key: "target", label: "Target" }} format={ms} height={260} />
        ) : (
          <AdminAreaChart key={`e-${period}`} data={data} primary={{ key: "errors", label: "Failed requests" }} format={int} height={260} />
        )}
      </div>
    </Panel>
  )
}

/* ── Failed background jobs ──────────────────────────────────────────── */

function JobRow({ job, done }: { job: Job; done: boolean }) {
  const retryJob = useAdmin((s) => s.retryJob)
  // Counted from the same today as every other Control Center page.
  const now = useNow(60_000)
  // The label carries the job id: the Overview counts open jobs from it.
  const retry = useAsyncAction(() => {
    retryJob(job.id, `${job.name} (${job.id})`, `Manual retry after: ${job.error}`)
    return true
  })

  async function onRetry(e: React.MouseEvent<HTMLButtonElement>) {
    const self = e.currentTarget
    // A recorded retry disables its button, so focus moves on to the next open failure.
    if (await retry.run()) focusNextEnabled(self, NEXT_OPEN_FAILURE, TREND_TAB)
  }
  return (
    <li className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-start md:px-5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 truncate font-mono text-[12.5px] text-ink">{job.name}</p>
          <StatusBadge tone={done ? "info" : "danger"}>{done ? "Retry recorded" : "Failed"}</StatusBadge>
        </div>
        <p className="mt-1 text-[12px] text-ink-2">{job.error}</p>
        <p className="mt-0.5 text-[11px] text-ink-3">
          {job.queue.charAt(0).toUpperCase() + job.queue.slice(1)} queue, {job.attempts} attempts, failed {relDay(job.failedAt, now)}
        </p>
        {done ? (
          <p className="mt-1.5 text-[11.5px] text-ink-2">It goes back in the {job.queue} queue once the job runner is connected. Recorded in the audit log.</p>
        ) : jobHints[job.id] ? (
          <p className="mt-1.5 text-[11.5px] text-ink-3">{jobHints[job.id]}</p>
        ) : null}
      </div>
      <Button size="sm" variant="secondary" disabled={done} loading={retry.pending} success={retry.succeeded} onClick={(e) => void onRetry(e)} className="h-10 self-start sm:h-8" aria-label={done ? `Retry recorded for ${job.name}` : `Retry ${job.name}`}>
        <RotateCcw aria-hidden />
        {done ? "Recorded" : "Retry"}
      </Button>
    </li>
  )
}

function FailedJobs({ retried, ready }: { retried: Set<string>; ready: boolean }) {
  return (
    <Panel id="failed-jobs" title="Failed background jobs" description="Jobs that ran out of automatic attempts. A retry puts a job back in its queue once; in this build it is recorded and runs when the job runner is connected." className="scroll-mt-24 rounded-[20px]" bodyClassName="px-0 pb-0 md:px-0 md:pb-0">
      {!ready ? (
        <RowsBone rows={failedJobs.length} />
      ) : failedJobs.length ? (
        <ul className="admin-divide border-t border-[var(--admin-hairline)]">
          {failedJobs.map((j) => (
            <JobRow key={j.id} job={j} done={retried.has(j.id)} />
          ))}
        </ul>
      ) : (
        <div className="px-4 pb-4 md:px-5">
          <EmptyState icon={ClockCounterClockwiseIcon} title="No failed jobs" body="Every queue is processing normally." className="py-10" />
        </div>
      )}
    </Panel>
  )
}

/* ── Payment webhook failures ────────────────────────────────────────── */

function WebhookFailures({ replayed, ready }: { replayed: Set<string>; ready: boolean }) {
  const replayWebhook = useAdmin((s) => s.replayWebhook)
  const now = useNow(60_000)
  const [target, setTarget] = useState<Hook | null>(null)
  const [open, setOpen] = useState(false)
  // A recorded replay disables its button, so focus moves on to the next open failure.
  const focus = useDialogReturn([NEXT_OPEN_FAILURE, TREND_TAB])

  function confirm(reason: string) {
    if (!target) return
    // The label carries the event id: the Overview counts open failures from it.
    replayWebhook(target.id, `${target.provider} ${target.event} ${target.id}`, reason)
  }

  return (
    <Panel id="webhooks" title="Payment webhook failures" description="Provider events we stored but couldn't process. Only events with a verified signature can be replayed; in this build a replay is recorded and runs when the payments service is connected." className="scroll-mt-24 rounded-[20px]" bodyClassName="px-0 pb-0 md:px-0 md:pb-0">
      {!ready ? (
        <RowsBone rows={webhookFailures.length} />
      ) : webhookFailures.length ? (
        <ul className="admin-divide border-t border-[var(--admin-hairline)]">
          {webhookFailures.map((w) => {
            const done = replayed.has(w.id)
            return (
              <li key={w.id} className="px-4 py-3.5 md:px-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[13px] text-ink">
                        {providerName(w.provider)} <span className="font-mono text-[12px] text-ink-2">{w.event}</span>
                      </p>
                      <StatusBadge tone={done ? "info" : w.replayable ? "attention" : "danger"}>{done ? "Replay recorded" : w.replayable ? "Can be replayed" : "Signature failed"}</StatusBadge>
                    </div>
                    <p className="mt-1 text-[12px] text-ink-2">{w.reason}</p>
                    <p className="mt-0.5 text-[11px] text-ink-3">
                      Event {w.id}, received {relDay(w.receivedAt, now)}
                    </p>
                    {done ? <p className="mt-1.5 text-[11.5px] text-ink-2">Our handler runs it again once the payments service is connected. Recorded in the audit log.</p> : null}
                  </div>
                  {w.replayable ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={done}
                      className="h-10 self-start sm:h-8"
                      onClick={() => {
                        setTarget(w)
                        focus.openFrom(() => setOpen(true))
                      }}
                      aria-label={done ? `Replay recorded for ${w.id}` : `Replay ${providerName(w.provider)} ${w.event}`}
                    >
                      <RotateCcw aria-hidden />
                      {done ? "Recorded" : "Replay"}
                    </Button>
                  ) : null}
                </div>
                {!w.replayable ? (
                  <div className="admin-inset mt-3 flex items-start gap-2 p-3">
                    <ShieldOff className="mt-0.5 size-3.5 shrink-0 text-ink-3" aria-hidden />
                    <p className="text-[12px] text-ink-2">
                      <span className="text-ink">Can&apos;t be replayed.</span> The signature didn&apos;t match, so there&apos;s no proof {providerName(w.provider)} sent this event, and replaying it could record a payment that never happened. Check the charge with {providerName(w.provider)} directly. Once the payments service is connected, pending charges are also re-verified with the provider every 5 minutes.
                    </p>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : (
        <div className="px-4 pb-4 md:px-5">
          <EmptyState icon={WebhooksLogoIcon} title="No webhook failures" body="Every provider event was verified and processed." className="py-10" />
        </div>
      )}
      <ReasonDialog
        key={target?.id ?? "none"}
        open={open}
        onOpenChange={setOpen}
        title={target ? `Replay ${providerName(target.provider)} ${target.event}` : "Replay event"}
        description={target ? `Event ${target.id}, received ${formatDate(target.receivedAt)}. Our handler runs again on the stored event; processing is idempotent, so a payment or transfer can never post twice, and nothing is sent to ${providerName(target.provider)}. In this build the replay is recorded and runs once the payments service is connected.` : ""}
        confirmLabel="Record replay"
        onConfirm={confirm}
        onCloseAutoFocus={focus.onCloseAutoFocus}
      />
    </Panel>
  )
}

function RowsBone({ rows }: { rows: number }) {
  return (
    <ul aria-hidden className="admin-divide border-t border-[var(--admin-hairline)]">
      {Array.from({ length: Math.max(1, rows) }, (_, i) => (
        <li key={i} className="flex items-start gap-3 px-4 py-3.5 md:px-5">
          <div className="grid flex-1 gap-2">
            <Bone className="h-3.5 w-1/3" />
            <Bone className="h-3 w-2/3" />
            <Bone className="h-3 w-1/2" />
          </div>
          <Bone className="h-8 w-20" />
        </li>
      ))}
    </ul>
  )
}

/* ── Operations (sample figures) ─────────────────────────────────────── */

function QueueDepth() {
  return (
    <Panel title="Queue depth" description="Jobs waiting in each queue, against its alert level." action={<SampleDataNote />} className="rounded-[20px]">
      <ul className="admin-divide">
        {queues.map((q) => {
          const over = q.depth >= q.alertAt
          return (
            <li key={q.key} className="py-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] text-ink">{q.name}</span>
                <span className={cn("font-metric text-[1.125rem]", over ? "text-acid" : "text-ink")}>{int(q.depth)}</span>
              </div>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/[0.06]">
                <motion.div className={cn("h-full origin-left rounded-full", over ? "bg-acid" : "bg-purple")} initial={{ scaleX: 0 }} animate={{ scaleX: Math.max(0.02, Math.min(1, q.depth / q.alertAt)) }} transition={{ type: "spring", stiffness: 110, damping: 20, delay: 0.15 }} />
              </div>
              <p className="mt-1 text-[11px] text-ink-3 tabular">
                Oldest {q.oldest}, alert at {int(q.alertAt)}
                {over ? <span className="text-acid">. Over the alert level</span> : null}
              </p>
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}

function Storage() {
  const used = storage.parts.reduce((s, p) => s + p.gb, 0)
  const perDay = storage.growth7dGb / 7
  const monthsLeft = Math.floor((storage.quotaGb - used) / perDay / 30)
  const tb = (gb: number) => `${(gb / 1000).toFixed(2)} TB`
  const tone = { purple: "bg-purple", violet: "bg-violet", grey: "bg-ink-3", ink: "bg-white/40" }
  return (
    <Panel title="Storage" description="Media storage used, by what it holds." action={<SampleDataNote />} className="rounded-[20px]">
      <p className="flex items-baseline gap-2">
        <span className="font-metric text-[2rem] text-ink">{tb(used)}</span>
        <span className="text-[12px] text-ink-3">of {tb(storage.quotaGb)}</span>
      </p>
      <div className="mt-3 flex h-2 w-full gap-[2px] overflow-hidden rounded-full bg-white/[0.06]" role="img" aria-label={`${formatPercent(used / storage.quotaGb, 0)} of storage used`}>
        {storage.parts.map((p) => (
          <span key={p.label} className={cn("h-full", tone[p.tone])} style={{ width: `${(p.gb / storage.quotaGb) * 100}%` }} />
        ))}
      </div>
      <ul className="admin-divide mt-3">
        {storage.parts.map((p) => (
          <li key={p.label} className="flex items-center justify-between gap-3 py-2 text-[12px]">
            <span className="flex min-w-0 items-center gap-2 text-ink-2">
              <span className={cn("size-2 shrink-0 rounded-full", tone[p.tone])} aria-hidden />
              <span className="truncate">{p.label}</span>
            </span>
            <span className="text-ink tabular">{int(p.gb)} GB</span>
          </li>
        ))}
      </ul>
      <p className={cn("mt-2 text-[12px]", monthsLeft < 6 ? "text-acid" : "text-ink-3")}>
        Up {int(storage.growth7dGb)} GB in 7 days. At this rate the quota is reached in about {monthsLeft} months.
      </p>
    </Panel>
  )
}

function AuthFailures({ className }: { className?: string }) {
  return (
    <Panel title="Auth failures, last 24 hours" description="Sign-in and MFA failures across shoppers, brands and admins." action={<SampleDataNote />} className={cn("rounded-[20px]", className)}>
      <dl className="admin-divide">
        {authFailures.map((a) => (
          <div key={a.label} className="flex items-start justify-between gap-3 py-2.5">
            <dt className="min-w-0">
              <span className="block text-[13px] text-ink">{a.label}</span>
              <span className="block text-[11px] text-ink-3">{a.hint.charAt(0).toUpperCase() + a.hint.slice(1)}</span>
            </dt>
            <dd className={cn("font-metric text-[1.125rem]", a.attention ? "text-acid" : "text-ink")}>{int(a.value)}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  )
}
