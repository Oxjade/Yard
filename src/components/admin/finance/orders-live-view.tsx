"use client"

import { useRef, useState } from "react"
import { toast } from "sonner"
import { AdminPageHead } from "@/components/admin/marketplace/page-head"
import { Panel, PanelError } from "@/components/admin/ui/panel"
import { DataTable, type Column } from "@/components/dashboard/data-table"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { currencies, type CurrencyCode } from "@/config/markets"
import { api, ApiError } from "@/lib/api/client"
import { canAdmin } from "@/lib/permissions"
import { errorMessage } from "@/lib/api/errors"
import { useApi } from "@/lib/api/use-api"
import { formatMoney } from "@/lib/money"
import { useServerSession } from "@/lib/session/use-server-session"
import { useSearchParam, writeParams } from "./table"
import { parseAmount } from "./finance-live-operations"
import { actionError, ActionErrorNote, ReauthCodeField, useReauth, type ActionError } from "./reauth"

type Summary = { id: string; reference: string; groupReference: string; checkoutId: string | null; brand: { id: string; name: string; handle: string }; customerName: string; shipToPreview: { city: string | null; country: string }; placedAt: string; currency: string; subtotalMinor: number; shippingMinor: number; totalMinor: number; refundedMinor: number; itemCount: number; previewItems: { productId: string; variantId: string; name: string; qty: number; unitMinor: number }[]; states: { merchant: string; payment: string; fulfilment: string; return: string; dispute: string }; service: string }
type OrdersPage = { items: Summary[]; nextCursor: string | null }
type Detail = Summary & { lines: { id: string; variantId: string; productId: string; title: string; qty: number; unitMinor: number; returnedQty: number; restockedQty: number; variantLabel: string; image: { src: string; alt: string; width: number; height: number } }[]; shipTo: Record<string, unknown> | null; paidAt: string | null; cancelledAt: string | null; cancelReason: string | null; deliveredAt: string | null; completedAt: string | null; refundableMinor: number; returns: { id: string; status: string; reason: string; reasonLabel: string; note: string; lines: { orderLineId: string; variantId: string; title: string; qty: number }[]; requestedAt: string; decisionReason: string | null; refundId: string | null }[]; refunds: { id: string; kind: string; status: string; amountMinor: number; currency: string; reason: string; createdAt: string; settledAt: string | null; returnId: string | null }[]; disputes: { id: string; status: string; category: string | null; amountMinor: number; currency: string; evidenceDueAt: string | null; brandEvidence: string | null; openedAt: string; resolvedAt: string | null }[]; timeline: { id: string; kind: string; actorKind: string; at: string; data: Record<string, unknown> }[]; actions: { canCancel: boolean; canRequestReturn: boolean; returnWindowEndsAt: string | null }; delivery: unknown }
type Dispute = { id: string; status: string; category: string | null; amountMinor: number; currency: string; evidenceDueAt: string | null; brandEvidence: string | null; brandEvidenceAt: string | null; responseSubmittedAt: string | null; openedAt: string; resolvedAt: string | null; adminNote?: string | null; provider?: string; providerDisputeId?: string; orderRefIds?: string[]; brandIds?: string[]; evidenceByBrand?: { brandId: string; evidence: string; at: string }[] }
type DisputesPage = { items: Dispute[]; nextCursor: string | null }
type OrderException = { id: string; kind: "refund" | "return"; createdAt: string; status: string; reason: string; note: string | null; failureReason: string | null; amountMinor: number | null; currency: string; orderId: string; orderReference: string; brandId: string; brandName: string }
type ExceptionsPage = { items: OrderException[]; nextCursor: string | null }
type EventSummary = { id: string; provider: string; eventType: string; subjectRef: string | null; status: string; receivedAt: string; processedAt: string | null; attempts: number; lastError: string | null }
type EventDetail = EventSummary & { payload: unknown }
type Tab = "orders" | "disputes" | "exceptions" | "events"
const tabs: { value: Tab; label: string }[] = [{ value: "orders", label: "Orders" }, { value: "disputes", label: "Disputes" }, { value: "exceptions", label: "Refunds & returns" }, { value: "events", label: "Paystack events" }]
const time = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })
const ccy = (value: string): CurrencyCode => value in currencies ? value as CurrencyCode : "USD"
const money = (minor: number, currency: string) => formatMoney(minor, ccy(currency))
const tone: Record<string, "muted" | "info" | "attention" | "success" | "danger"> = { paid: "success", partially_refunded: "attention", refunded: "muted", pending: "attention", failed: "danger", unfulfilled: "attention", processing: "info", shipped: "info", delivered: "success", cancelled: "muted", open: "danger", under_review: "attention", closed: "muted", processed: "success", failed_event: "danger", pending_event: "attention" }
/** Minor units as the text a major-unit input takes ("115000" kobo → "1150.00"), by string, not float maths. */
const toMajorInput = (minor: number, currency: string) => {
  const places = currencies[ccy(currency)].minor
  if (!places) return String(minor)
  const digits = String(minor).padStart(places + 1, "0")
  return `${digits.slice(0, -places)}.${digits.slice(-places)}`
}
/** What this admin's role may do here, as the routes check it (rule 6). */
function useOrderRights() {
  const role = useServerSession((session) => session.admin?.role ?? null)
  return {
    /** Refunds, return decisions and dispute notes: shipping.resolve (Owner, Support). */
    resolve: !!role && canAdmin(role, "shipping.resolve"),
    /** The Paystack event log: audit.view. */
    audit: !!role && canAdmin(role, "audit.view"),
    /** Replays: Owner, Engineering, Finance. */
    replay: role === "owner" || role === "engineering" || role === "finance",
  }
}
const showStatus = (value: string) => value.replaceAll("_", " ")

