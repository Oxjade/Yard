"use client"

import { useMemo, useState } from "react"
import { toast } from "sonner"
import { ArrowCounterClockwiseIcon as RotateCcw, ShieldSlashIcon as ShieldOff } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { TimeSeriesChart } from "@/components/dashboard/chart-card"
import { EmptyState } from "@/components/dashboard/empty-state"
import { MetricTile } from "@/components/dashboard/metric-tile"
import { PageHeader, SampleDataNote } from "@/components/dashboard/page-header"
import { PeriodSelect, periodDays, type Period } from "@/components/dashboard/period-select"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { failedJobs, healthSeries, healthServices, webhookFailures } from "@/lib/data/admin"
import { formatPercent } from "@/lib/money"
import { useAdmin } from "@/lib/stores/admin"
import { cn } from "@/lib/utils"
import { formatDate, formatDay, int, relDay } from "../format"
import { PlatformPanel } from "../panel"
import { ReasonDialog, Warning, type ReasonAction } from "../reason-dialog"
import { authFailures, jobHints, queues, storage } from "./sample"

/** Latency targets (p95, ms) per service; the bar under each service is measured against them. */
const latencyTarget: Record<string, number> = { API: 400, "Database (primary)": 50, Search: 200, "Media storage": 300, "Background jobs": 1_500, "Payment webhooks": 800 }

const RETRY_ACTION = "Retried background job"
const REPLAY_ACTION = "Replayed webhook"
const providerName = (p: string) => p.charAt(0).toUpperCase() + p.slice(1)

export function HealthView() {
  const audit = useAdmin((s) => s.audit)
  const retried = useMemo(() => new Set(failedJobs.filter((j) => audit.some((a) => a.action === RETRY_ACTION && a.target.includes(j.id))).map((j) => j.id)), [audit])
  const replayed = useMemo(() => new Set(webhookFailures.filter((w) => audit.some((a) => a.action === REPLAY_ACTION && a.target.includes(w.id))).map((w) => w.id)), [audit])

  const operational = healthServices.filter((s) => s.status === "operational").length
  const degraded = healthServices.length - operational
  const api = healthServices.find((s) => s.name === "API")!
  const openJobs = failedJobs.length - retried.size
  const openHooks = webhookFailures.filter((w) => w.replayable && !replayed.has(w.id)).length + webhookFailures.filter((w) => !w.replayable).length

  return (
    <div className="grid gap-5">
      <PageHeader title="Health" description="Service status, error trends and the background work that needs an engineer.">
        <SampleDataNote className="mt-2" />
      </PageHeader>

      <section aria-label="Health figures" className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <MetricTile density="dense" label="Services operational" value={operational} format={(n) => `${int(n)} of ${healthServices.length}`} highlight={degraded > 0} hint={degraded ? `${int(degraded)} degraded` : "all normal"} />
        <MetricTile density="dense" label="API p95 latency" value={api.latencyP95} format={(n) => `${int(n)} ms`} hint={`target under ${latencyTarget.API} ms`} />
        <MetricTile density="dense" label="Failed jobs" value={openJobs} format={int} highlight={openJobs > 0} hint={retried.size ? `${retried.size} retry recorded` : "need a retry"} />
        <MetricTile density="dense" label="Webhook failures" value={openHooks} format={int} highlight={openHooks > 0} hint={replayed.size ? `${replayed.size} replay recorded` : "payments"} />
      </section>

      <Services />
      <Trend />

      <div className="grid gap-5 xl:grid-cols-2">
        <FailedJobs retried={retried} />
        <WebhookFailures replayed={replayed} />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <QueueDepth />
        <Storage />
        <AuthFailures />
      </div>
    </div>
  )
}

/* ── Services ─────────────────────────────────────────────────────────── */

/** What we know about a degraded service's cause, when the page has evidence for it. */
const degradedCause: Record<string, string> = {
  "Background jobs": "The failed jobs below are the likely cause; payments and checkout are not affected.",
}

