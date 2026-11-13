"use client"

import { ActivityIcon, CpuIcon, TimerIcon, WarningIcon } from "@phosphor-icons/react"
import { EmptyState } from "@/components/dashboard/empty-state"
import { StatCard } from "@/components/dashboard/insight/stat-card"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { Bone } from "@/components/feedback/skeletons"
import { Panel } from "@/components/admin/ui/panel"
import { formatDateTime, formatTime } from "@/components/admin/platform/format"
import { api } from "@/lib/api/client"
import { useApi } from "@/lib/api/use-api"
import { cn } from "@/lib/utils"
import type { MonitoringSnapshot } from "@/server/monitoring/metrics"

const getMonitoring = () => api<MonitoringSnapshot>("/api/admin/monitoring")

const int = (n: number) => Math.round(n).toLocaleString("en-US")
const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${Math.round(n)} ms`)
const pct = (n: number) => `${(n * 100).toFixed(n > 0 && n < 0.01 ? 2 : 1)}%`
function bytes(n: number) {
  const u = ["B", "KB", "MB", "GB", "TB"]
  let i = 0
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(i >= 3 ? 1 : 0)} ${u[i]}`
}
function uptime(sec: number) {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`
}

/** Live API monitoring from the running server: polls every 15 seconds. */
export function LiveMonitoring({ className }: { className?: string }) {
  const q = useApi("admin:monitoring", () => getMonitoring(), { refreshInterval: 15_000 })
  const s = q.data
  const ready = !!s

  const dbTone = !s ? "muted" : s.db.db === "down" ? "danger" : s.db.db === "pending" || s.db.ms > 500 ? "attention" : "success"
  const dbLabel = !s ? "Checking" : s.db.db === "down" ? "Database down" : s.db.db === "pending" ? "Migrations pending" : s.db.ms > 500 ? `Database slow (${ms(s.db.ms)})` : "Database ok"

  return (
    <section id="live-monitoring" aria-label="Live server monitoring" className={cn("@container grid min-w-0 scroll-mt-24 gap-3", className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-1 text-[13px] text-ink-2">
        <StatusBadge tone={dbTone}>{dbLabel}</StatusBadge>
        {s ? <span>Up {uptime(s.uptimeSec)}</span> : null}
        {s && s.os ? <span className="tabular-nums">Load {s.os.loadavg.map((l) => l.toFixed(2)).join(" · ")}</span> : null}
        <span className="text-ink-3">Counting since the server last started{s ? ` (${formatDateTime(s.startedAt)})` : ""}. Refreshes every 15 s.</span>
        {q.error && s ? <span className="text-ink-3">Last refresh failed; showing the previous figures.</span> : null}
      </div>

      {q.error && !s ? (
        <Panel title="Live monitoring" className="rounded-[20px]">
          <EmptyState icon={WarningIcon} title="Couldn't load live monitoring" body="The monitoring endpoint didn't answer. It retries every 15 seconds." />
        </Panel>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 @3xl:grid-cols-4">
            <StatCard surface="admin" icon={ActivityIcon} label="Requests / min" value={s?.requestsNow ?? 0} format={int} hint={s ? `${int(s.totals.last60.requests)} in the last hour` : "Last full minute"} href="#live-requests" hrefLabel="Open the request chart" ready={ready} className="h-full" />
            <StatCard surface="admin" variant={s && s.errorRate15m >= 0.02 ? "brand" : "default"} icon={WarningIcon} label="Error rate, 15 min" value={s?.errorRate15m ?? 0} format={pct} hint={s ? `${int(s.totals.last15.c5xx)} server errors of ${int(s.totals.last15.requests)}` : "5xx responses"} href="#live-errors" hrefLabel="Open recent server errors" ready={ready} className="h-full" />
            <StatCard surface="admin" icon={TimerIcon} label="p95 latency, 15 min" value={s?.latency15m.p95 ?? 0} format={(n) => (s?.latency15m.p95 == null ? "–" : ms(n))} hint={s?.latency15m.p50 != null ? `p50 ${ms(s.latency15m.p50)}` : "No requests yet"} href="#live-slowest" hrefLabel="Open the slowest endpoints" ready={ready} className="h-full" />
            <StatCard surface="admin" icon={CpuIcon} label="Memory used" value={s?.process.rss ?? 0} format={bytes} hint={s ? `Heap ${bytes(s.process.heapUsed)} · host ${bytes(s.os.totalMem - s.os.freeMem)} of ${bytes(s.os.totalMem)}${s.disk ? ` · disk ${bytes(s.disk.used)} of ${bytes(s.disk.total)}` : ""}` : "Server process"} href="#live-monitoring" hrefLabel="Server process" ready={ready} className="h-full" />
          </div>

          <Panel id="live-requests" title="Requests per minute" description="API requests over the last 60 minutes; server errors in red." className="scroll-mt-24 rounded-[20px]">
            {s ? <RequestsChart series={s.requestsPerMin} /> : <Bone className="h-[160px] w-full" />}
          </Panel>

          <div className="grid min-w-0 gap-3 @5xl:grid-cols-2">
            <Panel id="live-slowest" title="Slowest endpoints" description="By p95 latency since the server started." className="min-w-0 scroll-mt-24 rounded-[20px]" bodyClassName="px-0 pb-0 md:px-0 md:pb-0">
              {!s ? (
                <Rows />
              ) : s.slowest.length === 0 ? (
                <EmptyState icon={TimerIcon} title="No requests yet" body="Endpoints appear here once the server has answered API requests." className="mx-4 mb-4 md:mx-5 md:mb-5" />
              ) : (
                <ul className="admin-divide border-t border-[var(--admin-hairline)]">
                  {s.slowest.map((r) => (
                    <li key={r.route} className="flex min-w-0 items-center gap-3 px-4 py-3 md:px-5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-[12.5px] text-ink" title={r.route}>
                          {r.route}
                        </p>
                        <p className="mt-0.5 text-[12px] text-ink-3 tabular-nums">
                          {int(r.count)} {r.count === 1 ? "request" : "requests"}
                          {r.errors ? ` · ${int(r.errors)} errors` : ""}
                        </p>
                      </div>
                      <div className="shrink-0 text-right tabular-nums">
                        <p className="text-[13px] text-ink">{ms(r.p95Ms)}</p>
                        <p className="text-[11.5px] text-ink-3">avg {ms(r.avgMs)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel id="live-errors" title="Recent server errors" description="The last 30 responses with a 5xx status." className="min-w-0 scroll-mt-24 rounded-[20px]" bodyClassName="px-0 pb-0 md:px-0 md:pb-0">
              {!s ? (
                <Rows />
              ) : s.recentErrors.length === 0 ? (
                <EmptyState icon={ActivityIcon} title={`No server errors since ${formatDateTime(s.startedAt)}`} className="mx-4 mb-4 md:mx-5 md:mb-5" />
              ) : (
                <ul className="admin-divide max-h-[420px] overflow-y-auto border-t border-[var(--admin-hairline)]">
                  {s.recentErrors.map((e, i) => (
                    <li key={`${e.requestId}-${i}`} className="flex min-w-0 items-center gap-3 px-4 py-3 md:px-5">
                      <StatusBadge tone="danger" className="shrink-0 tabular-nums">
                        {e.status}
                      </StatusBadge>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-[12.5px] text-ink" title={`${e.method} ${e.path}`}>
                          {e.method} {e.path}
                        </p>
                        <p className="mt-0.5 truncate text-[12px] text-ink-3">
                          {formatTime(e.at)}
                          {e.requestId ? ` · request ${e.requestId}` : ""}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </>
      )}
    </section>
  )
}

function Rows() {
  return (
    <ul aria-hidden className="grid gap-3 border-t border-[var(--admin-hairline)] px-4 py-4 md:px-5">
      {Array.from({ length: 4 }, (_, i) => (
        <li key={i} className="grid gap-2">
          <Bone className="h-3.5 w-2/3" />
          <Bone className="h-3 w-1/3" />
        </li>
      ))}
    </ul>
  )
}

/** A 60-bar chart: one bar per minute, the server-error share drawn over it in red. */
function RequestsChart({ series }: { series: MonitoringSnapshot["requestsPerMin"] }) {
  const max = Math.max(1, ...series.map((p) => p.requests))
  const H = 140
  const W = series.length * 10
  const total = series.reduce((a, p) => a + p.requests, 0)
  return (
    <figure className="grid gap-2">
      <div className="flex items-baseline justify-between text-[11.5px] text-ink-3 tabular-nums">
        <span>Peak {int(max)}/min</span>
        <span>{int(total)} in 60 min</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-[140px] w-full" role="img" aria-label={`Requests per minute over the last hour, peak ${int(max)}, total ${int(total)}`}>
        <line x1={0} x2={W} y1={H - 0.5} y2={H - 0.5} stroke="currentColor" className="text-ink-3/30" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {series.map((p, i) => {
          const h = p.requests ? Math.max(2, (p.requests / max) * (H - 4)) : 0
          const eh = p.errors ? Math.max(2, (p.errors / max) * (H - 4)) : 0
          return (
            <g key={p.at}>
              <title>{`${formatTime(p.at)}: ${int(p.requests)} requests${p.errors ? `, ${int(p.errors)} errors` : ""}${p.requests ? `, avg ${ms(p.avgMs)}` : ""}`}</title>
              <rect x={i * 10 + 1} y={H - h} width={8} height={h} rx={1.5} fill="#9452ff" opacity={0.85} />
              {eh ? <rect x={i * 10 + 1} y={H - eh} width={8} height={eh} rx={1.5} fill="#f0526b" /> : null}
            </g>
          )
        })}
      </svg>
      <figcaption className="flex justify-between text-[11.5px] text-ink-3 tabular-nums">
        <span>{formatTime(series[0]!.at)}</span>
        <span>{formatTime(series[series.length - 1]!.at)}</span>
      </figcaption>
    </figure>
  )
}