export function OrdersLiveView() {
  const rights = useOrderRights()
  const shown = tabs.filter((item) => item.value !== "events" || rights.audit)
  const linked = useSearchParam("view")
  const tab: Tab = shown.some((item) => item.value === linked) ? linked as Tab : "orders"
  return <div className="@container grid gap-3">
    <AdminPageHead live title="Orders" description="Live orders, refunds, returns, disputes, and payment-provider event history." note={rights.resolve ? "Refunds are capped by the server to the amount paid. Refund and replay actions are audited; replay is restricted to owner, engineering, and finance roles." : "Your role can view orders and disputes. Refunds, return decisions and dispute notes need the Support or Owner role."} />
    <div className="rail flex gap-1 overflow-x-auto border-b border-white/10">{shown.map((item) => <button key={item.value} type="button" aria-current={tab === item.value ? "page" : undefined} onClick={() => writeParams({ view: item.value === "orders" ? null : item.value, order: null })} className={`min-h-10 shrink-0 border-b-2 px-3 text-sm ${tab === item.value ? "border-violet text-ink" : "border-transparent text-ink-3 hover:text-ink"}`}>{item.label}</button>)}</div>
    {tab === "orders" ? <OrdersTab /> : null}
    {tab === "disputes" ? <DisputesTab /> : null}
    {tab === "exceptions" ? <ExceptionsTab /> : null}
    {tab === "events" ? <EventsTab /> : null}
  </div>
}

