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
import { errorMessage } from "@/lib/api/errors"
import { useApi } from "@/lib/api/use-api"
import { formatMoney } from "@/lib/money"
import { useServerSession } from "@/lib/session/use-server-session"
import { useSearchParam, writeParams } from "./table"

type Summary = { id: string; reference: string; groupReference: string; checkoutId: string | null; brand: { id: string; name: string; handle: string }; customerName: string; shipToPreview: { city: string | null; country: string }; placedAt: string; currency: string; subtotalMinor: number; shippingMinor: number; totalMinor: number; refundedMinor: number; itemCount: number; previewItems: { productId: string; variantId: string; name: string; qty: number; unitMinor: number }[]; states: { merchant: string; payment: string; fulfilment: string; return: string; dispute: string }; service: string }
type OrdersPage = { items: Summary[]; nextCursor: string | null }
type Detail = Summary & { lines: { id: string; variantId: string; productId: string; title: string; qty: number; unitMinor: number; returnedQty: number; restockedQty: number; variantLabel: string; image: { src: string; alt: string; width: number; height: number } }[]; shipTo: Record<string, unknown> | null; paidAt: string | null; cancelledAt: string | null; cancelReason: string | null; deliveredAt: string | null; completedAt: string | null; refundableMinor: number; returns: { id: string; status: string; reason: string; reasonLabel: string; note: string; requestedAt: string; decisionReason: string | null; refundId: string | null }[]; refunds: { id: string; kind: string; status: string; amountMinor: number; currency: string; reason: string; createdAt: string; settledAt: string | null; returnId: string | null }[]; disputes: { id: string; status: string; category: string | null; amountMinor: number; currency: string; evidenceDueAt: string | null; brandEvidence: string | null; openedAt: string; resolvedAt: string | null }[]; timeline: { id: string; kind: string; actorKind: string; at: string; data: Record<string, unknown> }[]; actions: { canCancel: boolean; canRequestReturn: boolean; returnWindowEndsAt: string | null }; delivery: unknown }
type Dispute = { id: string; status: string; category: string | null; amountMinor: number; currency: string; evidenceDueAt: string | null; brandEvidence: string | null; brandEvidenceAt: string | null; responseSubmittedAt: string | null; openedAt: string; resolvedAt: string | null; adminNote?: string | null; provider?: string; providerDisputeId?: string; orderRefIds?: string[]; brandIds?: string[] }
type EventSummary = { id: string; provider: string; eventType: string; subjectRef: string | null; status: string; receivedAt: string; processedAt: string | null; attempts: number; lastError: string | null }
type EventDetail = EventSummary & { payload: unknown }
type Tab = "orders" | "disputes" | "events"
const tabs: { value: Tab; label: string }[] = [{ value: "orders", label: "Orders" }, { value: "disputes", label: "Disputes" }, { value: "events", label: "Paystack events" }]
const time = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })
const ccy = (value: string): CurrencyCode => value in currencies ? value as CurrencyCode : "USD"
const money = (minor: number, currency: string) => formatMoney(minor, ccy(currency))
const tone: Record<string, "muted" | "info" | "attention" | "success" | "danger"> = { paid: "success", partially_refunded: "attention", refunded: "muted", pending: "attention", failed: "danger", unfulfilled: "attention", processing: "info", shipped: "info", delivered: "success", cancelled: "muted", open: "danger", under_review: "attention", closed: "muted", processed: "success", failed_event: "danger", pending_event: "attention" }
const needsReauth = (error: unknown) => error instanceof ApiError && error.status === 403 && error.fields?.reauth === "required"
const showStatus = (value: string) => value.replaceAll("_", " ")

