"use client"

import { ArrowCounterClockwiseIcon, BellSlashIcon, EyeIcon, ProhibitIcon, ShieldWarningIcon } from "@phosphor-icons/react"
import { DataTable, type Column, type RowAction } from "@/components/dashboard/data-table"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { SessionGate } from "@/components/session/session-gate"
import { Initials } from "@/components/admin/marketplace/bits"
import { DetailSection, DetailSheet, EmptyLine, Facts, LinkRow, insetClass } from "@/components/admin/marketplace/detail-sheet"
import { formatDate, relDays } from "@/components/admin/marketplace/format"
import { useSearchParam, writeParams } from "@/components/admin/marketplace/url-state"
import { useLast } from "@/components/admin/marketplace/use-last"
import { userStatusMeta } from "@/components/admin/marketplace/meta"
import { useNow } from "@/hooks/use-now"
import { adminKeys, listAbuse } from "@/lib/api/admin"
import { abuseAlertKindLabels, durationLabels, restrictionKindLabels, type AbuseAlertDto, type AbuseRowDto, type RestrictionDto } from "@/lib/api/contracts/admin"
import { useApi } from "@/lib/api/use-api"
import { mirrorUserStatus } from "@/components/admin/marketplace/user-actions"
import { useRealtimeEvent } from "@/lib/realtime/use-realtime"
import { cn } from "@/lib/utils"
import { DURATIONS, restrictDecision } from "./restrict"
import { LoadError, ServerActivity, TrustActionBar, useAdminSession, useServerDecision, type TrustAction } from "./shared"

/*
 * Users › Abuse (§5.2, §8.1): accounts with abuse signals in the last 7 days. Nothing here
 * restricts on its own: an alert waits for an admin to confirm it (a restriction) or dismiss it.
 */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export function AbusePanel() {
  return (
    <SessionGate surface="admin" feature="abuse signals" permission="abuse.view">
      <AbuseTable />
    </SessionGate>
  )
}

type Ask = ReturnType<typeof useServerDecision>["ask"]

function decisions(ask: Ask) {
  return {
    dismiss: (row: AbuseRowDto, a: AbuseAlertDto) =>
      ask({
        action: "dismiss-abuse-alert",
        body: { id: a.id },
        title: `Dismiss the ${abuseAlertKindLabels[a.kind]?.toLowerCase() ?? a.kind} alert on ${row.user.name}?`,
        description: `${row.user.name}'s new messages to other brands stop being held for review. Messages already held stay in Admin › Messages › Held. Nobody is notified; your reason stays in the audit log.`,
        fieldLabel: "Reason, for the audit log",
        confirmLabel: "Dismiss alert",
        done: "Alert dismissed",
      }),
    lift: (row: AbuseRowDto, r: RestrictionDto) =>
      ask({
        action: "lift-restriction",
        body: { id: r.id },
        title: `Lift the ${restrictionKindLabels[r.kind].toLowerCase()} restriction on ${row.user.name}?`,
        description: `${row.user.name} can use it again straight away. Your reason stays in the audit log.`,
        fieldLabel: "Reason, for the audit log",
        confirmLabel: "Lift restriction",
        done: "Restriction lifted",
      }),
    status: (row: AbuseRowDto, status: "suspended" | "active") =>
      ask({
        action: "set-user-status",
        body: { id: row.user.id, status },
        title: status === "suspended" ? `Suspend ${row.user.name}?` : `Reinstate ${row.user.name}?`,
        description:
          status === "suspended"
            ? `Every session ${row.user.name} has is ended at once and the account can't sign in until it's reinstated. Your reason stays in the audit log.`
            : `${row.user.name} can sign in and use Yard again. Your reason stays in the audit log.`,
        fieldLabel: "Reason, for the audit log",
        confirmLabel: status === "suspended" ? "Suspend account" : "Reinstate account",
        destructive: status === "suspended",
        done: status === "suspended" ? `${row.user.name} suspended` : `${row.user.name} reinstated`,
        onDone: () => mirrorUserStatus(row.user.id, status),
      }),
    restrict: (row: AbuseRowDto, kind: "messaging" | "uploads" | "reports", d: (typeof DURATIONS)[number], alertId?: string) => ask(restrictDecision({ kind: "user", id: row.user.id, name: row.user.name }, d, { kind, alertId })),
  }
}