function OrdersTab() {
  const orders = useApi<OrdersPage>("admin.orders:first", () => api("/api/orders/admin", { query: { limit: 50 } }), { keepPrevious: false })
  const [older, setOlder] = useState<Summary[]>([])
  const [cursor, setCursor] = useState<string | null | undefined>(undefined)
  const [moreBusy, setMoreBusy] = useState(false)
  const orderId = useSearchParam("order")
  const detail = useApi<{ order: Detail }>(orderId ? `admin.orders.detail:${orderId}` : null, () => api(`/api/orders/admin/${orderId}`), { keepPrevious: false })
  const rows = older.length ? older : orders.data?.items ?? []
  const columns: Column<Summary>[] = [
    { key: "reference", header: "Order", sortValue: (row) => row.reference, cell: (row) => <button type="button" className="text-left font-medium text-ink hover:text-violet" onClick={() => writeParams({ order: row.id })}>#{row.reference}<span className="block max-w-[42vw] truncate text-[11px] text-ink-3 sm:max-w-none">{row.brand.name}</span></button> },
    { key: "checkout", header: "Checkout", hideBelow: "md", sortValue: (row) => row.groupReference, cell: (row) => row.groupReference },
    { key: "customer", header: "Customer", hideBelow: "md", sortValue: (row) => row.customerName, cell: (row) => row.customerName },
    { key: "placed", header: "Placed", hideBelow: "sm", sortValue: (row) => row.placedAt, cell: (row) => time.format(new Date(row.placedAt)) },
    { key: "total", header: "Total", align: "right", sortValue: (row) => row.totalMinor, cell: (row) => <span className="whitespace-nowrap">{money(row.totalMinor, row.currency)}</span> },
    { key: "payment", header: "Payment", hideBelow: "md", cell: (row) => <StatusBadge tone={tone[row.states.payment] ?? "muted"}>{showStatus(row.states.payment)}</StatusBadge> },
    { key: "fulfilment", header: "Fulfilment", hideBelow: "lg", cell: (row) => <StatusBadge tone={tone[row.states.fulfilment] ?? "muted"}>{showStatus(row.states.fulfilment)}</StatusBadge> },
  ]
  async function loadMore() {
    const before = cursor === undefined ? orders.data?.nextCursor : cursor
    if (!before || moreBusy) return
    setMoreBusy(true)
    try { const page = await api<OrdersPage>("/api/orders/admin", { query: { limit: 50, before } }); setOlder((current) => [...(current.length ? current : orders.data?.items ?? []), ...page.items]); setCursor(page.nextCursor) }
    catch (error) { toast.error(errorMessage(error, "Couldn't load older orders.")) }
    finally { setMoreBusy(false) }
  }
  return <div className="grid gap-3">
    <Panel title="All orders" description="Server order summaries, newest first. Open an order to inspect its refunds, returns, payment, and timeline." className="rounded-[20px]" bodyClassName="px-3 sm:px-4 md:px-5">{orders.error ? <PanelError message={errorMessage(orders.error, "Couldn't load orders.")} onRetry={() => void orders.revalidate()} /> : null}<DataTable label="Admin orders" rows={rows} columns={columns} getId={(row) => row.id} loading={orders.isLoading} search={{ placeholder: "Order, checkout, brand or customer", text: (row) => `${row.reference} ${row.groupReference} ${row.brand.name} ${row.customerName}` }} empty={{ title: "No orders", body: "Orders will appear here as checkouts are created." }} initialSort={{ key: "placed", dir: "desc" }} initialPageSize={25} pageSizes={[10, 25, 50]} minWidth={360} />{(cursor === undefined ? orders.data?.nextCursor : cursor) ? <div className="mt-3"><Button type="button" variant="secondary" loading={moreBusy} disabled={moreBusy} onClick={() => void loadMore()}>Load older orders</Button></div> : null}</Panel>
    {orderId ? <OrderDetailPanel key={orderId} id={orderId} data={detail.data?.order} error={detail.error} loading={detail.isLoading} retry={() => void detail.revalidate()} onClose={() => writeParams({ order: null })} onChanged={async () => { await Promise.all([detail.revalidate(), orders.revalidate()]) }} /> : null}
  </div>
}

function OrderDetailPanel({ id, data, error, loading, retry, onClose, onChanged }: { id: string; data?: Detail; error?: unknown; loading: boolean; retry: () => void; onClose: () => void; onChanged: () => Promise<void> }) {
  const rights = useOrderRights()
  const [refunding, setRefunding] = useState(false)
  const [amount, setAmount] = useState("")
  const [reason, setReason] = useState("")
  const reauth = useReauth()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<ActionError | null>(null)
  // One key per refund the admin means: reused on a retry of the same amount and reason, fresh when either changes.
  const idem = useRef<{ fingerprint: string; value: string } | null>(null)
  // The return being decided inline (rule 8: no prompt or modal for the reason).
  const [deciding, setDeciding] = useState<{ returnId: string; decision: "approve" | "reject" } | null>(null)
  const [decisionReason, setDecisionReason] = useState("")
  const [decisionError, setDecisionError] = useState<ActionError | null>(null)
  const parsed = data ? parseAmount(amount, data.currency) : null
  async function reload() {
    setMessage(null); setDecisionError(null); setDeciding(null)
    await onChanged()
  }
  async function refund(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!data || busy) return
    const amountMinor = parseAmount(amount, data.currency)
    if (amountMinor === null || amountMinor > data.refundableMinor) { setMessage({ message: `Enter an amount up to ${money(data.refundableMinor, data.currency)}, with no more than ${currencies[ccy(data.currency)].minor} decimal places.`, conflict: false }); return }
    const fingerprint = JSON.stringify({ amountMinor, reason: reason.trim() })
    if (idem.current?.fingerprint !== fingerprint) idem.current = { fingerprint, value: `admin_refund_${crypto.randomUUID()}` }
    setBusy(true); setMessage(null)
    try {
      if (!(await reauth.verify())) return
      const result = await api<{ order: Detail; status: string }>(`/api/orders/admin/${id}/refunds`, { method: "POST", body: { amountMinor, reason: reason.trim(), idempotencyKey: idem.current.value } })
      toast.success(`Refund of ${money(amountMinor, data.currency)} recorded`, { description: `Status: ${result.status}.` })
      idem.current = null
      setRefunding(false); setAmount(""); setReason("")
      await onChanged()
    } catch (cause) {
      if (!reauth.catches(cause)) setMessage(actionError(cause, "Refund failed."))
    } finally { setBusy(false) }
  }
  async function decideReturn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!deciding || busy) return
    if (decisionReason.trim().length < 3) { setDecisionError({ message: "Record why Yard decided this, in at least 3 characters.", conflict: false }); return }
    setBusy(true); setDecisionError(null)
    try {
      await api(`/api/orders/admin/${id}/returns/${deciding.returnId}/decision`, { method: "POST", body: { decision: deciding.decision, reason: decisionReason.trim() } })
      toast.success(deciding.decision === "approve" ? "Return approved" : "Return declined")
      setDeciding(null); setDecisionReason("")
      await onChanged()
    } catch (cause) { setDecisionError(actionError(cause, "The return decision couldn't be saved.")) } finally { setBusy(false) }
  }
  function startDecision(returnId: string, decision: "approve" | "reject") {
    setDeciding({ returnId, decision }); setDecisionReason(""); setDecisionError(null)
  }
  return <Panel title={data ? `Order #${data.reference}` : "Order detail"} description={data ? `${data.brand.name} · ${data.customerName} · ${time.format(new Date(data.placedAt))}` : undefined} action={<Button type="button" size="sm" variant="ghost" onClick={onClose}>Close</Button>} className="rounded-[20px]">
    {loading ? <div className="skeleton h-32 rounded-md" /> : null}{error ? <PanelError message={errorMessage(error, "Couldn't load this order.")} onRetry={retry} /> : null}
    {data ? <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4"><p className="text-ink-3">Total<span className="mt-1 block text-ink">{money(data.totalMinor, data.currency)}</span></p><p className="text-ink-3">Paid<span className="mt-1 block text-ink">{data.paidAt ? time.format(new Date(data.paidAt)) : "Not paid"}</span></p><p className="text-ink-3">Refundable<span className="mt-1 block text-ink">{money(data.refundableMinor, data.currency)}</span></p><p className="text-ink-3">Fulfilment<span className="mt-1 block capitalize text-ink">{showStatus(data.states.fulfilment)}</span></p></div>
      <div><h3 className="text-sm font-medium text-ink">Items</h3><ul className="mt-2 grid grid-cols-[minmax(0,1fr)] gap-2">{data.lines.map((line) => <li key={line.id} className="flex min-w-0 justify-between gap-3 text-sm"><span className="min-w-0 truncate text-ink-2">{line.title} · {line.variantLabel} × {line.qty}</span><span className="shrink-0 text-ink">{money(line.unitMinor * line.qty, data.currency)}</span></li>)}</ul></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="min-w-0"><h3 className="text-sm font-medium text-ink">Refunds</h3>{data.refunds.length ? data.refunds.map((refundItem) => <p key={refundItem.id} className="mt-1 text-xs text-ink-2">{money(refundItem.amountMinor, refundItem.currency)} · {refundItem.status} · {refundItem.reason}</p>) : <p className="mt-1 text-xs text-ink-3">No refunds.</p>}</div>
        <div className="min-w-0"><h3 className="text-sm font-medium text-ink">Returns</h3>{data.returns.length ? <ul className="mt-1 grid gap-3">{data.returns.map((returnItem) => <li key={returnItem.id} className="grid min-w-0 gap-1 text-xs text-ink-2">
          <span className="flex flex-wrap items-center gap-2"><span className="text-ink">{returnItem.reasonLabel}</span><StatusBadge tone={returnItem.status === "requested" ? "attention" : "muted"}>{showStatus(returnItem.status)}</StatusBadge></span>
          {returnItem.lines.length ? <span>{returnItem.lines.map((line) => `${line.title} × ${line.qty}`).join(", ")}</span> : null}
          <span className="break-words text-ink-3">{returnItem.note ? `Shopper's note: ${returnItem.note}` : "No note from the shopper."}</span>
          {returnItem.decisionReason ? <span className="text-ink-3">Decision: {returnItem.decisionReason}</span> : null}
          {returnItem.status === "requested" && rights.resolve && deciding?.returnId !== returnItem.id ? <span className="flex flex-wrap gap-2"><Button size="xs" type="button" variant="secondary" disabled={busy} onClick={() => startDecision(returnItem.id, "approve")}>Approve</Button><Button size="xs" type="button" variant="ghost" disabled={busy} onClick={() => startDecision(returnItem.id, "reject")}>Decline</Button></span> : null}
          {deciding?.returnId === returnItem.id ? <form className="mt-1 grid gap-2" onSubmit={(event) => void decideReturn(event)}>
            <Label htmlFor={`return-reason-${returnItem.id}`}>{deciding.decision === "approve" ? "Why Yard is approving this return" : "Why Yard is declining this return"}</Label>
            <Textarea id={`return-reason-${returnItem.id}`} value={decisionReason} onChange={(event) => { setDecisionReason(event.target.value); setDecisionError(null) }} maxLength={300} rows={2} aria-invalid={!!decisionError} required />
            <ActionErrorNote error={decisionError} onReload={() => void reload()} />
            <span className="flex flex-wrap gap-2"><Button type="submit" size="sm" loading={busy} disabled={busy}>{deciding.decision === "approve" ? "Approve return" : "Decline return"}</Button><Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setDeciding(null)}>Cancel</Button></span>
          </form> : null}
        </li>)}</ul> : <p className="mt-1 text-xs text-ink-3">No returns.</p>}</div>
      </div>
      {rights.resolve ? (data.refundableMinor > 0 ? <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="secondary" onClick={() => { setRefunding(!refunding); setMessage(null) }}>Issue refund</Button></div> : null) : <p className="text-xs text-ink-3">Refunds and return decisions need the Support or Owner role.</p>}
      {refunding && rights.resolve ? <form className="grid gap-3 border-t border-white/10 pt-3 sm:grid-cols-2" onSubmit={(event) => void refund(event)}>
        <p className="text-xs text-ink-3 sm:col-span-2">Enter the amount in {data.currency}. Up to {money(data.refundableMinor, data.currency)} can be refunded.</p>
        <div className="grid min-w-0 gap-1.5"><Label htmlFor="admin-refund-amount">Amount ({data.currency})</Label><Input id="admin-refund-amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} aria-describedby="admin-refund-amount-note" required /><p id="admin-refund-amount-note" className="text-xs text-ink-3">{parsed !== null ? (parsed > data.refundableMinor ? <span className="text-danger">{money(parsed, data.currency)} is more than the {money(data.refundableMinor, data.currency)} refundable.</span> : `Refunds ${money(parsed, data.currency)}.`) : <button type="button" className="text-ink-2 underline underline-offset-2 hover:text-ink" onClick={() => setAmount(toMajorInput(data.refundableMinor, data.currency))}>Refund full amount ({money(data.refundableMinor, data.currency)})</button>}</p></div>
        <div className="grid min-w-0 gap-1.5"><Label htmlFor="admin-refund-reason">Reason</Label><Input id="admin-refund-reason" value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={200} required /></div>
        <ReauthCodeField reauth={reauth} id="admin-refund-code" className="sm:col-span-2 sm:max-w-xs" />
        <ActionErrorNote error={message} onReload={() => void reload()} className="sm:col-span-2" />
        <div className="flex flex-wrap gap-2 sm:col-span-2"><Button type="submit" loading={busy} disabled={busy || reauth.waiting}>{reauth.required ? "Verify and refund" : parsed !== null && parsed <= data.refundableMinor ? `Refund ${money(parsed, data.currency)}` : "Confirm refund"}</Button><Button type="button" variant="ghost" disabled={busy} onClick={() => setRefunding(false)}>Cancel</Button></div>
      </form> : null}
      <details><summary className="cursor-pointer text-sm text-ink-2">Order timeline</summary><ol className="mt-2 grid gap-2">{data.timeline.map((event) => <li key={event.id} className="text-xs text-ink-2">{showStatus(event.kind)} · {time.format(new Date(event.at))}</li>)}</ol></details>
    </div> : null}
  </Panel>
}