export function OrdersLiveView() {
  const linked = useSearchParam("view")
  const tab: Tab = tabs.some((item) => item.value === linked) ? linked as Tab : "orders"
  return <div className="@container grid gap-3">
    <AdminPageHead title="Orders" description="Live orders, refunds, returns, disputes, and payment-provider event history." note="Refunds are capped by the server to the amount paid. Refund and replay actions are audited; replay is restricted to owner, engineering, and finance roles." />
    <div className="rail flex gap-1 overflow-x-auto border-b border-white/10">{tabs.map((item) => <button key={item.value} type="button" aria-current={tab === item.value ? "page" : undefined} onClick={() => writeParams({ view: item.value === "orders" ? null : item.value, order: null })} className={`min-h-10 shrink-0 border-b-2 px-3 text-sm ${tab === item.value ? "border-violet text-ink" : "border-transparent text-ink-3 hover:text-ink"}`}>{item.label}</button>)}</div>
    {tab === "orders" ? <OrdersTab /> : null}
    {tab === "disputes" ? <DisputesTab /> : null}
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
  const [action, setAction] = useState<"refund" | "return" | null>(null)
  const [amount, setAmount] = useState("")
  const [reason, setReason] = useState("")
  const [code, setCode] = useState("")
  const [reauth, setReauth] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const idem = useRef<string | null>(null)
  async function refund(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!data || busy) return
    const parsedAmount = Number(amount)
    if (!Number.isSafeInteger(parsedAmount) || parsedAmount <= 0 || parsedAmount > data.refundableMinor) { setMessage(`Enter a whole amount in minor units up to ${data.refundableMinor}.`); return }
    if (!idem.current) idem.current = `admin_refund_${crypto.randomUUID()}`
    setBusy(true); setMessage(null)
    try {
      if (reauth) await api("/api/auth/reauth", { method: "POST", query: { as: "admin" }, body: { code } })
      const result = await api<{ order: Detail; status: string }>(`/api/orders/admin/${id}/refunds`, { method: "POST", body: { amountMinor: parsedAmount, reason: reason.trim(), idempotencyKey: idem.current } })
      toast.success("Refund recorded", { description: `Status: ${result.status}.` })
      idem.current = null
      setAction(null)
      await onChanged()
    } catch (cause) {
      if (needsReauth(cause)) setReauth(true)
      else setMessage(errorMessage(cause, "Refund failed."))
    } finally { setBusy(false) }
  }
  async function decideReturn(returnId: string, decision: "approve" | "reject") {
    const decisionReason = window.prompt(decision === "approve" ? "Reason for approving this return" : "Reason for declining this return")
    if (!decisionReason || decisionReason.trim().length < 3 || busy) return
    setBusy(true)
    try {
      await api(`/api/orders/admin/${id}/returns/${returnId}/decision`, { method: "POST", body: { decision, reason: decisionReason.trim() } })
      await onChanged()
    } catch (cause) { toast.error(errorMessage(cause, "The return decision couldn't be saved.")) } finally { setBusy(false) }
  }
  return <Panel title={data ? `Order #${data.reference}` : "Order detail"} description={data ? `${data.brand.name} · ${data.customerName} · ${time.format(new Date(data.placedAt))}` : undefined} action={<Button type="button" size="sm" variant="ghost" onClick={onClose}>Close</Button>} className="rounded-[20px]">
    {loading ? <div className="skeleton h-32 rounded-md" /> : null}{error ? <PanelError message={errorMessage(error, "Couldn't load this order.")} onRetry={retry} /> : null}
    {data ? <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4"><p className="text-ink-3">Total<span className="mt-1 block text-ink">{money(data.totalMinor, data.currency)}</span></p><p className="text-ink-3">Paid<span className="mt-1 block text-ink">{data.paidAt ? time.format(new Date(data.paidAt)) : "Not paid"}</span></p><p className="text-ink-3">Refundable<span className="mt-1 block text-ink">{money(data.refundableMinor, data.currency)}</span></p><p className="text-ink-3">Fulfilment<span className="mt-1 block capitalize text-ink">{showStatus(data.states.fulfilment)}</span></p></div>
      <div><h3 className="text-sm font-medium text-ink">Items</h3><ul className="mt-2 grid gap-2">{data.lines.map((line) => <li key={line.id} className="flex justify-between gap-3 text-sm"><span className="min-w-0 truncate text-ink-2">{line.title} · {line.variantLabel} × {line.qty}</span><span className="shrink-0 text-ink">{money(line.unitMinor * line.qty, data.currency)}</span></li>)}</ul></div>
      <div className="grid gap-2 sm:grid-cols-2"><div><h3 className="text-sm font-medium text-ink">Refunds</h3>{data.refunds.length ? data.refunds.map((refundItem) => <p key={refundItem.id} className="mt-1 text-xs text-ink-2">{money(refundItem.amountMinor, refundItem.currency)} · {refundItem.status} · {refundItem.reason}</p>) : <p className="mt-1 text-xs text-ink-3">No refunds.</p>}</div><div><h3 className="text-sm font-medium text-ink">Returns</h3>{data.returns.length ? data.returns.map((returnItem) => <div key={returnItem.id} className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-2"><span>{returnItem.reasonLabel} · {returnItem.status}</span>{returnItem.status === "requested" ? <><Button size="xs" type="button" variant="secondary" disabled={busy} onClick={() => void decideReturn(returnItem.id, "approve")}>Approve</Button><Button size="xs" type="button" variant="ghost" disabled={busy} onClick={() => void decideReturn(returnItem.id, "reject")}>Decline</Button></> : null}</div>) : <p className="mt-1 text-xs text-ink-3">No returns.</p>}</div></div>
      <div className="flex flex-wrap gap-2">{data.refundableMinor > 0 ? <Button type="button" size="sm" variant="secondary" onClick={() => { setAction(action === "refund" ? null : "refund"); setMessage(null) }}>Issue refund</Button> : null}{data.returns.some((item) => item.status === "requested") ? null : null}</div>
      {action === "refund" ? <form className="grid gap-3 border-t border-white/10 pt-3 sm:grid-cols-2" onSubmit={(event) => void refund(event)}><p className="text-xs text-ink-3 sm:col-span-2">Enter the refund amount in minor units. Maximum {data.refundableMinor} {data.currency}.</p><div className="grid gap-1.5"><Label htmlFor="admin-refund-amount">Amount (minor units)</Label><Input id="admin-refund-amount" inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value)} required /></div><div className="grid gap-1.5"><Label htmlFor="admin-refund-reason">Reason</Label><Input id="admin-refund-reason" value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={200} required /></div>{reauth ? <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="admin-refund-code">Authenticator code</Label><Input id="admin-refund-code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9 ]{6,7}" value={code} onChange={(event) => setCode(event.target.value)} required /></div> : null}{message ? <p role="alert" className="text-sm text-danger sm:col-span-2">{message}</p> : null}<div className="sm:col-span-2"><Button type="submit" loading={busy} disabled={busy || (reauth && !code.trim())}>{reauth ? "Verify and retry" : "Confirm refund"}</Button></div></form> : null}
      <details><summary className="cursor-pointer text-sm text-ink-2">Order timeline</summary><ol className="mt-2 grid gap-2">{data.timeline.map((event) => <li key={event.id} className="text-xs text-ink-2">{showStatus(event.kind)} · {time.format(new Date(event.at))}</li>)}</ol></details>
    </div> : null}
  </Panel>
}

