"use client"

import Link from "next/link"
import { FlagIcon } from "@phosphor-icons/react"
import { StatusBadge, orderStatusMeta } from "@/components/dashboard/status-badge"
import { brandById } from "@/lib/data"
import type { AuditEntry, PlatformUser } from "@/lib/data/admin"
import { merchantOrders } from "@/lib/data/orders"
import { convert } from "@/lib/money"
import { useAdmin } from "@/lib/stores/admin"
import { cn } from "@/lib/utils"
import { amountIn, usd } from "../finance/format"
import { Initials } from "./bits"
import { useDecision } from "./decision"
import { reportsFor } from "./derive"
import { ActionBar, ActivityList, DetailSection, DetailSheet, EmptyLine, Facts, insetClass } from "./detail-sheet"
import { countryName, formatDate, plural, relDays } from "./format"
import { userStatusMeta } from "./meta"
import { useLast } from "./use-last"
import { userActions, userAllowed, userDecision } from "./user-actions"

/**
 * Whether an audit entry is about this account. Names aren't unique (the sample has several
 * pairs, and they share an email too), so an entry that carries a subjectId is matched on
 * it, and one logged under a bare name only when no other account has that name. Without
 * this, one account's history would show another account's decisions.
 */
function isAbout(e: AuditEntry, user: PlatformUser, sharesName: boolean) {
  if (e.subjectId) return e.subjectId === user.id
  return !sharesName && e.target === user.name
}

const unattributable = (e: AuditEntry, user: PlatformUser) => !e.subjectId && e.target === user.name

/**
 * A shopper's account: reports, recent orders and the decisions taken on it. Self-contained
 * (its own decision dialog), because the shell's command palette opens it over any page.
 */
export function UserDetail({ id, open, onOpenChange }: { id: string | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const shown = useLast(id)
  const user = useAdmin((s) => s.users.find((u) => u.id === shown))
  const audit = useAdmin((s) => s.audit)
  const users = useAdmin((s) => s.users)
  const { ask, dialog } = useDecision(() => document.querySelector<HTMLElement>('[data-slot="sheet-content"]'))

  if (!user) return null

  const reports = reportsFor(user)
  const orders = merchantOrders.filter((o) => o.customerId === user.id).sort((a, b) => b.placedAt.localeCompare(a.placedAt))
  const sharesName = users.some((u) => u.name === user.name && u.id !== user.id)
  const entries = audit.filter((e) => isAbout(e, user, sharesName))
  const unattributed = sharesName ? audit.filter((e) => unattributable(e, user)).length : 0
  const status = userStatusMeta[user.status]

  return (
    <>
      <DetailSheet
        open={open}
        onOpenChange={onOpenChange}
        title={user.name}
        description={user.email}
        lead={<Initials name={user.name} round size="lg" />}
        badges={
          <>
            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
            {user.reports ? <StatusBadge tone="danger">{plural(user.reports, "report")}</StatusBadge> : <StatusBadge tone="muted">No reports</StatusBadge>}
          </>
        }
        actions={
          <ActionBar
            note="Applies across the whole marketplace. A reason is required and recorded in the audit log."
            actions={userAllowed[user.status].map((key) => ({
              key,
              label: userActions[key].label,
              icon: userActions[key].icon,
              variant: userActions[key].button,
              onSelect: () => {
                const d = userDecision(key, [user], { announce: false })
                if (d) ask(d)
              },
            }))}
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
            <ul className={cn("divide-y divide-white/[0.07]", insetClass)}>
              {reports.map((r) => (
                <li key={r.id} className="flex gap-2.5 px-3 py-2.5">
                  <FlagIcon className="mt-0.5 size-3.5 shrink-0 text-danger" aria-hidden />
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
            <EmptyLine>No reports against this account.</EmptyLine>
          )}
        </DetailSection>

        <DetailSection title="Recent orders" aside={<span className="text-[11px] text-ink-3 tabular">{orders.length > 5 ? `Latest 5 of ${orders.length}` : orders.length}</span>}>
          {orders.length ? (
            <ul className={cn("divide-y divide-white/[0.07] overflow-hidden", insetClass)}>
              {orders.slice(0, 5).map((o) => {
                const meta = orderStatusMeta[o.status]
                return (
                  <li key={o.id}>
                    <Link
                      href={`/admin/orders?order=${o.id}`}
                      aria-label={`Open order #${o.reference} in Orders`}
                      className="group flex min-h-12 items-center justify-between gap-3 px-3 py-2.5 transition-colors outline-none hover:bg-white/[0.03] focus-visible:bg-white/[0.03] focus-visible:ring-2 focus-visible:ring-violet focus-visible:ring-inset"
                    >
                      <span className="min-w-0">
                        <span className="block text-[13px] text-ink tabular group-hover:text-violet">#{o.reference}</span>
                        <span className="block truncate text-[11px] text-ink-3">{brandById.get(o.brandId)?.name}, {relDays(o.placedAt).toLowerCase()}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2.5">
                        <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                        {/* The same figures Orders and Finance show: USD at the demo rate, then the order's own currency. */}
                        <span className="grid justify-items-end">
                          <span className="text-[13px] text-ink tabular">{usd(convert(o.total, o.currency, "USD"))}</span>
                          {o.currency !== "USD" ? <span className="text-[11px] text-ink-3 tabular">{amountIn(o.total, o.currency)}</span> : null}
                        </span>
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          ) : (
            <EmptyLine>No orders yet.</EmptyLine>
          )}
        </DetailSection>

        <DetailSection title="Account activity">
          <ActivityList entries={entries} extra={[{ at: user.joinedAt, label: "Account created" }]} />
          {unattributed ? (
            <p className="text-[11px] text-ink-3">
              {plural(unattributed, "decision")} logged under the name {user.name} {unattributed === 1 ? "isn't" : "aren't"} shown here: another account has the same name and the log doesn&apos;t say which account it was.{" "}
              <Link href="/admin/security" className="text-violet hover:underline">
                Open the audit log
              </Link>
            </p>
          ) : null}
        </DetailSection>
      </DetailSheet>
      {dialog}
    </>
  )
}
