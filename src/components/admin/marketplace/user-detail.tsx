"use client"

import { useState } from "react"
import Link from "next/link"
import { ProhibitIcon as Ban, FlagIcon as Flag, ArrowCounterClockwiseIcon as RotateCcw, ShieldWarningIcon as ShieldAlert } from "@phosphor-icons/react"
import { toast } from "sonner"
import { StatusBadge, orderStatusMeta } from "@/components/dashboard/status-badge"
import { brandById } from "@/lib/data"
import type { AuditEntry, PlatformUser } from "@/lib/data/admin"
import { merchantOrders } from "@/lib/data/orders"
import { formatMoney } from "@/lib/money"
import { useAdmin } from "@/lib/stores/admin"
import { Initials } from "./data-table"
import { reportsFor } from "./derive"
import { ActionBar, ActivityList, DetailSection, DetailSheet, Facts } from "./detail-sheet"
import { countryName, formatDate, plural, relDays } from "./format"
import { userStatusMeta } from "./meta"
import { ReasonDialog, type ReasonAction } from "./reason-dialog"

type UserActionKey = "restrict" | "suspend" | "reinstate"
type Status = PlatformUser["status"]

const actionDefs: Record<UserActionKey, { label: string; to: Status; icon: React.ComponentType<{ className?: string }>; button: "primary" | "secondary" | "destructive"; dialog: (u: PlatformUser) => ReasonAction; toast: (u: PlatformUser) => [string, string] }> = {
  restrict: {
    label: "Restrict",
    to: "restricted",
    icon: ShieldAlert,
    button: "secondary",
    dialog: (u) => ({
      title: `Restrict ${u.name}?`,
      body: "They can still sign in and browse, but can't check out, enter drops or message brands. Orders already placed still ship.",
      confirmLabel: "Restrict account",
      tone: "destructive",
      presets: ["Suspected bot entries during drops", "Chargeback after confirmed delivery", "Abusive messages to brands"],
    }),
    toast: (u) => [`${u.name} restricted`, "Checkout, drops and messages are off for this account."],
  },
  suspend: {
    label: "Suspend",
    to: "suspended",
    icon: Ban,
    button: "destructive",
    dialog: (u) => ({
      title: `Suspend ${u.name}?`,
      body: "The account is signed out everywhere and can't sign in. Open orders still ship and refunds still go back to the original payment method.",
      confirmLabel: "Suspend account",
      tone: "destructive",
      presets: ["Several accounts sharing one card", "Confirmed payment fraud", "Repeated abuse after a warning"],
    }),
    toast: (u) => [`${u.name} suspended`, "Signed out everywhere and blocked from signing in."],
  },
  reinstate: {
    label: "Reinstate",
    to: "active",
    icon: RotateCcw,
    button: "primary",
    dialog: (u) => ({
      title: `Reinstate ${u.name}?`,
      body: "Full access comes back straight away and the shopper is told by email.",
      confirmLabel: "Reinstate account",
      tone: "primary",
      presets: ["Appeal accepted", "Reports reviewed, no breach found", "Restricted in error"],
    }),
    toast: (u) => [`${u.name} reinstated`, "Full access restored."],
  },
}

const allowed: Record<Status, UserActionKey[]> = {
  active: ["restrict", "suspend"],
  restricted: ["reinstate", "suspend"],
  suspended: ["reinstate"],
}

/**
 * Whether an audit entry is about this account. Names aren't unique (the sample has several
 * pairs, and they share an email too), so an entry that carries a subjectId is matched on
 * it, and one logged under a bare name only when no other account has that name. Without
 * this, one account's history would show another account's decisions.
 */
function isAbout(e: AuditEntry, user: PlatformUser, sharesName: boolean) {
  if ("subjectId" in e && e.subjectId) return e.subjectId === user.id
  return !sharesName && e.target === user.name
}

const unattributable = (e: AuditEntry, user: PlatformUser) => !("subjectId" in e && e.subjectId) && e.target === user.name