function DisputesTab() {
  const disputes = useApi<{ items: Dispute[] }>("admin.orders.disputes", () => api("/api/orders/admin/disputes", { query: { limit: 100 } }), { keepPrevious: false })
  const [selected, setSelected] = useState<Dispute | null>(null)
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const columns: Column<Dispute>[] = [
    { key: "id", header: "Dispute", sortValue: (item) => item.id, cell: (item) => <button type="button" className="max-w-40 truncate text-left font-medium text-ink hover:text-violet" onClick={() => { setSelected(item); setNote(item.adminNote ?? "") }}>{item.id}</button> },
    { key: "status", header: "Status", cell: (item) => <StatusBadge tone={tone[item.status] ?? "muted"}>{showStatus(item.status)}</StatusBadge> },
    { key: "amount", header: "Amount", align: "right", sortValue: (item) => item.amountMinor, cell: (item) => money(item.amountMinor, item.currency) },
    { key: "provider", header: "Provider", hideBelow: "md", cell: (item) => item.provider ?? "—" },
    { key: "opened", header: "Opened", hideBelow: "sm", sortValue: (item) => item.openedAt, cell: (item) => time.format(new Date(item.openedAt)) },
  ]
  async function update(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected || busy) return
    setBusy(true); setError(null)
    try {
      await api(`/api/orders/admin/disputes/${selected.id}`, { method: "PATCH", body: { adminNote: note.trim() || undefined } })
      await disputes.revalidate(); setSelected(null); toast.success("Dispute note saved")
    } catch (cause) { setError(errorMessage(cause, "The dispute couldn't be updated.")) } finally { setBusy(false) }
  }
  return <div className="grid gap-3"><Panel title="Payment disputes" description="Open a dispute to add an internal note. Provider outcomes remain authoritative." className="rounded-[20px]" bodyClassName="px-3 sm:px-4 md:px-5">{disputes.error ? <PanelError message={errorMessage(disputes.error, "Couldn't load disputes.")} onRetry={() => void disputes.revalidate()} /> : null}<DataTable label="Payment disputes" rows={disputes.data?.items ?? []} columns={columns} getId={(item) => item.id} loading={disputes.isLoading} search={{ placeholder: "Search disputes", text: (item) => `${item.id} ${item.provider ?? ""} ${item.providerDisputeId ?? ""} ${item.brandIds?.join(" ") ?? ""}` }} empty={{ title: "No payment disputes", body: "Provider disputes will appear here." }} initialSort={{ key: "opened", dir: "desc" }} pageSizes={[10, 25]} minWidth={340} /></Panel>{selected ? <Panel title={`Dispute ${selected.id}`} description={`${money(selected.amountMinor, selected.currency)} · ${selected.provider ?? "Provider unknown"} · ${selected.status}`} className="rounded-[20px]"><p className="text-sm text-ink-2">{selected.brandEvidence || "No brand evidence submitted."}</p><form className="mt-3 grid gap-2" onSubmit={(event) => void update(event)}><Label htmlFor="dispute-note">Internal note</Label><Textarea id="dispute-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} rows={3} />{error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}<div className="flex gap-2"><Button type="submit" loading={busy} disabled={busy}>Save note</Button><Button type="button" variant="ghost" disabled={busy} onClick={() => setSelected(null)}>Close</Button></div></form></Panel> : null}</div>
}

