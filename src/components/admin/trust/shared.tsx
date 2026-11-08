"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { ArrowClockwiseIcon, CaretDownIcon, ImageBrokenIcon } from "@phosphor-icons/react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { toast } from "sonner"
import { create } from "zustand"
import { Bone } from "@/components/feedback/skeletons"
import { Button } from "@/components/ui/button"
import { SessionGate } from "@/components/session/session-gate"
import { ActivityList, DetailSection, LinkRow } from "@/components/admin/marketplace/detail-sheet"
import { useLast } from "@/components/admin/marketplace/use-last"
import { useDecision, type Decision } from "@/components/admin/marketplace/decision"
import { entryLabel } from "@/components/admin/platform/security/audit-words"
import { decide, listAudit, adminKeys } from "@/lib/api/admin"
import { ApiError } from "@/lib/api/client"
import type { DecisionBody, DecisionKey, DecisionResult } from "@/lib/api/contracts/admin"
import type { AuditEntryDto } from "@/lib/api/contracts/common"
import { errorMessage } from "@/lib/api/errors"
import { revalidatePrefix, useApi } from "@/lib/api/use-api"
import type { AdminRole, AuditEntry } from "@/lib/data/admin"
import { canAdmin, needsRole, type AdminPermission } from "@/lib/permissions"
import { useRealtimeEvent } from "@/lib/realtime/use-realtime"
import { useServerSession } from "@/lib/session/use-server-session"
import { cn } from "@/lib/utils"

/*
 * Pieces every v2 admin queue shares (§8): the role gate, permission reasons, server decisions
 * through the shared ReasonDialog, and the ActivityList fed by the server audit log.
 */

/** The signed-in demo admin (server session) and what their role may do. */
export function useAdminSession() {
  const s = useServerSession()
  const admin = s.admin
  return {
    status: s.status,
    admin,
    can: (p: AdminPermission) => !!admin && canAdmin(admin.role, p),
    /** Why an action is disabled for this admin, or undefined when they may take it. */
    reason: (p: AdminPermission) => (!admin ? "Sign in with a demo admin account." : canAdmin(admin.role, p) ? undefined : needsRole(p)),
  }
}

/**
 * A page that opens for any of several view permissions (Content: posts, places or social). The
 * gate's permission is the first the admin holds, so it only refuses when they hold none.
 */
export function TrustGate({ feature, anyOf, children }: { feature: string; anyOf: AdminPermission[]; children: React.ReactNode }) {
  const role = useServerSession((s) => s.admin?.role)
  const permission = (role && anyOf.find((p) => canAdmin(role, p))) || anyOf[0]
  return (
    <SessionGate surface="admin" feature={feature} permission={permission}>
      {children}
    </SessionGate>
  )
}

/* ── Server audit entries ──────────────────────────────────────────── */

/** Entries this tab just wrote (decisions, audited views), shown at once while the list refetches. */
const useRecentAudit = create<{ entries: AuditEntryDto[] }>(() => ({ entries: [] }))
export const pushAudit = (e: AuditEntryDto) => useRecentAudit.setState((s) => ({ entries: [e, ...s.entries.filter((x) => x.id !== e.id)].slice(0, 200) }))

/** A server audit row in the shape the ActivityList reads (role names come from adminRoles). */
export function toAuditEntry(e: AuditEntryDto): AuditEntry {
  return { id: e.id, at: e.at, actor: e.actor, role: (e.role ?? e.actorKind) as AdminRole, action: entryLabel(e.action, e.target), target: e.target ?? "", reason: e.reason ?? undefined, ip: "server", approvedBy: e.approvedBy ?? undefined, subjectId: e.subjectId ?? undefined }
}

/** The server audit rows for a record (several subject ids: a report, its message, the conversation). */
export function ServerActivity({ subjectIds, extra, empty, legacy }: { subjectIds: string[]; extra?: { at: string; label: string; detail?: string }[]; empty?: string; legacy?: AuditEntry[] }) {
  const ids = [...new Set(subjectIds.filter(Boolean))].slice(0, 24).join(",")
  const { can } = useAdminSession()
  const allowed = can("audit.view")
  const q = useApi(allowed && ids ? adminKeys.audit(ids) : null, () => listAudit({ subjectId: ids, limit: 50 }))
  const recent = useRecentAudit((s) => s.entries)
  const entries = useMemo(() => {
    const want = new Set(ids.split(","))
    const seen = new Set<string>()
    const out: AuditEntry[] = []
    for (const e of [...recent.filter((r) => r.subjectId && want.has(r.subjectId)), ...(q.data?.items ?? [])]) {
      if (seen.has(e.id)) continue
      seen.add(e.id)
      out.push(toAuditEntry(e))
    }
    // Entries the legacy pages wrote in this browser, marked as such (§8.3).
    for (const l of legacy ?? []) out.push({ ...l, action: `${l.action} (this browser)` })
    return out
  }, [recent, q.data, ids, legacy])
  if (!allowed)
    return (
      <div className="grid gap-2">
        {entries.length || extra?.length ? <ActivityList entries={entries} extra={extra} empty={empty} /> : null}
        <p className="text-[11.5px] text-ink-3">The full history needs the audit log permission, which your role doesn&apos;t have; only what you did here is shown.</p>
      </div>
    )
  if (q.isLoading && !q.data)
    return (
      <div aria-busy role="status" className="grid gap-2">
        <span className="sr-only">Loading the history</span>
        <Bone className="h-12 w-full rounded-[10px]" />
        <Bone className="h-12 w-full rounded-[10px]" />
      </div>
    )
  if (q.error && !q.data)
    return (
      <div className="flex items-center justify-between gap-3 rounded-[10px] border border-dashed border-white/10 px-3 py-2.5 text-[12px] text-ink-3">
        <span>Couldn&apos;t load the history. {errorMessage(q.error)}</span>
        <Button size="sm" variant="secondary" className="h-10 sm:h-8" onClick={() => void q.revalidate()}>
          <ArrowClockwiseIcon aria-hidden /> Retry
        </Button>
      </div>
    )
  return <ActivityList entries={entries} extra={extra} empty={empty} />
}