function AbuseTable() {
  const now = useNow(60_000)
  const q = useApi(adminKeys.abuse, () => listAbuse(), { refreshInterval: 60_000 })
  useRealtimeEvent("moderation.counts", () => void q.revalidate())
  const { reason } = useAdminSession()
  const { ask, dialog } = useServerDecision()
  const d = decisions(ask)
  const caseId = useSearchParam("case")
  const restrictR = reason("users.restrict")
  const viewR = reason("abuse.view")
  const open = (row: AbuseRowDto) => writeParams({ case: row.user.id })
  const columns: Column<AbuseRowDto>[] = [
    {
      key: "actor",
      header: "Account",
      sortValue: (r) => r.user.name.toLowerCase(),
      cell: (r) => (
        <button type="button" onClick={() => open(r)} className="group flex max-w-full min-w-0 items-center gap-2.5 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-violet">
          <Initials name={r.user.name} round />
          <span className="min-w-0">
            <span className="block max-w-[44vw] truncate font-medium text-ink group-hover:text-violet sm:max-w-[220px]">{r.user.name}</span>
            <span className="block max-w-[44vw] truncate text-[11.5px] text-ink-3 sm:max-w-[220px]">
              <span className="sm:hidden">{r.alerts.length ? `${plural(r.alerts.length, "open alert")}` : `${r.rateLimitHits} hits, ${r.heldMessages} held`}</span>
              <span className="hidden sm:inline">{r.user.email}</span>
            </span>
          </span>
        </button>
      ),
    },
    { key: "hits", header: "Rate-limit hits", align: "right", hideBelow: "sm", sortValue: (r) => r.rateLimitHits, cell: (r) => <span className={cn("tabular", r.rateLimitHits ? "text-ink" : "text-ink-3")}>{r.rateLimitHits}</span> },
    { key: "held", header: "Held", align: "right", hideBelow: "md", sortValue: (r) => r.heldMessages, cell: (r) => <span className={cn("tabular", r.heldMessages ? "text-ink" : "text-ink-3")}>{r.heldMessages}</span> },
    { key: "marks", header: "Spam marks", align: "right", hideBelow: "md", sortValue: (r) => r.spamMarks, cell: (r) => <span className={cn("tabular", r.spamMarks ? "text-ink" : "text-ink-3")}>{r.spamMarks}</span> },
    { key: "reports", header: "Reports filed", align: "right", hideBelow: "lg", sortValue: (r) => r.reportsFiled, cell: (r) => <span className="text-ink-2 tabular">{r.reportsFiled}{r.reportsDismissed ? <span className="text-ink-3">, {r.reportsDismissed} dismissed</span> : null}</span> },
    {
      key: "state",
      header: "Alerts and restrictions",
      hideBelow: "sm",
      cell: (r) => (
        <span className="flex flex-wrap gap-1">
          {r.alerts.map((a) => (
            <StatusBadge key={a.id} tone="danger">{abuseAlertKindLabels[a.kind] ?? a.kind}</StatusBadge>
          ))}
          {r.restrictions.map((x) => (
            <StatusBadge key={x.id} tone="attention">{restrictionKindLabels[x.kind]} paused</StatusBadge>
          ))}
          {r.user.status !== "active" ? <StatusBadge tone={userStatusMeta[r.user.status].tone}>{userStatusMeta[r.user.status].label}</StatusBadge> : null}
          {!r.alerts.length && !r.restrictions.length && r.user.status === "active" ? <span className="text-ink-3">None</span> : null}
        </span>
      ),
    },
  ]
  const rowActions: RowAction<AbuseRowDto>[] = [
    { label: "Open signals", icon: EyeIcon, onSelect: open },
    { label: "Dismiss alert", icon: BellSlashIcon, separatorBefore: true, hidden: (r) => !r.alerts.length, disabled: () => !!viewR, disabledReason: () => viewR, onSelect: (r) => void d.dismiss(r, r.alerts[0]) },
    ...DURATIONS.map((dur) => ({ label: `Pause messaging for ${durationLabels[dur]}`, icon: ShieldWarningIcon, hidden: (r: AbuseRowDto) => r.restrictions.some((x) => x.kind === "messaging" && x.status === "active"), disabled: () => !!restrictR, disabledReason: () => restrictR, onSelect: (r: AbuseRowDto) => void d.restrict(r, "messaging", dur, r.alerts.find((a) => a.kind === "spam_marks")?.id) })),
    { label: "Suspend account", icon: ProhibitIcon, destructive: true, hidden: (r) => r.user.status === "suspended", disabled: () => !!restrictR, disabledReason: () => restrictR, onSelect: (r) => void d.status(r, "suspended") },
    { label: "Reinstate account", icon: ArrowCounterClockwiseIcon, hidden: (r) => r.user.status !== "suspended", disabled: () => !!restrictR, disabledReason: () => restrictR, onSelect: (r) => void d.status(r, "active") },
  ]
  const shown = q.data?.items.find((r) => r.user.id === caseId)
  return (
    <div className="grid gap-3">
      <p className="text-[12px] text-ink-2">
        Signals from the last {q.data?.windowDays ?? 7} days. Spam marks count brands that marked a conversation as spam; an alert needs marks from people who share no brand. Nothing restricts automatically.
      </p>
      {q.error && !q.data ? (
        <LoadError error={q.error} onRetry={() => void q.revalidate()} what="abuse signals" />
      ) : (
        <DataTable
          label="Abuse signals"
          rows={q.data?.items ?? []}
          columns={columns}
          getId={(r) => r.user.id}
          loading={!q.data}
          search={{ placeholder: "Search by name or email", text: (r) => `${r.user.name} ${r.user.email}` }}
          rowActions={rowActions}
          empty={{ title: "No abuse signals", body: "Accounts that hit rate limits, have held messages, spam marks or alerts in the last 7 days show here." }}
          initialPageSize={25}
          minWidth={300}
        />
      )}
      <AbuseSheet row={shown} open={!!shown} d={d} now={now} onOpenChange={(o) => !o && writeParams({ case: null })} />
      {dialog}
    </div>
  )
}