function EventsTab() {
  const role = useServerSession((session) => session.admin?.role ?? null)
  const canReplay = role === "owner" || role === "engineering" || role === "finance"
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
    } catch (cause) { setMessage(errorMessage(cause, "The event couldn't be replayed.")) } finally { setBusy(false) }
  }
  return <div className="grid gap-3"><Panel title="Paystack webhook events" description="Stored provider events with sensitive fields redacted by the server." className="rounded-[20px]" bodyClassName="px-3 sm:px-4 md:px-5">{events.error ? <PanelError message={errorMessage(events.error, "Couldn't load Paystack events.")} onRetry={() => void events.revalidate()} /> : null}<DataTable label="Paystack events" rows={events.data?.events ?? []} columns={columns} getId={(event) => event.id} loading={events.isLoading} search={{ placeholder: "Search event type or reference", text: (event) => `${event.eventType} ${event.subjectRef ?? ""} ${event.status}` }} empty={{ title: "No Paystack events", body: "Webhook events will appear here when Paystack sends them." }} initialSort={{ key: "received", dir: "desc" }} pageSizes={[10, 25]} minWidth={340} /></Panel>{selectedId ? <Panel title="Event detail" description={detail.data ? `${detail.data.event.eventType} · ${detail.data.event.status}` : detail.isLoading ? "Loading event…" : undefined} action={<Button size="sm" variant="ghost" type="button" onClick={() => setSelectedId(null)}>Close</Button>} className="rounded-[20px]">{detail.error ? <PanelError message={errorMessage(detail.error, "Couldn't load event detail.")} onRetry={() => void detail.revalidate()} /> : null}{detail.data ? <><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md bg-black/20 p-3 text-xs text-ink-2">{JSON.stringify(detail.data.event.payload, null, 2)}</pre><div className="mt-3 flex flex-wrap items-center gap-3">{canReplay ? <Button type="button" variant="secondary" loading={busy} disabled={busy} onClick={() => void replay()}>Replay event</Button> : null}{message ? <p role="status" className="text-sm text-ink-2">{message}</p> : null}</div></> : null}</Panel> : null}</div>
}