function DisputesTab() {
  const rights = useOrderRights()
  const disputes = useApi<DisputesPage>("admin.orders.disputes:first", () => api("/api/orders/admin/disputes", { query: { limit: 50 } }), { keepPrevious: false })
  const [older, setOlder] = useState<Dispute[]>([])
  const [cursor, setCursor] = useState<string | null | undefined>(undefined)
  const [moreBusy, setMoreBusy] = useState(false)
  const [selected, setSelected] = useState<Dispute | null>(null)
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ActionError | null>(null)
  const rows = older.length ? older : disputes.data?.items ?? []
  const nextCursor = cursor === undefined ? disputes.data?.nextCursor ?? null : cursor

  async function refresh() {
    setOlder([])
    setCursor(undefined)
    await disputes.revalidate()
  }

  async function loadMore() {
    const before = cursor === undefined ? disputes.data?.nextCursor : cursor
    if (!before || moreBusy) return
    setMoreBusy(true)
    try {
      const page = await api<DisputesPage>("/api/orders/admin/disputes", { query: { limit: 50, before } })
      setOlder((current) => [...(current.length ? current : disputes.data?.items ?? []), ...page.items])
      setCursor(page.nextCursor)
    } catch (cause) {
      toast.error(errorMessage(cause, "Couldn't load older disputes."))
    } finally {
      setMoreBusy(false)
    }
  }

  async function updateDispute(patch: { adminNote?: string; responseSubmitted?: boolean; status?: "under_review" | "closed" }, success: string) {
    if (!selected || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await api<{ dispute: Dispute }>(`/api/orders/admin/disputes/${selected.id}`, { method: "PATCH", body: patch })
      setSelected(result.dispute)
      if (patch.adminNote !== undefined) setNote(result.dispute.adminNote ?? "")
      await refresh()
      toast.success(success)
    } catch (cause) {
      setError(actionError(cause, "The dispute couldn't be updated."))
    } finally {
      setBusy(false)
    }
  }

  async function update(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected || busy) return
    const next = note.trim()
    if (next === (selected.adminNote ?? "").trim()) {
      setError(null)
      toast.info("Nothing to save", { description: "The note is unchanged." })
      return
    }
    await updateDispute({ adminNote: next }, next ? "Dispute note saved" : "Dispute note cleared")
  }

  const columns: Column<Dispute>[] = [
    { key: "id", header: "Dispute", sortValue: (item) => item.id, cell: (item) => <button type="button" className="max-w-40 truncate text-left font-medium text-ink hover:text-violet" onClick={() => { setSelected(item); setNote(item.adminNote ?? "") }}>{item.id}</button> },
    { key: "status", header: "Status", cell: (item) => <span className="flex flex-wrap gap-1"><StatusBadge tone={tone[item.status] ?? "muted"}>{item.status === "awaiting_response" ? "evidence requested" : showStatus(item.status)}</StatusBadge>{item.responseSubmittedAt ? <StatusBadge tone="info">response submitted</StatusBadge> : null}</span> },
    { key: "amount", header: "Amount", align: "right", sortValue: (item) => item.amountMinor, cell: (item) => money(item.amountMinor, item.currency) },
    { key: "provider", header: "Provider", hideBelow: "md", cell: (item) => item.provider ?? "—" },
    { key: "orders", header: "Orders", cell: (item) => item.orderRefIds?.length ? <span className="flex flex-wrap gap-x-2 gap-y-1">{item.orderRefIds.map((id, index) => <button key={id} type="button" className="text-left text-ink-2 underline underline-offset-2 hover:text-ink" title={id} onClick={() => writeParams({ view: null, order: id })}>Order {index + 1}</button>)}</span> : "No matched order" },
    { key: "opened", header: "Opened", hideBelow: "sm", sortValue: (item) => item.openedAt, cell: (item) => time.format(new Date(item.openedAt)) },
  ]
  const terminal = selected?.status === "won" || selected?.status === "lost" || selected?.status === "closed"
  const evidence = new Map((selected?.evidenceByBrand ?? []).map((item) => [item.brandId, item]))

  return <div className="grid gap-3">
    <Panel title="Payment disputes" description={rights.resolve ? "Review provider status, record Yard's response, and add an internal note. Won and lost outcomes come from the provider." : "Open a dispute to read it. Dispute updates and internal notes need the Support or Owner role."} className="rounded-[20px]" bodyClassName="px-3 sm:px-4 md:px-5">
      {disputes.error ? <PanelError message={errorMessage(disputes.error, "Couldn't load disputes.")} onRetry={() => void refresh()} /> : null}
      <DataTable label="Payment disputes" rows={rows} columns={columns} getId={(item) => item.id} loading={disputes.isLoading} search={{ placeholder: "Search disputes", text: (item) => `${item.id} ${item.provider ?? ""} ${item.providerDisputeId ?? ""} ${item.brandIds?.join(" ") ?? ""}` }} empty={{ title: "No payment disputes", body: "Provider disputes will appear here." }} initialSort={{ key: "opened", dir: "desc" }} pageSizes={[10, 25]} minWidth={340} />
      {nextCursor ? <div className="mt-3"><Button type="button" variant="secondary" loading={moreBusy} disabled={moreBusy} onClick={() => void loadMore()}>Load older disputes</Button></div> : null}
    </Panel>
    {selected ? <Panel title={`Dispute ${selected.id}`} description={`${money(selected.amountMinor, selected.currency)} · ${selected.provider ?? "Provider unknown"}`} className="rounded-[20px]">
      <div className="flex flex-wrap items-center gap-2"><StatusBadge tone={tone[selected.status] ?? "muted"}>{selected.status === "awaiting_response" ? "evidence requested" : showStatus(selected.status)}</StatusBadge>{selected.responseSubmittedAt ? <StatusBadge tone="info">response submitted</StatusBadge> : null}{selected.evidenceDueAt ? <span className="text-xs text-ink-3">Evidence due {time.format(new Date(selected.evidenceDueAt))}</span> : null}</div>
      <div className="mt-3 grid gap-3">{selected.brandIds?.length ? selected.brandIds.map((brandId) => { const item = evidence.get(brandId); return <section key={brandId} className="min-w-0 border-t border-white/10 pt-2"><p className="text-xs font-medium text-ink">Brand {brandId}</p><p className="mt-1 break-words text-sm text-ink-2">{item?.evidence ?? "No evidence submitted."}</p>{item ? <p className="mt-1 text-[11px] text-ink-3">Submitted {time.format(new Date(item.at))}</p> : null}</section> }) : <p className="break-words text-sm text-ink-2">{selected.brandEvidence || "No brand evidence submitted."}</p>}</div>
      {selected.orderRefIds?.length ? <div className="mt-3 flex flex-wrap items-center gap-2"><span className="text-xs text-ink-3">Covered orders</span>{selected.orderRefIds.map((id, index) => <Button key={id} type="button" size="xs" variant="secondary" title={id} onClick={() => writeParams({ view: null, order: id })}>Open order {index + 1}</Button>)}</div> : null}
      {rights.resolve ? <div className="mt-4 grid gap-3 border-t border-white/10 pt-3">
        <p className="text-xs text-ink-3">Evidence requested and won/lost outcomes are set by Paystack. Yard can mark a case under review, record a submitted response, or close it.</p>
        <div className="flex flex-wrap gap-2">{!terminal && selected.status !== "under_review" ? <Button type="button" size="sm" variant="secondary" loading={busy} disabled={busy} onClick={() => void updateDispute({ status: "under_review" }, "Dispute moved under review")}>Mark under review</Button> : null}{!terminal && !selected.responseSubmittedAt ? <Button type="button" size="sm" variant="secondary" loading={busy} disabled={busy} onClick={() => void updateDispute({ responseSubmitted: true }, "Provider response recorded")}>Mark response submitted</Button> : null}{!terminal ? <Button type="button" size="sm" variant="ghost" loading={busy} disabled={busy} onClick={() => void updateDispute({ status: "closed" }, "Dispute closed")}>Close dispute</Button> : null}</div>
        <form className="grid gap-2" onSubmit={(event) => void update(event)}><Label htmlFor="dispute-note">Internal note</Label><Textarea id="dispute-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} rows={3} /><p className="text-xs text-ink-3">Leave it empty and save to remove the note.</p><ActionErrorNote error={error} onReload={() => { setError(null); setSelected(null); void refresh() }} /><div className="flex gap-2"><Button type="submit" loading={busy} disabled={busy}>Save note</Button><Button type="button" variant="ghost" disabled={busy} onClick={() => setSelected(null)}>Close</Button></div></form>
      </div> : <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3"><p className="text-xs text-ink-3">Updates need the Support or Owner role.</p><Button type="button" variant="ghost" onClick={() => setSelected(null)}>Close</Button></div>}
    </Panel> : null}
  </div>
}