function AbuseSheet({ row, open, d, now, onOpenChange }: { row?: AbuseRowDto; open: boolean; d: ReturnType<typeof decisions>; now: number | null; onOpenChange: (o: boolean) => void }) {
  const { reason } = useAdminSession()
  const last = useLast(row)
  const r = row ?? last
  if (!r) return null
  const restrictR = reason("users.restrict")
  const viewR = reason("abuse.view")
  const alertId = r.alerts.find((a) => a.kind === "spam_marks")?.id
  const kinds = (["messaging", "uploads", "reports"] as const).filter((k) => !r.restrictions.some((x) => x.kind === k && x.status === "active"))
  const actions: TrustAction[] = []
  if (r.user.status === "suspended") actions.push({ key: "reinstate", label: "Reinstate", icon: ArrowCounterClockwiseIcon, variant: "primary", onSelect: () => void d.status(r, "active"), disabledReason: restrictR })
  else actions.push({ key: "suspend", label: "Suspend", icon: ProhibitIcon, variant: "destructive", onSelect: () => void d.status(r, "suspended"), disabledReason: restrictR })
  if (kinds.length)
    actions.push({
      key: "restrict",
      label: alertId ? "Confirm with a restriction" : "Restrict",
      icon: ShieldWarningIcon,
      variant: "secondary",
      disabledReason: restrictR,
      menu: kinds.flatMap((k) => DURATIONS.map((dur) => ({ label: `Pause ${k === "reports" ? "reporting" : k} for ${durationLabels[dur]}`, onSelect: () => void d.restrict(r, k, dur, k === "messaging" ? alertId : undefined) }))),
    })
  const st = userStatusMeta[r.user.status]
  return (
    <DetailSheet
      open={open}
      onOpenChange={onOpenChange}
      title={r.user.name}
      description={r.user.email}
      lead={<Initials name={r.user.name} round size="lg" />}
      badges={
        <>
          <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
          {r.alerts.length ? <StatusBadge tone="danger">{plural(r.alerts.length, "open alert")}</StatusBadge> : null}
          {r.user.demo ? <StatusBadge tone="muted">Demo account</StatusBadge> : null}
        </>
      }
      actions={<TrustActionBar note="Restrictions are shared with the account, reason included. Every decision is recorded in the audit log." actions={actions} />}
    >
      <Facts
        items={[
          { label: "Rate-limit hits, 7 days", value: <span className="tabular">{r.rateLimitHits}</span> },
          { label: "Held messages", value: <span className="tabular">{r.heldMessages}</span> },
          { label: "Brands that marked spam", value: <span className="tabular">{r.spamMarks}</span> },
          { label: "Reports filed", value: <span className="tabular">{r.reportsFiled}{r.reportsDismissed ? `, ${r.reportsDismissed} dismissed` : ""}</span> },
        ]}
      />
      <DetailSection title="Open alerts">
        {r.alerts.length ? (
          <ul className={cn("divide-y divide-white/[0.07]", insetClass)}>
            {r.alerts.map((a) => (
              <li key={a.id} className="grid gap-2 px-3 py-2.5">
                <p className="text-[13px] text-ink">{a.summary}</p>
                <p className="text-[11px] text-ink-3">Raised {relDays(a.createdAt, now).toLowerCase()}. While it&apos;s open, this account&apos;s new messages to other brands are held for review.</p>
                <div className="flex flex-wrap gap-1.5">
                  <SmallButton label="Dismiss alert" disabled={viewR} onClick={() => void d.dismiss(r, a)} />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyLine>No open alerts on this account.</EmptyLine>
        )}
      </DetailSection>
      <DetailSection title="Restrictions">
        {r.restrictions.length ? (
          <ul className={cn("divide-y divide-white/[0.07]", insetClass)}>
            {r.restrictions.map((x) => (
              <li key={x.id} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2.5">
                <span className="min-w-0">
                  <span className="block text-[13px] text-ink">{restrictionKindLabels[x.kind]} paused{x.until ? ` until ${formatDate(x.until)}` : ""}</span>
                  <span className="block text-[11px] text-ink-3">By {x.requestedBy.name}: {x.reason}</span>
                </span>
                <SmallButton label="Lift" disabled={restrictR} onClick={() => void d.lift(r, x)} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyLine>No restrictions on this account.</EmptyLine>
        )}
      </DetailSection>
      <DetailSection title="Related">
        <div className="grid gap-2">
          <LinkRow href={`/admin/messages?tab=held`} label="Held messages" hint="Review what the spam rules held" />
          <LinkRow href={`/admin/users?user=${encodeURIComponent(r.user.id)}`} label="Account record" hint="Orders and the sample account history" />
        </div>
      </DetailSection>
      <DetailSection title="Activity">
        <ServerActivity subjectIds={[r.user.id]} />
      </DetailSection>
    </DetailSheet>
  )
}

function SmallButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: string }) {
  return (
    <button type="button" onClick={onClick} disabled={!!disabled} title={disabled} className="inline-flex h-10 items-center rounded-md border border-line px-2.5 text-[12px] text-ink-2 transition-colors hover:bg-elevated hover:text-ink focus-visible:outline-2 focus-visible:outline-violet disabled:opacity-40 sm:h-8">
      {label}
    </button>
  )
}
