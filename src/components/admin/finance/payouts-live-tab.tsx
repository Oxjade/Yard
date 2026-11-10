"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { DataTable, type Column } from "@/components/dashboard/data-table"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { Panel } from "@/components/admin/ui/panel"
import { currencies, type CurrencyCode } from "@/config/markets"
import { api, ApiError } from "@/lib/api/client"
import { errorMessage } from "@/lib/api/errors"
import { useApi } from "@/lib/api/use-api"
import { formatMoney } from "@/lib/money"
import { useServerSession } from "@/lib/session/use-server-session"

type Payout = {
  id: string
  brandId: string
  brandName?: string
  currency: string
  amountMinor: number
  status: string
  requestedAt: string
  approvedAt: string | null
  sentAt: string | null
  paidAt: string | null
  failedAt: string | null
  closedAt: string | null
  batchId: string | null
  providerRef: string | null
  stubRecipient: boolean
  lastError: string | null
  rejectReason: string | null
  approvals: { adminId: string; adminName: string; step: number; at: string; note: string | null }[]
}

type PayoutsResponse = { payouts: Payout[]; nextBefore: string | null }
type PayoutDetailResponse = { payout: Payout }
type Decision = { payout: Payout; kind: "approve" | "reject" }

const statuses = ["requested", "awaiting_second_approval", "approved", "sending", "processing", "paid", "failed", "rejected", "cancelled"]
const statusLabel: Record<string, string> = {
  requested: "Awaiting first approval",
  awaiting_second_approval: "Awaiting second approval",
  approved: "Approved",
  sending: "Sending",
  processing: "Processing",
  paid: "Paid",
  failed: "Failed",
  rejected: "Rejected",
  cancelled: "Cancelled",
}
const tone: Record<string, "muted" | "info" | "attention" | "success" | "danger"> = {
  requested: "attention",
  awaiting_second_approval: "attention",
  approved: "info",
  sending: "info",
  processing: "info",
  paid: "success",
  failed: "danger",
  rejected: "danger",
  cancelled: "muted",
}
const currencyOf = (value: string): CurrencyCode => (value in currencies ? (value as CurrencyCode) : "USD")
const amountOf = (payout: Payout) => formatMoney(payout.amountMinor, currencyOf(payout.currency))
const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })
const needsReauth = (error: unknown) => error instanceof ApiError && error.status === 403 && error.fields?.reauth === "required"

