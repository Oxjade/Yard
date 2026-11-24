"use client"

import { motion } from "motion/react"
import { GitCommitIcon, HardDrivesIcon } from "@phosphor-icons/react"
import { EmptyState } from "@/components/dashboard/empty-state"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { Bone } from "@/components/feedback/skeletons"
import { Panel, PanelError } from "@/components/admin/ui/panel"
import { api } from "@/lib/api/client"
import { useApi } from "@/lib/api/use-api"
import { formatPercent } from "@/lib/money"
import { cn } from "@/lib/utils"
import type { OpsResponse } from "@/server/monitoring/service"
import { formatDateTime, int, relTime } from "../format"

/** Queue depth, storage, auth failures and deploys share one read, refreshed every minute. */
export function useOps() {
  return useApi("admin:metrics:ops", () => api<OpsResponse>("/api/admin/metrics/ops"), { refreshInterval: 60_000 })
}

export function bytes(n: number) {
  const u = ["B", "KB", "MB", "GB", "TB"]
  let i = 0
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(i >= 3 ? 2 : i ? 1 : 0)} ${u[i]}`
}

function age(iso: string | null, now: string) {
  if (!iso) return null
  const s = Math.max(0, (Date.parse(now) - Date.parse(iso)) / 1000)
  if (s < 90) return `${Math.round(s)} s`
  if (s < 5400) return `${Math.round(s / 60)} min`
  if (s < 172_800) return `${Math.round(s / 3600)} h`
  return `${Math.round(s / 86_400)} days`
}

function Rows({ n = 4 }: { n?: number }) {
  return (
    <ul aria-hidden className="grid gap-3 py-1">
      {Array.from({ length: n }, (_, i) => (
        <li key={i} className="grid gap-2">
          <Bone className="h-3.5 w-2/3" />
          <Bone className="h-1 w-full" />
        </li>
      ))}
    </ul>
  )
}

/* ── Queue depth ──────────────────────────────────────────────────────── */

export function QueueDepthPanel({ className }: { className?: string }) {
  const q = useOps()
  const s = q.data
  return (
    <Panel id="queues" title="Queue depth" description="Work waiting in each job table, against its alert level. Refreshes every minute." className={cn("scroll-mt-24 rounded-[20px]", className)}>
      {q.error && !s ? (
        <PanelError message="Couldn't read the queues." onRetry={() => void q.revalidate()} />
      ) : !s ? (
        <Rows n={6} />
      ) : (
        <ul className="admin-divide">
          {s.queues.map((x) => {
            const over = x.depth >= x.alertAt
            const oldest = age(x.oldestAt, s.now)
            return (
              <li key={x.key} className="py-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-[13px] text-ink">{x.name}</span>
                  <span className={cn("font-metric text-[1.125rem]", over ? "text-acid" : "text-ink")}>{int(x.depth)}</span>
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/[0.06]" role="meter" aria-valuemin={0} aria-valuemax={x.alertAt} aria-valuenow={Math.min(x.depth, x.alertAt)} aria-label={`${x.name}: ${int(x.depth)} waiting, alert at ${int(x.alertAt)}`}>
                  <motion.div className={cn("h-full origin-left rounded-full", over ? "bg-acid" : "bg-purple")} initial={{ scaleX: 0 }} animate={{ scaleX: x.depth ? Math.max(0.02, Math.min(1, x.depth / x.alertAt)) : 0 }} transition={{ type: "spring", stiffness: 110, damping: 20, delay: 0.15 }} />
                </div>
                <p className="mt-1 text-[11px] text-ink-3 tabular">
                  {x.depth ? `${x.hint}${oldest ? `, oldest ${oldest}` : ""}` : `${x.hint}: none`}. Alert at {int(x.alertAt)}
                  {x.failed ? <span className="text-ink-2">. {int(x.failed)} {x.key === "watches" ? "paused" : x.key === "indexnow" ? "retrying" : "failed in 24 h"}</span> : null}
                  {over ? <span className="text-acid">. Over the alert level</span> : null}
                </p>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

/* ── Storage ──────────────────────────────────────────────────────────── */

const purposeLabel: Record<string, string> = {
  social_post: "Social posts",
  inbox_attachment: "Message attachments",
  location_image: "Places",
  social_import: "Imported social media",
  sample: "Sample media",
  onboarding_image: "Product and brand photos",
  storefront_cover: "Storefront covers",
  drop_image: "Drops",
  account_photo: "Account photos",
  newsletter_image: "Newsletter images",
}
const tones = ["bg-purple", "bg-violet", "bg-ink-3", "bg-white/40", "bg-purple/45"]

export function StoragePanel({ className }: { className?: string }) {
  const q = useOps()
  const s = q.data?.storage
  const disk = s?.disk
  const used = disk ? disk.total - disk.free : 0
  const shown = s ? [...s.parts.slice(0, 4), ...(s.parts.length > 4 ? [{ purpose: "other", bytes: s.parts.slice(4).reduce((t, p) => t + p.bytes, 0), files: s.parts.slice(4).reduce((t, p) => t + p.files, 0) }] : [])] : []
  return (
    <Panel id="storage" title="Storage" description="Media stored, by what it holds, and free space on the data volume." className={cn("scroll-mt-24 rounded-[20px]", className)}>
      {q.error && !s ? (
        <PanelError message="Couldn't read storage." onRetry={() => void q.revalidate()} />
      ) : !s ? (
        <Rows n={4} />
      ) : (
        <>
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-metric text-[2rem] text-ink">{bytes(s.total)}</span>
            <span className="text-[12px] text-ink-3">of media{disk ? `, ${bytes(disk.free)} free on the data volume` : ""}</span>
          </p>
          {disk ? (
            <div className="mt-3">
              <div className="flex h-2 w-full overflow-hidden rounded-full bg-white/[0.06]" role="img" aria-label={`${formatPercent(used / disk.total, 0)} of the data volume used, media ${bytes(s.total)}`}>
                <span className="h-full bg-purple" style={{ width: `${Math.min(100, (s.total / disk.total) * 100)}%` }} />
                <span className="h-full bg-white/20" style={{ width: `${Math.max(0, Math.min(100, ((used - s.total) / disk.total) * 100))}%` }} />
              </div>
              <p className={cn("mt-1.5 text-[11px] tabular", disk.free / disk.total < 0.1 ? "text-acid" : "text-ink-3")}>
                Volume {bytes(used)} used of {bytes(disk.total)} ({formatPercent(used / disk.total, 0)}). Purple is media; grey is the database, builds and everything else.
              </p>
            </div>
          ) : null}
          {s.parts.length === 0 ? (
            <EmptyState icon={HardDrivesIcon} title="No media stored yet" body="Photos appear here as brands upload them." className="py-8" />
          ) : (
            <ul className="admin-divide mt-3">
              {shown.map((p, i) => (
                <li key={p.purpose} className="flex items-center justify-between gap-3 py-2 text-[12px]">
                  <span className="flex min-w-0 items-center gap-2 text-ink-2">
                    <span className={cn("size-2 shrink-0 rounded-full", tones[i % tones.length])} aria-hidden />
                    <span className="truncate">{p.purpose === "other" ? "Everything else" : (purposeLabel[p.purpose] ?? p.purpose)}</span>
                  </span>
                  <span className="shrink-0 text-ink tabular">
                    {bytes(p.bytes)} <span className="text-ink-3">· {int(p.files)} {p.files === 1 ? "file" : "files"}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[12px] text-ink-3">{s.added7d ? `Up ${bytes(s.added7d)} in 7 days.` : "Nothing added in the last 7 days."}</p>
        </>
      )}
    </Panel>
  )
}

/* ── Auth failures ────────────────────────────────────────────────────── */

export function AuthFailuresPanel({ className }: { className?: string }) {
  const q = useOps()
  const a = q.data?.auth
  const rows = a
    ? [
        { label: "Failed shopper sign-ins", value: a.signIn.shopper, hint: "Wrong email or password" },
        { label: "Failed brand sign-ins", value: a.signIn.brand, hint: "Studio, wrong email or password" },
        { label: "Failed admin sign-ins", value: a.signIn.admin, hint: "Control Center", attention: a.signIn.admin >= 5 },
        { label: "Failed MFA codes", value: a.mfa.admin, hint: "Control Center two-step codes", attention: a.mfa.admin >= 5 },
        { label: "Accounts locked", value: a.locked.shopper + a.locked.brand + a.locked.admin, hint: a.locked.admin ? `${int(a.locked.admin)} admin, after 10 failed attempts` : "After 10 failed attempts in 15 minutes", attention: a.locked.admin > 0 },
        { label: "Sign-in rate limits", value: a.rateLimited.signIn, hint: "Callers held back from signing in (one per caller a minute)" },
        { label: "All rate-limit blocks", value: a.rateLimited.all + a.rateLimited.proxy, hint: a.rateLimited.proxy ? `${int(a.rateLimited.proxy)} at the API's front door` : "Every API action and the API's front door" },
      ]
    : []
  const at = q.data?.appAttest
  const platforms = at ? [at.android ? "Android" : null, at.ios ? "iOS" : null].filter(Boolean).join(" and ") : ""
  return (
    <Panel id="auth-failures" title="Auth failures, last 24 hours" description="Sign-in and MFA failures across shoppers, brands and admins, rate-limit blocks and app attestation." className={cn("scroll-mt-24 rounded-[20px]", className)}>
      {q.error && !a ? (
        <PanelError message="Couldn't read the auth figures." onRetry={() => void q.revalidate()} />
      ) : !a ? (
        <Rows n={5} />
      ) : (
        <dl className="admin-divide">
          {rows.map((r) => (
            <div key={r.label} className="flex items-start justify-between gap-3 py-2.5">
              <dt className="min-w-0">
                <span className="block text-[13px] text-ink">{r.label}</span>
                <span className="block text-[11px] text-ink-3">{r.hint}</span>
              </dt>
              <dd className={cn("font-metric text-[1.125rem]", r.attention ? "text-acid" : "text-ink")}>{int(r.value)}</dd>
            </div>
          ))}
          {at ? (
            <div className="flex items-start justify-between gap-3 py-2.5">
              <dt className="min-w-0">
                <span className="block text-[13px] text-ink">App attestation: {at.mode}</span>
                <span className="block text-[11px] text-ink-3">
                  {at.mode === "off" ? "YARD_APP_ATTEST=off: app requests aren't checked" : platforms ? `${platforms} checked. Sign-up, reset, magic link and apply from the apps` : "No platform configured yet (docs/DEPLOY.md)"}
                  {at.blocked ? ` · ${int(at.blocked)} refused` : ""}
                  {at.unavailable ? ` · ${int(at.unavailable)} while Google was unreachable` : ""}
                </span>
              </dt>
              <dd className={cn("font-metric text-right text-[1.125rem] tabular", at.fail > 0 ? "text-acid" : "text-ink")}>
                {int(at.pass)} / {int(at.fail)} / {int(at.missing)}
                <span className="block text-[11px] font-normal text-ink-3">pass / fail / missing</span>
              </dd>
            </div>
          ) : null}
        </dl>
      )}
    </Panel>
  )
}