function Services() {
  const degraded = healthServices.filter((s) => s.status !== "operational")
  return (
    <PlatformPanel title="Services" description="Status, p95 latency against its target, error rate and uptime over 30 days.">
      {degraded.length ? (
        <div className="mb-3 grid gap-2">
          {degraded.map((s) => (
            <Warning key={s.name}>
              {s.name} is degraded: p95 {int(s.latencyP95)} ms and {formatPercent(s.errorRate, 1)} errors.{degradedCause[s.name] ? ` ${degradedCause[s.name]}` : ""}
            </Warning>
          ))}
        </div>
      ) : null}
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {healthServices.map((s) => {
          const target = latencyTarget[s.name] ?? 500
          const ratio = Math.min(1, s.latencyP95 / target)
          const bad = s.status !== "operational"
          return (
            <li key={s.name} className={cn("rounded-md border bg-surface/50 p-3", bad ? "border-acid/30" : "border-line-soft")}>
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-[13px] font-medium text-ink">{s.name}</p>
                <StatusBadge tone={bad ? "attention" : "success"}>{bad ? "Degraded" : "Operational"}</StatusBadge>
              </div>
              <p className="mt-1 text-[11px] text-ink-3 tabular sm:hidden">
                p95 <span className={bad ? "text-acid" : "text-ink-2"}>{int(s.latencyP95)} ms</span> of {int(target)} ms, <span className={s.errorRate >= 0.01 ? "text-acid" : "text-ink-2"}>{formatPercent(s.errorRate, 2)}</span> errors, {formatPercent(s.uptime, 2)} up
              </p>
              <dl className="mt-3 hidden grid-cols-3 gap-2 sm:grid">
                <div>
                  <dt className="text-[11px] text-ink-3">p95</dt>
                  <dd className="mt-0.5 text-[13px] text-ink tabular">{int(s.latencyP95)} ms</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-ink-3">Errors</dt>
                  <dd className={cn("mt-0.5 text-[13px] tabular", s.errorRate >= 0.01 ? "text-acid" : "text-ink")}>{formatPercent(s.errorRate, 2)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-ink-3">Uptime</dt>
                  <dd className="mt-0.5 text-[13px] text-ink tabular">{formatPercent(s.uptime, 2)}</dd>
                </div>
              </dl>
              <div className="mt-2 sm:mt-3">
                <div className="h-1 overflow-hidden rounded-full bg-white/[0.06]" role="meter" aria-valuemin={0} aria-valuemax={target} aria-valuenow={s.latencyP95} aria-label={`${s.name} p95 latency against a ${target} ms target`}>
                  <div className={cn("h-full rounded-full", bad ? "bg-acid" : "bg-purple")} style={{ width: `${Math.max(3, ratio * 100)}%` }} />
                </div>
                <p className="mt-1 hidden text-[11px] text-ink-3 tabular sm:block">Target under {int(target)} ms</p>
              </div>
            </li>
          )
        })}
      </ul>
    </PlatformPanel>
  )
}

/* ── Latency and error trend ─────────────────────────────────────────── */

function Trend() {
  const [period, setPeriod] = useState<Period>("30d")
  const data = useMemo(() => healthSeries(periodDays[period]), [period])
  const avg = (k: "latency" | "errors") => data.reduce((s, r) => s + r[k], 0) / Math.max(1, data.length)
  const peak = (k: "latency" | "errors") => data.reduce((m, r) => (r[k] > m[k] ? r : m), data[0])
  const latest = data[data.length - 1]
  const lp = peak("latency")
  const ep = peak("errors")
  const totalErrors = data.reduce((s, r) => s + r.errors, 0)

  return (
    <PlatformPanel
      title="API latency and errors"
      description="Daily p95 latency and failed requests across the public API."
      action={<PeriodSelect value={period} onChange={setPeriod} options={["7d", "30d", "90d"]} />}
    >
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="min-w-0">
          <dl className="mb-3 grid grid-cols-3 gap-2">
            <Stat label="Latest p95" value={`${int(latest.latency)} ms`} />
            <Stat label="Average" value={`${int(avg("latency"))} ms`} />
            <Stat label={`Peak, ${formatDay(lp.date)}`} value={`${int(lp.latency)} ms`} attention={lp.latency > 300} />
          </dl>
          <TrendChart data={data} kind="latency" />
        </div>
        <div className="min-w-0">
          <dl className="mb-3 grid grid-cols-3 gap-2">
            <Stat label="Errors, period" value={int(totalErrors)} />
            <Stat label="Average a day" value={int(avg("errors"))} />
            <Stat label={`Peak, ${formatDay(ep.date)}`} value={int(ep.errors)} attention={ep.errors > 50} />
          </dl>
          <TrendChart data={data} kind="errors" />
        </div>
      </div>
    </PlatformPanel>
  )
}

function Stat({ label, value, attention = false }: { label: string; value: string; attention?: boolean }) {
  return (
    <div className="min-w-0 rounded-md border border-line-soft bg-surface/50 px-2.5 py-2">
      <dt className="truncate text-[11px] text-ink-3">{label}</dt>
      <dd className={cn("mt-0.5 text-[13px] font-medium tabular", attention ? "text-acid" : "text-ink")}>{value}</dd>
    </div>
  )
}

function TrendChart({ data, kind }: { data: { date: string; latency: number; errors: number }[]; kind: "latency" | "errors" }) {
  return kind === "latency" ? (
    <TimeSeriesChart data={data} series={[{ key: "latency", label: "p95 latency" }]} format={(n) => `${int(n)} ms`} height={200} />
  ) : (
    <TimeSeriesChart data={data} series={[{ key: "errors", label: "Failed requests" }]} format={int} height={200} kind="bar" />
  )
}

/* ── Failed background jobs ──────────────────────────────────────────── */

function FailedJobs({ retried }: { retried: Set<string> }) {
  const log = useAdmin((s) => s.log)

  function retry(job: (typeof failedJobs)[number]) {
    log(RETRY_ACTION, `${job.name} (${job.id})`, `Manual retry after: ${job.error}`)
    toast("Retry recorded", { description: `${job.name} goes back in the ${job.queue} queue once the job runner is connected. Logged in the audit trail.` })
  }

  return (
    <PlatformPanel title="Failed background jobs" description="Jobs that ran out of automatic attempts. A retry puts the job back in its queue once." flush>
      {failedJobs.length ? (
        <ul className="divide-y divide-line-soft border-t border-line-soft">
          {failedJobs.map((j) => {
            const done = retried.has(j.id)
            return (
              <li key={j.id} className="flex flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="min-w-0 truncate text-[13px] font-medium text-ink">{j.name}</p>
                    <StatusBadge tone={done ? "info" : "danger"}>{done ? "Retry recorded" : "Failed"}</StatusBadge>
                  </div>
                  <p className="mt-0.5 text-[12px] text-ink-2">{j.error}</p>
                  <p className="mt-0.5 text-[11px] text-ink-3">
                    {j.queue.charAt(0).toUpperCase() + j.queue.slice(1)} queue, {j.attempts} attempts, failed {relDay(j.failedAt)}
                  </p>
                  {jobHints[j.id] ? <p className="mt-1 text-[11px] text-ink-3">{jobHints[j.id]}</p> : null}
                </div>
                <Button size="xs" variant="secondary" disabled={done} onClick={() => retry(j)} className="self-start" aria-label={done ? `Retry recorded for ${j.name}` : `Retry ${j.name}`}>
                  <RotateCcw aria-hidden />
                  {done ? "Recorded" : "Retry"}
                </Button>
              </li>
            )
          })}
        </ul>
      ) : (
        <div className="px-4 pb-4">
          <EmptyState title="No failed jobs" body="Every queue is processing normally." className="py-10" />
        </div>
      )}
    </PlatformPanel>
  )
}

/* ── Payment webhook failures ────────────────────────────────────────── */

function WebhookFailures({ replayed }: { replayed: Set<string> }) {
  const log = useAdmin((s) => s.log)
  const [target, setTarget] = useState<(typeof webhookFailures)[number] | null>(null)
  const [open, setOpen] = useState(false)

  const action: ReasonAction | null = target
    ? {
        title: `Replay ${providerName(target.provider)} ${target.event}`,
        body: "Runs our handler again on the event we stored. Processing is idempotent, so a payment or transfer can never post twice, and the raw event is never sent again.",
        confirmLabel: "Replay event",
        tone: "primary",
        presets: ["Handler timed out; event stored", "Provider confirmed the transfer succeeded"],
        facts: [
          { label: "Provider", value: providerName(target.provider) },
          { label: "Event", value: target.event },
          { label: "Received", value: formatDate(target.receivedAt) },
          { label: "Event id", value: target.id },
        ],
      }
    : null

  async function confirm(reason: string) {
    if (!target) return
    log(REPLAY_ACTION, `${target.provider} ${target.event} ${target.id}`, reason)
    toast("Replay recorded", { description: `${providerName(target.provider)} ${target.event} is reprocessed once the payments service is connected. Logged in the audit trail.` })
  }

  return (
    <PlatformPanel title="Payment webhook failures" description="Provider events we stored but couldn't process. Only events with a verified signature can be replayed." flush>
      {webhookFailures.length ? (
        <ul className="divide-y divide-line-soft border-t border-line-soft">
          {webhookFailures.map((w) => {
            const done = replayed.has(w.id)
            return (
              <li key={w.id} className="px-4 py-2.5">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[13px] font-medium text-ink">
                        {providerName(w.provider)} <span className="text-ink-2">{w.event}</span>
                      </p>
                      <StatusBadge tone={done ? "info" : w.replayable ? "attention" : "danger"}>{done ? "Replay recorded" : w.replayable ? "Replayable" : "Signature failed"}</StatusBadge>
                    </div>
                    <p className="mt-0.5 text-[12px] text-ink-2">{w.reason}</p>
                    <p className="mt-0.5 text-[11px] text-ink-3">
                      {w.id}, received {relDay(w.receivedAt)}
                    </p>
                  </div>
                  {w.replayable ? (
                    <Button
                      size="xs"
                      variant="secondary"
                      disabled={done}
                      className="self-start"
                      onClick={() => {
                        setTarget(w)
                        setOpen(true)
                      }}
                    >
                      <RotateCcw aria-hidden />
                      {done ? "Recorded" : "Replay"}
                    </Button>
                  ) : null}
                </div>
                {!w.replayable ? (
                  <div className="mt-2 flex items-start gap-2 rounded-md border border-line-soft bg-surface/50 p-2.5">
                    <ShieldOff className="mt-0.5 size-3.5 shrink-0 text-ink-3" aria-hidden />
                    <p className="text-[12px] text-ink-2">
                      <span className="text-ink">Can&apos;t be replayed.</span> The signature didn&apos;t match, so we can&apos;t prove {providerName(w.provider)} sent this event. Replaying it could record a payment that never happened. Check the charge directly with {providerName(w.provider)}; the payment sweeper re-verifies pending charges every 5 minutes.
                    </p>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : (
        <div className="px-4 pb-4">
          <EmptyState title="No webhook failures" body="Every provider event was verified and processed." className="py-10" />
        </div>
      )}
      <ReasonDialog action={action} open={open} onOpenChange={setOpen} onConfirm={confirm} />
    </PlatformPanel>
  )
}

/* ── Operations (sample figures) ─────────────────────────────────────── */

function QueueDepth() {
  return (
    <PlatformPanel title="Queue depth" description="Jobs waiting in each queue, against its alert level." action={<SampleDataNote />}>
      <ul className="divide-y divide-line-soft">
        {queues.map((q) => {
          const over = q.depth >= q.alertAt
          return (
            <li key={q.key} className="py-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] text-ink">{q.name}</span>
                <span className={cn("text-[13px] tabular", over ? "text-acid" : "text-ink")}>{int(q.depth)}</span>
              </div>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/[0.06]">
                <div className={cn("h-full rounded-full", over ? "bg-acid" : "bg-purple")} style={{ width: `${Math.max(2, Math.min(1, q.depth / q.alertAt) * 100)}%` }} />
              </div>
              <p className="mt-1 text-[11px] text-ink-3 tabular">
                Oldest {q.oldest}, alert at {int(q.alertAt)}
              </p>
            </li>
          )
        })}
      </ul>
    </PlatformPanel>
  )
}

function Storage() {
  const used = storage.parts.reduce((s, p) => s + p.gb, 0)
  const perDay = storage.growth7dGb / 7
  const monthsLeft = Math.floor((storage.quotaGb - used) / perDay / 30)
  const tb = (gb: number) => `${(gb / 1000).toFixed(2)} TB`
  const tone = { purple: "bg-purple", violet: "bg-violet", grey: "bg-ink-3", ink: "bg-white/40" }
  return (
    <PlatformPanel title="Storage" description="Media storage used, by what it holds." action={<SampleDataNote />}>
      <p className="text-lg font-medium text-ink tabular">
        {tb(used)} <span className="text-[13px] font-normal text-ink-3">of {tb(storage.quotaGb)}</span>
      </p>
      <div className="mt-3 flex h-2 w-full gap-[2px] overflow-hidden rounded-full bg-white/[0.06]" role="img" aria-label={`${formatPercent(used / storage.quotaGb, 0)} of storage used`}>
        {storage.parts.map((p) => (
          <span key={p.label} className={cn("h-full", tone[p.tone])} style={{ width: `${(p.gb / storage.quotaGb) * 100}%` }} />
        ))}
      </div>
      <ul className="mt-3 divide-y divide-line-soft">
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
      <p className={cn("mt-2 text-[11px]", monthsLeft < 6 ? "text-acid" : "text-ink-3")}>
        Up {int(storage.growth7dGb)} GB in 7 days. At this rate the quota is reached in about {monthsLeft} months.
      </p>
    </PlatformPanel>
  )
}

function AuthFailures() {
  return (
    <PlatformPanel title="Auth failures, last 24 hours" description="Sign-in and MFA failures across shoppers, brands and admins." action={<SampleDataNote />}>
      <dl className="divide-y divide-line-soft">
        {authFailures.map((a) => (
          <div key={a.label} className="flex items-start justify-between gap-3 py-2.5">
            <dt className="min-w-0">
              <span className="block text-[13px] text-ink">{a.label}</span>
              <span className="block text-[11px] text-ink-3">{a.hint}</span>
            </dt>
            <dd className={cn("text-[13px] tabular", a.attention ? "text-acid" : "text-ink")}>{int(a.value)}</dd>
          </div>
        ))}
      </dl>
    </PlatformPanel>
  )
}
