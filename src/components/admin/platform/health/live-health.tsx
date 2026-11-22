"use client"

import { ActivityIcon, QueueIcon, TimerIcon, WarningIcon } from "@phosphor-icons/react"
import { StatCard } from "@/components/dashboard/insight/stat-card"
import { Reveal, RevealItem } from "@/components/admin/ui/motion"
import { LiveMonitoring } from "@/components/admin/overview/live-monitoring"
import { AdminPageHead, StatRow } from "@/components/admin/marketplace/page-head"
import { SessionGate } from "@/components/session/session-gate"
import { api } from "@/lib/api/client"
import { useApi } from "@/lib/api/use-api"
import type { MetricsResponse } from "@/server/monitoring/service"
import { int } from "../format"
import { ActivityGraph, ActivityHeatmap } from "./activity"
import { AuthFailuresPanel, DeploysPanel, QueueDepthPanel, StoragePanel, useOps } from "./operations"

const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${int(n)} ms`)
const pct = (n: number) => `${(n * 100).toFixed(n > 0 && n < 0.01 ? 2 : 1)}%`

/**
 * Health with the demo switch off: every figure is real. Requests, errors and latency are read
 * from metrics_minutes (counted in memory, written once a minute, kept a year as hourly and daily
 * rollups); orders, revenue, sign-ups and the year heatmap from Yard's own tables; queue depth,
 * storage, auth failures and deploys from the job, media, abuse and deploys tables. The demo keeps
 * its sample panels (health-view.tsx).
 */
export function LiveHealth() {
  // The same keys as the Activity graph's defaults, so the figures and the graph share one read.
  const req = useApi("admin:metrics:24h:requests:", () => api<MetricsResponse>("/api/admin/metrics?range=24h&metric=requests"), { refreshInterval: 60_000 })
  const lat = useApi("admin:metrics:24h:latency:", () => api<MetricsResponse>("/api/admin/metrics?range=24h&metric=latency"), { refreshInterval: 60_000 })
  const ops = useOps()
  const total = req.data?.summary.total ?? 0
  const errors = req.data ? req.data.points.reduce((s, p) => s + (p.secondary ?? 0), 0) : 0
  const p95 = lat.data?.summary.p95 ?? null
  const over = ops.data ? ops.data.queues.filter((q) => q.depth >= q.alertAt) : []

  return (
    <SessionGate surface="admin" feature="Health" permission="audit.view">
      <Reveal ssrVisible className="@container grid gap-3">
        <AdminPageHead
          live
          title="Health"
          description="Requests, errors and latency, marketplace activity, queues, storage, sign-in failures and deploys."
          note="Every figure here is real. Request counts are written once a minute and kept for a year (minutes for 48 hours, then hours for 30 days, then days); times and days are UTC."
        />

        <StatRow label="Health figures">
          <RevealItem className="min-w-0">
            <StatCard surface="admin" icon={ActivityIcon} label="Requests, 24 h" value={total} format={int} hint={req.data ? `${int(errors)} server errors` : "API requests answered"} href="#activity" hrefLabel="Open the activity graph" ready={!!req.data} className="h-full" />
          </RevealItem>
          <RevealItem className="min-w-0">
            <StatCard surface="admin" variant={total && errors / total >= 0.02 ? "brand" : "default"} icon={WarningIcon} label="Error rate, 24 h" value={total ? errors / total : 0} format={pct} hint="5xx responses" href="#activity" hrefLabel="Open the activity graph" ready={!!req.data} className="h-full" />
          </RevealItem>
          <RevealItem className="min-w-0">
            <StatCard surface="admin" icon={TimerIcon} label="p95 latency, 24 h" value={p95 ?? 0} format={(n) => (p95 == null ? "–" : ms(n))} hint={lat.data?.summary.p50 != null ? `p50 ${ms(lat.data.summary.p50)}` : "No requests yet"} href="#activity" hrefLabel="Open the activity graph" ready={!!lat.data} className="h-full" />
          </RevealItem>
          <RevealItem className="min-w-0">
            <StatCard surface="admin" variant={over.length ? "brand" : "default"} icon={QueueIcon} label="Queues over alert" value={over.length} format={(n) => `${int(n)} of ${ops.data?.queues.length ?? 0}`} hint={over.length ? over.map((q) => q.name).join(", ") : "Every queue under its level"} href="#queues" hrefLabel="Open queue depth" ready={!!ops.data} className="h-full" />
          </RevealItem>
        </StatRow>

        <RevealItem className="min-w-0">
          <ActivityGraph />
        </RevealItem>
        <RevealItem className="min-w-0">
          <ActivityHeatmap />
        </RevealItem>

        <LiveMonitoring />

        <div className="grid gap-3 @3xl:grid-cols-2 @5xl:grid-cols-3">
          <QueueDepthPanel />
          <StoragePanel />
          <AuthFailuresPanel className="@3xl:col-span-2 @5xl:col-span-1" />
        </div>
        <DeploysPanel />
      </Reveal>
    </SessionGate>
  )
}