export function PayoutsLiveTab({ focus }: { focus?: string | null; ready: boolean }) {
  const adminId = useServerSession((session) => session.admin?.id)
  const [filter, setFilter] = useState("all")
  const [selectedId, setSelectedId] = useState<string | null>(focus ?? null)
  const [decision, setDecision] = useState<Decision | null>(null)
  const [reason, setReason] = useState("")
  const [authCode, setAuthCode] = useState("")
  const [reauthRequired, setReauthRequired] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const list = useApi<PayoutsResponse>("admin.finance.payouts", () => api<PayoutsResponse>("/api/admin/finance/payouts", { query: { limit: 200 } }), { keepPrevious: false })
  const detail = useApi<PayoutDetailResponse>(selectedId ? `admin.finance.payout:${selectedId}` : null, () => api<PayoutDetailResponse>(`/api/admin/finance/payouts/${selectedId}`), { keepPrevious: false })
  const allRows = list.data?.payouts ?? []
  const rows = allRows.filter((payout) => filter === "all" || payout.status === filter)

  function beginDecision(payout: Payout, kind: Decision["kind"]) {
    setDecision({ payout, kind })
    setReason("")
    setAuthCode("")
    setReauthRequired(false)
    setError(null)
  }

  async function submitDecision(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!decision || busy) return
    setBusy(true)
    setError(null)
    try {
      if (reauthRequired) {
        await api("/api/auth/reauth", { method: "POST", query: { as: "admin" }, body: { code: authCode } })
      }
      const { payout, kind } = decision
      await api(`/api/admin/finance/payouts/${payout.id}/${kind}`, {
        method: "POST",
        body: kind === "approve" ? { note: reason.trim() || undefined } : { reason: reason.trim() },
      })
      await Promise.all([list.revalidate(), detail.revalidate()])
      setDecision(null)
      setReauthRequired(false)
      toast.success(kind === "approve" ? "Approval recorded" : "Payout rejected", { description: `${amountOf(payout)} for ${payout.brandName ?? payout.brandId}.` })
    } catch (cause) {
      if (needsReauth(cause)) setReauthRequired(true)
      else setError(errorMessage(cause, "The payout decision couldn't be saved."))
    } finally {
      setBusy(false)
    }
  }

  const columns: Column<Payout>[] = [
    {
      key: "brand",
      header: "Brand",
      sortValue: (payout) => payout.brandName ?? payout.brandId,
      cell: (payout) => (
        <span className="block min-w-0">
          <span className="block max-w-[42vw] truncate font-medium text-ink sm:max-w-none">{payout.brandName ?? payout.brandId}</span>
          <span className="block text-[11px] text-ink-3 sm:hidden">{statusLabel[payout.status] ?? payout.status}</span>
        </span>
      ),
    },
    { key: "amount", header: "Amount", align: "right", sortValue: (payout) => payout.amountMinor, cell: (payout) => <span className="whitespace-nowrap font-medium text-ink">{amountOf(payout)}</span> },
    {
      key: "status",
      header: "Status",
      hideBelow: "sm",
      sortValue: (payout) => statuses.indexOf(payout.status),
      cell: (payout) => <StatusBadge tone={tone[payout.status] ?? "muted"}>{statusLabel[payout.status] ?? payout.status}</StatusBadge>,
    },
    {
      key: "requestedAt",
      header: "Requested",
      hideBelow: "md",
      sortValue: (payout) => payout.requestedAt,
      cell: (payout) => <time className="whitespace-nowrap text-ink-2" dateTime={payout.requestedAt}>{dateTime.format(new Date(payout.requestedAt))}</time>,
    },
    {
      key: "approvals",
      header: "Approvals",
      hideBelow: "lg",
      cell: (payout) => {
        const first = payout.approvals.find((approval) => approval.step === 1)
        const second = payout.approvals.find((approval) => approval.step === 2)
        return <span className="block min-w-32 text-[11.5px] leading-relaxed text-ink-2">{first ? `1. ${first.adminName}` : "First approval pending"}{second ? <span className="block">2. {second.adminName}</span> : null}</span>
      },
    },
    {
      key: "actions",
      header: "Actions",
      cell: (payout) => {
        const approvedByMe = payout.approvals.some((approval) => approval.adminId === adminId)
        const canApprove = payout.status === "requested" || payout.status === "awaiting_second_approval"
        const canReject = ["requested", "awaiting_second_approval", "approved"].includes(payout.status)
        return (
          <span className="flex flex-wrap gap-1.5">
            <Button type="button" size="xs" variant="ghost" onClick={() => { setSelectedId(payout.id); void detail.revalidate() }}>Details</Button>
            {canApprove ? <Button type="button" size="xs" variant="secondary" disabled={approvedByMe} title={approvedByMe ? "A different admin must give the second approval." : undefined} onClick={() => beginDecision(payout, "approve")}>Approve</Button> : null}
            {canReject ? <Button type="button" size="xs" variant="ghost" onClick={() => beginDecision(payout, "reject")}>Reject</Button> : null}
          </span>
        )
      },
    },
  ]

  return (
    <div className="grid gap-3">
      {decision ? (
        <Panel title={decision.kind === "approve" ? "Record payout approval" : "Reject payout"} description={`${amountOf(decision.payout)} for ${decision.payout.brandName ?? decision.payout.brandId}. ${decision.kind === "approve" ? "A second, different admin must approve before this payout can be batched." : "The held amount returns to the brand's available balance."}`} className="rounded-[20px]">
          <form className="grid gap-3" onSubmit={(event) => void submitDecision(event)}>
            <div className="grid gap-1.5">
              <Label htmlFor="payout-decision-reason">{decision.kind === "approve" ? "Note (optional)" : "Reason"}</Label>
              <Textarea id="payout-decision-reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} required={decision.kind === "reject"} rows={3} />
            </div>
            {reauthRequired ? (
              <div className="grid max-w-sm gap-1.5">
                <Label htmlFor="payout-auth-code">Authenticator code</Label>
                <Input id="payout-auth-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" value={authCode} onChange={(event) => setAuthCode(event.target.value)} required />
              </div>
            ) : null}
            {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={busy} disabled={busy || (reauthRequired && !authCode.trim()) || (decision.kind === "reject" && reason.trim().length < 3)}>{reauthRequired ? "Verify and retry" : decision.kind === "approve" ? "Record approval" : "Reject payout"}</Button>
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setDecision(null)}>Cancel</Button>
            </div>
          </form>
        </Panel>
      ) : null}

      {selectedId ? (
        <Panel title="Payout detail" description={detail.isLoading ? "Loading payout…" : undefined} className="rounded-[20px]">
          {detail.error ? <div className="grid justify-items-start gap-2"><p role="alert" className="text-sm text-danger">{errorMessage(detail.error, "Couldn't load this payout.")}</p><Button type="button" size="sm" variant="secondary" onClick={() => void detail.revalidate()}>Retry</Button></div> : null}
          {detail.data?.payout ? (
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <p><span className="text-ink-3">Brand:</span> {detail.data.payout.brandName ?? detail.data.payout.brandId}</p>
              <p><span className="text-ink-3">Amount:</span> {amountOf(detail.data.payout)}</p>
              <p><span className="text-ink-3">Status:</span> {statusLabel[detail.data.payout.status] ?? detail.data.payout.status}</p>
              <p><span className="text-ink-3">Requested:</span> {dateTime.format(new Date(detail.data.payout.requestedAt))} UTC</p>
              {detail.data.payout.rejectReason ? <p className="sm:col-span-2"><span className="text-ink-3">Rejection reason:</span> {detail.data.payout.rejectReason}</p> : null}
              {detail.data.payout.lastError ? <p className="sm:col-span-2"><span className="text-ink-3">Provider note:</span> {detail.data.payout.lastError}</p> : null}
              <div className="sm:col-span-2">
                <p className="mb-1 text-ink-3">Approval history</p>
                {detail.data.payout.approvals.length ? <ol className="grid gap-1">{detail.data.payout.approvals.map((approval) => <li key={`${approval.step}-${approval.adminId}`}>{approval.step === 1 ? "First" : "Second"} approval by {approval.adminName}, {dateTime.format(new Date(approval.at))}{approval.note ? `: ${approval.note}` : ""}</li>)}</ol> : <p>No approvals recorded yet.</p>}
              </div>
            </div>
          ) : null}
          <div className="mt-3"><Button type="button" size="sm" variant="ghost" onClick={() => setSelectedId(null)}>Close details</Button></div>
        </Panel>
      ) : null}

      <Panel title="Payouts" description={list.data ? `${rows.length} of ${allRows.length} payouts. Each payout requires approvals from two different admins.` : "Brand payout requests and their approval history."} className="rounded-[20px]" bodyClassName="px-3 sm:px-4 md:px-5">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Label htmlFor="payout-status-filter" className="sr-only">Payout status</Label>
          <select id="payout-status-filter" className="h-10 rounded-md border border-white/10 bg-obsidian px-3 text-sm text-ink" value={filter} onChange={(event) => setFilter(event.target.value)}>
            <option value="all">All statuses ({allRows.length})</option>
            {statuses.map((status) => <option key={status} value={status}>{statusLabel[status]} ({allRows.filter((payout) => payout.status === status).length})</option>)}
          </select>
          {list.error ? <Button type="button" size="sm" variant="secondary" onClick={() => void list.revalidate()}>Retry</Button> : null}
          {list.error ? <p role="alert" className="w-full text-sm text-danger">{errorMessage(list.error, "Couldn't load payouts.")}</p> : null}
        </div>
        <DataTable
          label="Payout requests"
          rows={rows}
          columns={columns}
          getId={(payout) => payout.id}
          loading={list.isLoading}
          empty={{ title: filter === "all" ? "No payout requests" : `No payouts ${statusLabel[filter]?.toLowerCase() ?? filter}`, body: "New requests from approved brands appear here." }}
          initialSort={{ key: "requestedAt", dir: "desc" }}
          pageSizes={[10, 25, 50]}
          initialPageSize={25}
          minWidth={360}
        />
      </Panel>
    </div>
  )
}