/* ── Deploys ──────────────────────────────────────────────────────────── */

function span(fromIso: string, toMs: number) {
  const s = Math.max(0, (toMs - Date.parse(fromIso)) / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`
}

export function DeploysPanel({ className }: { className?: string }) {
  const q = useOps()
  const s = q.data
  return (
    <Panel id="deploys" title="Deploys" description="Each build this server has run, recorded once at boot. Live time runs until the next build was first seen." className={cn("scroll-mt-24 rounded-[20px]", className)} bodyClassName="px-0 pb-0 md:px-0 md:pb-0">
      {q.error && !s ? (
        <div className="px-4 pb-4 md:px-5">
          <PanelError message="Couldn't read the deploy history." onRetry={() => void q.revalidate()} />
        </div>
      ) : !s ? (
        <div className="px-4 pb-4 md:px-5">
          <Rows n={3} />
        </div>
      ) : s.deploys.length === 0 ? (
        <EmptyState icon={GitCommitIcon} title="No builds recorded yet" body="The running build is recorded a few seconds after the server starts." className="mx-4 mb-4 md:mx-5 md:mb-5" />
      ) : (
        <ul className="admin-divide border-t border-[var(--admin-hairline)]">
          {s.deploys.map((x, i) => {
            const until = i === 0 ? Date.parse(s.now) : Date.parse(s.deploys[i - 1]!.firstSeenAt)
            return (
              <li key={x.id} className="flex min-w-0 items-center gap-3 px-4 py-3 md:px-5">
                <GitCommitIcon aria-hidden className={cn("size-4 shrink-0", x.live ? "text-violet" : "text-ink-3")} />
                <div className="min-w-0 flex-1">
                  <p className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-mono text-[12.5px] text-ink" title={x.gitSha ?? x.id}>
                      {x.version}
                    </span>
                    {x.live ? <StatusBadge tone="success">Live</StatusBadge> : null}
                  </p>
                  <p className="mt-0.5 truncate text-[12px] text-ink-3" title={formatDateTime(x.firstSeenAt)}>
                    First seen {relTime(x.firstSeenAt, Date.parse(s.now)).toLowerCase()} · {x.boots} {x.boots === 1 ? "boot" : "boots"}
                  </p>
                </div>
                <div className="shrink-0 text-right tabular-nums">
                  <p className="text-[13px] text-ink">{x.live ? span(s.process.bootedAt, Date.parse(s.now)) : span(x.firstSeenAt, until)}</p>
                  <p className="text-[11.5px] text-ink-3">{x.live ? "up since boot" : "live for"}</p>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