export function UserDetail({ id, open, onOpenChange }: { id: string | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const user = useAdmin((s) => s.users.find((u) => u.id === id))
  const audit = useAdmin((s) => s.audit)
  const users = useAdmin((s) => s.users)
  const setStatus = useAdmin((s) => s.setUserStatus)
  const [pending, setPending] = useState<UserActionKey | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  if (!user) return null

  const reports = reportsFor(user)
  const orders = merchantOrders.filter((o) => o.customerId === user.id).sort((a, b) => b.placedAt.localeCompare(a.placedAt))
  const sharesName = users.some((u) => u.name === user.name && u.id !== user.id)
  const entries = audit.filter((e) => isAbout(e, user, sharesName))
  const unattributed = sharesName ? audit.filter((e) => unattributable(e, user)).length : 0
  const status = userStatusMeta[user.status]

  function run(key: UserActionKey) {
    setPending(key)
    setDialogOpen(true)
  }

  async function confirm(reason: string) {
    if (!pending || !user) return
    const def = actionDefs[pending]
    setStatus(user.id, def.to, reason)
    const [title, description] = def.toast(user)
    toast(title, { description })
  }

  return (
    <DetailSheet
      open={open}
      onOpenChange={onOpenChange}
      title={user.name}
      description={user.email}
      lead={<Initials name={user.name} round size="lg" />}
      badges={
        <>
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          {user.reports ? <StatusBadge tone="danger">{user.reports} {user.reports === 1 ? "report" : "reports"}</StatusBadge> : <StatusBadge tone="muted">No reports</StatusBadge>}
        </>
      }
      actions={
        <ActionBar
          note="Applies across the whole marketplace. A reason is required."
          actions={allowed[user.status].map((key) => ({ key, label: actionDefs[key].label, icon: actionDefs[key].icon, variant: actionDefs[key].button, onSelect: () => run(key) }))}
        />
      }
    >
      <Facts
        items={[
          { label: "Country", value: countryName(user.country) },
          { label: "Joined", value: <time dateTime={user.joinedAt}>{formatDate(user.joinedAt)}</time> },
          { label: "Orders", value: <span className="tabular">{user.orders}</span> },
          { label: "Last active", value: relDays(user.lastActive) },
        ]}
      />

      <DetailSection title="Reports" aside={<span className="text-[11px] text-ink-3 tabular">{reports.length}</span>}>
        {reports.length ? (
          <ul className="divide-y divide-line-soft rounded-lg border border-line-soft bg-card">
            {reports.map((r) => (
              <li key={r.id} className="flex gap-2.5 px-3 py-2.5">
                <Flag className="mt-0.5 size-3.5 shrink-0 text-danger" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="text-[13px] text-ink">{r.reason}</span>
                    <time dateTime={r.at} className="shrink-0 text-[11px] text-ink-3">{relDays(r.at)}</time>
                  </span>
                  <span className="mt-0.5 block text-[11px] text-ink-3">Reported by {r.reportedBy}</span>
                  <span className="mt-1 block text-[12px] text-ink-2">{r.context}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed border-line px-3 py-3 text-[12px] text-ink-3">No reports against this account.</p>
        )}
      </DetailSection>

      <DetailSection title="Recent orders" aside={<span className="text-[11px] text-ink-3 tabular">{orders.length > 5 ? `Latest 5 of ${orders.length}` : orders.length}</span>}>
        {orders.length ? (
          <ul className="divide-y divide-line-soft rounded-lg border border-line-soft bg-card">
            {orders.slice(0, 5).map((o) => {
              const meta = orderStatusMeta[o.status]
              return (
                <li key={o.id}>
                  <Link
                    href={`/admin/orders?order=${o.id}`}
                    onClick={() => onOpenChange(false)}
                    aria-label={`Open order #${o.reference} in Orders`}
                    className="group flex items-center justify-between gap-3 px-3 py-2.5 transition-colors outline-none hover:bg-elevated focus-visible:bg-elevated focus-visible:ring-2 focus-visible:ring-violet focus-visible:ring-inset"
                  >
                    <span className="min-w-0">
                      <span className="block text-[13px] text-ink tabular group-hover:text-violet">#{o.reference}</span>
                      <span className="block truncate text-[11px] text-ink-3">{brandById.get(o.brandId)?.name}, {relDays(o.placedAt).toLowerCase()}</span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-[13px] text-ink tabular">{formatMoney(o.total, o.currency)}</span>
                      <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed border-line px-3 py-3 text-[12px] text-ink-3">No orders yet.</p>
        )}
      </DetailSection>

      <DetailSection title="Account activity">
        <ActivityList entries={entries} extra={[{ at: user.joinedAt, label: "Account created" }]} />
        {unattributed ? (
          <p className="text-[11px] text-ink-3">
            {plural(unattributed, "decision")} logged under the name {user.name} {unattributed === 1 ? "isn't" : "aren't"} shown here: another account has the same name and the log doesn&apos;t say which account it was.{" "}
            <Link href="/admin/security" onClick={() => onOpenChange(false)} className="text-violet hover:underline">
              Open the audit log
            </Link>
          </p>
        ) : null}
      </DetailSection>

      <ReasonDialog action={pending ? actionDefs[pending].dialog(user) : null} open={dialogOpen} onOpenChange={setDialogOpen} onConfirm={confirm} />
    </DetailSheet>
  )
}