/* ── Decisions ─────────────────────────────────────────────────────── */

export type ServerDecision<K extends DecisionKey> = Omit<Decision, "run"> & {
  action: K
  body: Omit<DecisionBody<K>, "reason">
  /** The toast title once it's recorded ("Message removed"). */
  done: string
  /** Fields filled from the typed text (a resolution that is also the reason). */
  withReason?: (reason: string) => Partial<DecisionBody<K>>
  onDone?: (r: DecisionResult) => void
}

/** Codes where trying the same decision again can't help: say why, refresh, close the dialog. */
const SETTLED = new Set(["conflict", "forbidden", "not_found", "rule", "not_configured", "unauthenticated"])

/**
 * useDecision for server decisions: the shared ReasonDialog, then POST /api/admin/decisions/…,
 * the calm toast, the audit entry into every open ActivityList and a refresh of the admin data.
 * A conflict ("Someone already decided this") refreshes and closes; a network failure keeps the
 * dialog and the reason for another try.
 */
export function useServerDecision(fallback?: () => HTMLElement | null | undefined) {
  const { ask, dialog } = useDecision(fallback)
  function askServer<K extends DecisionKey>(d: ServerDecision<K>) {
    const { action, body, done, onDone, withReason, ...rest } = d
    return ask({
      ...rest,
      run: async (reason) => {
        try {
          const r = await decide(action, { ...body, ...withReason?.(reason), reason } as DecisionBody<K>)
          pushAudit(r.audit)
          toast.success(done, { description: "Recorded in the audit log with your reason." })
          onDone?.(r)
        } catch (e) {
          if (e instanceof ApiError && SETTLED.has(e.code)) {
            if (e.code === "conflict") toast.info(e.message)
            else toast.error(e.message)
            return
          }
          if (e instanceof ApiError && (e.code === "validation" || e.code === "rate_limited")) toast.error(errorMessage(e))
          throw e
        } finally {
          revalidatePrefix("admin:")
        }
      },
    })
  }
  return { ask: askServer, dialog }
}

/* ── Liveness ──────────────────────────────────────────────────────── */

/** Admin notification categories that mean a queue gained an item (a report, a flag, a complaint, an alert). */
const QUEUE_CATEGORIES = new Set(["message_report", "content_report", "place_report", "chart_integrity", "shipping_issue", "delivery_complaint", "abuse_alert"])

/**
 * Keeps a queue live: it refetches when a decision moves the counts (moderation.counts) and when the
 * admin's own bell gets a new queue item (notification.created), so a report filed while the page is
 * open shows up at once rather than at the next poll. The queue counts (sidebar and Overview) refetch too.
 */
export function useQueueLive(refresh: () => void) {
  useRealtimeEvent("moderation.counts", () => refresh())
  useRealtimeEvent("notification.created", (n) => {
    if (!QUEUE_CATEGORIES.has(n.category)) return
    refresh()
    revalidatePrefix(adminKeys.counts)
  })
}

/* ── Queue figures ─────────────────────────────────────────────────── */

/**
 * Stat-card state for a queue whose counts arrive with each tab's response: the last counts are
 * kept while another tab loads (only the table shows loading), and a first load that failed
 * shows the cards as unavailable ("—", "Couldn't load") instead of a skeleton that never ends.
 */
export function useQueueFigures<T>(counts: T | null | undefined, error: unknown) {
  const last = useLast(counts)
  const failed = !last && !!error
  return {
    counts: last,
    ready: !!last || failed,
    failed,
    format: (f: (n: number) => string) => (failed ? () => "—" : f),
    hint: (h: string) => (failed ? "Couldn't load" : h),
  }
}

/* ── Sheet pieces ──────────────────────────────────────────────────── */

/**
 * Grid tracks in a sheet section that never grow past the sheet: a long one-line hint or value
 * truncates instead of widening the column (a 390 px phone sheet otherwise loses its right edge).
 */
export const sheetTrack = "grid-cols-[minmax(0,1fr)]"