function ExceptionsTab() {
  const exceptions = useApi<ExceptionsPage>("admin.orders.exceptions:first", () => api("/api/orders/admin/exceptions", { query: { limit: 50 } }), { keepPrevious: false })
  const [older, setOlder] = useState<{ base: ExceptionsPage; items: OrderException[]; cursor: string | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const first = exceptions.data
  const extra = older && older.base === first ? older : null
  const rows = first ? [...first.items, ...(extra?.items ?? [])] : []
  const cursor = extra ? extra.cursor : first?.nextCursor ?? null
  const columns: Column<OrderException>[] = [
    { key: "type", header: "Type", cell: (item) => <StatusBadge tone={item.kind === "return" ? "attention" : item.status === "failed" ? "danger" : "info"}>{item.kind === "return" ? "return request" : "refund"}</StatusBadge> },
    { key: "order", header: "Order", sortValue: (item) => item.orderReference, cell: (item) => <button type="button" className="text-left font-medium text-ink hover:text-violet" onClick={() => writeParams({ view: null, order: item.orderId })}>#{item.orderReference}<span className="block max-w-[42vw] truncate text-[11px] text-ink-3 sm:max-w-none">{item.brandName}</span></button> },
    { key: "status", header: "Status", cell: (item) => <StatusBadge tone={tone[item.status] ?? "muted"}>{showStatus(item.status)}</StatusBadge> },
    { key: "created", header: "Requested", hideBelow: "sm", sortValue: (item) => item.createdAt, cell: (item) => time.format(new Date(item.createdAt)) },
    { key: "amount", header: "Amount", align: "right", cell: (item) => item.amountMinor === null ? "—" : <span className="whitespace-nowrap">{money(item.amountMinor, item.currency)}</span> },
    { key: "reason", header: "Reason", hideBelow: "md", cell: (item) => <span className="block max-w-56 truncate" title={item.failureReason || item.note || item.reason}>{item.failureReason || item.note || item.reason}</span> },
  ]
  async function loadMore() {
    if (!first || !cursor || busy) return
    setBusy(true)
    try {
      const page = await api<ExceptionsPage>("/api/orders/admin/exceptions", { query: { limit: 50, cursor } })
      setOlder({ base: first, items: [...(extra?.items ?? []), ...page.items], cursor: page.nextCursor })
    } catch (cause) {
      toast.error(errorMessage(cause, "Couldn't load older refunds and returns."))
    } finally {
      setBusy(false)
    }
  }
  return <Panel title="Refund and return exceptions" description="Pending return requests and pending or failed refunds, oldest first. Open an order to review or act on it." className="rounded-[20px]" bodyClassName="px-3 sm:px-4 md:px-5">{exceptions.error ? <PanelError message={errorMessage(exceptions.error, "Couldn't load refund and return exceptions.")} onRetry={() => void exceptions.revalidate()} /> : null}<DataTable label="Refund and return exceptions" rows={rows} columns={columns} getId={(item) => `${item.kind}:${item.id}`} loading={exceptions.isLoading} search={{ placeholder: "Search order, brand, status or reason", text: (item) => `${item.orderReference} ${item.brandName} ${item.status} ${item.reason} ${item.failureReason ?? ""}` }} empty={{ title: "No refund or return exceptions", body: "Pending return requests and pending or failed refunds will appear here." }} initialSort={{ key: "created", dir: "asc" }} pageSizes={[10, 25, 50]} minWidth={360} />{cursor ? <div className="mt-3"><Button type="button" variant="secondary" loading={busy} disabled={busy} onClick={() => void loadMore()}>Load older exceptions</Button></div> : null}</Panel>
}

function EventsTab() {
  const canReplay = useOrderRights().replay
  const events = useApi<{ events: EventSummary[] }>("admin.paystack.events", () => api("/api/webhooks/paystack/events", { query: { limit: 100 } }), { keepPrevious: false })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const detail = useApi<{ event: EventDetail }>(selectedId ? `admin.paystack.event:${selectedId}` : null, () => api(`/api/webhooks/paystack/events/${selectedId}`), { keepPrevious: false })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const columns: Column<EventSummary>[] = [
    { key: "type", header: "Event", sortValue: (event) => event.eventType, cell: (event) => <button type="button" className="max-w-48 truncate text-left font-medium text-ink hover:text-violet" onClick={() => { setSelectedId(event.id); setMessage(null) }}>{event.eventType}</button> },
    { key: "status", header: "Status", cell: (event) => <StatusBadge tone={tone[event.status] ?? "muted"}>{event.status}</StatusBadge> },
    { key: "reference", header: "Reference", hideBelow: "md", cell: (event) => <span className="block max-w-40 truncate" title={event.subjectRef ?? ""}>{event.subjectRef ?? "—"}</span> },
    { key: "received", header: "Received", sortValue: (event) => event.receivedAt, cell: (event) => time.format(new Date(event.receivedAt)) },
    { key: "attempts", header: "Attempts", align: "right", hideBelow: "sm", cell: (event) => event.attempts },
  ]
  async function replay() {
    if (!selectedId || busy) return
    setBusy(true); setMessage(null)
    try {
      const result = await api<{ result: { status: string } }>(`/api/webhooks/paystack/events/${selectedId}/replay`, { method: "POST" })
      await events.revalidate(); await detail.revalidate()
      setMessage(`Replay finished: ${result.result.status}.`)
      toast.success("Payment event replayed")
    } catch (cause) {
      setMessage(errorMessage(cause, "The event couldn't be replayed."))
      if (cause instanceof ApiError && cause.status === 409) void Promise.all([events.revalidate(), detail.revalidate()])
    } finally { setBusy(false) }
  }
  return <div className="grid gap-3"><Panel title="Paystack webhook events" description="Stored provider events with sensitive fields redacted by the server." className="rounded-[20px]" bodyClassName="px-3 sm:px-4 md:px-5">{events.error ? <PanelError message={errorMessage(events.error, "Couldn't load Paystack events.")} onRetry={() => void events.revalidate()} /> : null}<DataTable label="Paystack events" rows={events.data?.events ?? []} columns={columns} getId={(event) => event.id} loading={events.isLoading} search={{ placeholder: "Search event type or reference", text: (event) => `${event.eventType} ${event.subjectRef ?? ""} ${event.status}` }} empty={{ title: "No Paystack events", body: "Webhook events will appear here when Paystack sends them." }} initialSort={{ key: "received", dir: "desc" }} pageSizes={[10, 25]} minWidth={340} /></Panel>{selectedId ? <Panel title="Event detail" description={detail.data ? `${detail.data.event.eventType} · ${detail.data.event.status}` : detail.isLoading ? "Loading event…" : undefined} action={<Button size="sm" variant="ghost" type="button" onClick={() => setSelectedId(null)}>Close</Button>} className="rounded-[20px]">{detail.error ? <PanelError message={errorMessage(detail.error, "Couldn't load event detail.")} onRetry={() => void detail.revalidate()} /> : null}{detail.data ? <><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md bg-black/20 p-3 text-xs text-ink-2">{JSON.stringify(detail.data.event.payload, null, 2)}</pre><div className="mt-3 flex flex-wrap items-center gap-3">{canReplay ? <Button type="button" variant="secondary" loading={busy} disabled={busy} onClick={() => void replay()}>Replay event</Button> : null}{message ? <p role="status" className="text-sm text-ink-2">{message}</p> : null}</div></> : null}</Panel> : null}</div>
}