/** A DetailSection of links to related records, kept inside the sheet's width at any size. */
export function RelatedLinks({ links, title = "Related" }: { links: ({ href: string; label: string; hint: string } | null | false | undefined)[]; title?: string }) {
  const shown = links.filter((l): l is { href: string; label: string; hint: string } => !!l)
  if (!shown.length) return null
  return (
    <DetailSection title={title} className={sheetTrack}>
      <div className={cn("grid gap-2", sheetTrack)}>
        {shown.map((l) => (
          <LinkRow key={l.href} href={l.href} label={l.label} hint={l.hint} />
        ))}
      </div>
    </DetailSection>
  )
}

/** A case or record the sheet couldn't find: says so plainly and links back to the queue. */
export function NotInQueue({ what, href, queue }: { what: string; href: string; queue: string }) {
  return (
    <div className="grid gap-3">
      <p className="text-[13px] text-ink-2">This {what} isn&apos;t in the queue any more. It may have been decided, or the link is out of date.</p>
      <Link href={href} className="inline-flex min-h-10 items-center justify-self-start rounded-md text-[13px] text-violet underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-violet">
        Back to {queue}
      </Link>
    </div>
  )
}

/* ── Small pieces ──────────────────────────────────────────────────── */

/**
 * Uploaded media is served by /api/media with the admin cookie, so it's a plain <img> (the image
 * optimiser drops cookies, §5.4). Seeded sample media keeps its public /media path.
 */
export function AdminImg({ src, alt, className }: { src?: string | null; alt: string; className?: string }) {
  const [broken, setBroken] = useState(false)
  if (!src || broken)
    return (
      <span className={cn("inline-flex items-center justify-center bg-white/[0.03]", className)}>
        <ImageBrokenIcon className="size-3.5 text-ink-3" aria-hidden />
        <span className="sr-only">{alt || "No image"}</span>
      </span>
    )
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} loading="lazy" decoding="async" onError={() => setBroken(true)} className={cn("object-cover", className)} />
}

export type TrustAction = {
  key: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  variant: "primary" | "secondary" | "destructive"
  onSelect?: () => void
  /** A choice before the dialog (a restriction's length): the button opens these. */
  menu?: { label: string; onSelect: () => void }[]
  disabledReason?: string
}

const weight = { destructive: 0, secondary: 1, primary: 2 } as const

/**
 * The DetailSheet's decision row (the marketplace ActionBar's order: destructive, secondary, the
 * one constructive action last), plus actions this role can't take: shown disabled, with the
 * reason written out under them, since a disabled button can't show a tooltip to everyone.
 */
export function TrustActionBar({ actions, note }: { actions: TrustAction[]; note?: React.ReactNode }) {
  const ordered = [...actions].sort((a, b) => weight[a.variant] - weight[b.variant])
  const reasons = new Map<string, string[]>()
  for (const a of ordered) if (a.disabledReason) reasons.set(a.disabledReason, [...(reasons.get(a.disabledReason) ?? []), a.label])
  return (
    <div className="grid gap-2.5">
      {note ? <p className="text-[11.5px] leading-snug text-ink-3">{note}</p> : null}
      {actions.length ? (
        <div className="flex flex-wrap items-center justify-end gap-2 [&>*]:flex-1 sm:[&>*]:flex-none">
          {ordered.map((a) =>
            a.menu && !a.disabledReason ? (
              <DropdownMenu key={a.key}>
                <DropdownMenuTrigger asChild>
                  <Button type="button" size="sm" className="h-10 sm:h-9" variant={a.variant}>
                    <a.icon /> {a.label} <CaretDownIcon aria-hidden className="size-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {a.menu.map((m) => (
                    <DropdownMenuItem key={m.label} onSelect={m.onSelect} className="min-h-10 sm:min-h-8">
                      {m.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button key={a.key} type="button" size="sm" className="h-10 sm:h-9" variant={a.variant} disabled={!!a.disabledReason} onClick={a.onSelect}>
                <a.icon /> {a.label}
              </Button>
            ),
          )}
        </div>
      ) : null}
      {[...reasons].map(([reason, labels]) => (
        <p key={reason} className="text-right text-[11.5px] text-ink-3">
          {labels.join(", ")}: {reason.replace(/\.$/, "")}.
        </p>
      ))}
    </div>
  )
}

/** A short "Sample" marker for seeded rows (the page head carries the fuller note). */
export function SampleTag() {
  return <span className="inline-flex h-5 items-center rounded-full border border-white/10 px-1.5 text-[10.5px] text-ink-3">Sample</span>
}

/** A load error inside a panel, with Retry. */
export function LoadError({ error, onRetry, what }: { error: unknown; onRetry: () => void; what: string }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-line px-6 py-12 text-center">
      <p className="text-sm text-ink">Couldn&apos;t load {what}</p>
      <p className="max-w-sm text-[13px] text-ink-2">{errorMessage(error)}</p>
      <Button size="sm" variant="secondary" className="h-10 sm:h-9" onClick={onRetry}>
        <ArrowClockwiseIcon aria-hidden /> Retry
      </Button>
    </div>
  )
}
