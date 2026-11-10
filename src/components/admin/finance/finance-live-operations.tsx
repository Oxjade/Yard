"use client"

import { useRef, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { DataTable, type Column } from "@/components/dashboard/data-table"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { Panel, PanelError } from "@/components/admin/ui/panel"
import { currencies, type CurrencyCode } from "@/config/markets"
import { api, ApiError } from "@/lib/api/client"
import { errorMessage } from "@/lib/api/errors"
import { revalidatePrefix, useApi } from "@/lib/api/use-api"
import { formatMoney } from "@/lib/money"

type Batch = { id: string; currency: string; status: string; payoutCount: number; totalMinor: number; createdBy: string; createdAt: string; ranBy: string | null; ranAt: string | null; finishedAt: string | null }
type Payout = { id: string; currency: string; status: string }
type LedgerEntry = { id: string; transactionId: string; at: string; kind: string; memo: string | null; account: string; direction: "debit" | "credit"; amountMinor: number; signedMinor: number; currency: string; orderId: string | null; payoutId: string | null; refundId: string | null }
type LedgerPage = { entries: LedgerEntry[]; nextBefore: string | null }
type OpsTab = "batches" | "ledger" | "adjustments"
const ccy = (value: string): CurrencyCode => value in currencies ? value as CurrencyCode : "USD"
const money = (minor: number, currency: string) => formatMoney(minor, ccy(currency))
const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })
const needsReauth = (error: unknown) => error instanceof ApiError && error.status === 403 && error.fields?.reauth === "required"
const statusTone: Record<string, "muted" | "info" | "attention" | "success" | "danger"> = { open: "attention", running: "info", partial: "attention", done: "success" }

function parseAmount(value: string, currency: string): number | null {
  const places = currencies[ccy(currency)].minor
  const match = /^(\d+)(?:\.(\d*))?$/.exec(value.trim())
  if (!match || (match[2]?.length ?? 0) > places) return null
  const amount = Number(match[1]) * 10 ** places + Number((match[2] ?? "").padEnd(places, "0") || 0)
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null
}

export function FinanceOperations({ tab }: { tab: OpsTab }) {
  if (tab === "batches") return <Batches />
  if (tab === "ledger") return <Ledger />
  return <Adjustments />
}

function Batches() {
  const batches = useApi<{ batches: Batch[] }>("admin.finance.batches", () => api("/api/admin/finance/batches"), { keepPrevious: false })
  const payouts = useApi<{ payouts: Payout[] }>("admin.finance.payouts", () => api("/api/admin/finance/payouts", { query: { limit: 200 } }), { keepPrevious: false })
  const currenciesReady = [...new Set((payouts.data?.payouts ?? []).filter((payout) => payout.status === "approved").map((payout) => payout.currency))]
  const [currency, setCurrency] = useState("")
  const [selected, setSelected] = useState<Batch | null>(null)
  const [code, setCode] = useState("")
  const [reauth, setReauth] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const columns: Column<Batch>[] = [
    { key: "id", header: "Batch", sortValue: (batch) => batch.id, cell: (batch) => <span className="font-medium text-ink">{batch.id}</span> },
    { key: "currency", header: "Currency", sortValue: (batch) => batch.currency, cell: (batch) => batch.currency },
    { key: "total", header: "Total", align: "right", sortValue: (batch) => batch.totalMinor, cell: (batch) => money(batch.totalMinor, batch.currency) },
    { key: "count", header: "Payouts", align: "right", sortValue: (batch) => batch.payoutCount, cell: (batch) => batch.payoutCount },
    { key: "status", header: "Status", cell: (batch) => <StatusBadge tone={statusTone[batch.status] ?? "muted"}>{batch.status}</StatusBadge> },
    { key: "created", header: "Created", hideBelow: "md", sortValue: (batch) => batch.createdAt, cell: (batch) => dateTime.format(new Date(batch.createdAt)) },
    { key: "run", header: "Run", cell: (batch) => batch.status === "done" ? "Complete" : <Button type="button" size="xs" variant="secondary" disabled={busy || batch.status === "running"} onClick={() => { setSelected(batch); setError(null); setReauth(false); setCode("") }}>Run batch</Button> },
  ]
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !currency) return
    setBusy(true); setError(null)
    try {
      await api("/api/admin/finance/batches", { method: "POST", body: { currency } })
      await Promise.all([batches.revalidate(), payouts.revalidate()])
      toast.success("Payout batch created", { description: `Approved ${currency} payouts grouped into a batch.` })
    } catch (cause) { setError(errorMessage(cause, "The payout batch couldn't be created.")) } finally { setBusy(false) }
  }
  async function run(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !selected) return
    setBusy(true); setError(null)
    try {
      if (reauth) await api("/api/auth/reauth", { method: "POST", query: { as: "admin" }, body: { code } })
      const result = await api<{ results: { payoutId: string; status: string }[] }>(`/api/admin/finance/batches/${selected.id}/run`, { method: "POST" })
      await Promise.all([batches.revalidate(), payouts.revalidate()])
      setSelected(null); setReauth(false)
      toast.success("Batch run finished", { description: result.results.map((item) => `${item.payoutId}: ${item.status}`).join(" · ") || "No payouts needed sending." })
    } catch (cause) { if (needsReauth(cause)) setReauth(true); else setError(errorMessage(cause, "The batch couldn't be run.")) } finally { setBusy(false) }
  }
  return <div className="grid gap-3">
    <Panel title="Create a payout batch" description="Groups approved, unbatched payouts in one currency. Brand payout holds are respected by the server." className="rounded-[20px]"><form className="flex flex-wrap items-end gap-3" onSubmit={(event) => void create(event)}><div className="grid min-w-48 gap-1.5"><Label htmlFor="batch-currency">Currency</Label><select id="batch-currency" className="h-10 rounded-md border border-white/10 bg-obsidian px-3 text-sm text-ink" value={currency} onChange={(event) => setCurrency(event.target.value)} required><option value="">Choose currency</option>{currenciesReady.map((value) => <option key={value} value={value}>{value}</option>)}</select></div><Button type="submit" loading={busy} disabled={busy || !currenciesReady.length}>Create batch</Button>{!currenciesReady.length ? <span className="text-xs text-ink-3">No approved payouts are ready to batch.</span> : null}</form>{error && !selected ? <p role="alert" className="mt-3 text-sm text-danger">{error}</p> : null}</Panel>
    {selected ? <Panel title="Run payout batch" description={`This asks the provider to send approved ${selected.currency} payouts. Re-running only sends payouts still approved.`} className="rounded-[20px]"><form className="grid max-w-md gap-3" onSubmit={(event) => void run(event)}>{reauth ? <div className="grid gap-1.5"><Label htmlFor="batch-code">Authenticator code</Label><Input id="batch-code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9 ]{6,7}" value={code} onChange={(event) => setCode(event.target.value)} required /></div> : null}{error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}<div className="flex gap-2"><Button type="submit" loading={busy} disabled={busy || (reauth && !code.trim())}>{reauth ? "Verify and run" : "Confirm batch run"}</Button><Button type="button" variant="ghost" disabled={busy} onClick={() => setSelected(null)}>Cancel</Button></div></form></Panel> : null}
    <Panel title="Recent batches" description="Batch totals and statuses from the server." className="rounded-[20px]" bodyClassName="px-3 sm:px-4 md:px-5">{batches.error ? <PanelError message={errorMessage(batches.error, "Couldn't load batches.")} onRetry={() => void batches.revalidate()} /> : null}<DataTable label="Payout batches" rows={batches.data?.batches ?? []} columns={columns} getId={(batch) => batch.id} loading={batches.isLoading} search={{ placeholder: "Search batch IDs", text: (batch) => batch.id }} empty={{ title: "No payout batches", body: "Create a batch after two different admins approve a payout." }} initialSort={{ key: "created", dir: "desc" }} pageSizes={[10, 25]} minWidth={360} /></Panel>
  </div>
}

function Ledger() {
  const ledger = useApi<LedgerPage>("admin.finance.ledger", () => api("/api/admin/finance/ledger", { query: { limit: 200 } }), { keepPrevious: false })
  const [older, setOlder] = useState<LedgerEntry[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const rows = older.length ? older : ledger.data?.entries ?? []
  const columns: Column<LedgerEntry>[] = [
    { key: "at", header: "Date (UTC)", hideBelow: "md", sortValue: (entry) => entry.at, cell: (entry) => dateTime.format(new Date(entry.at)) },
    { key: "id", header: "Entry", sortValue: (entry) => entry.id, cell: (entry) => <span className="block max-w-48 truncate font-medium" title={entry.id}>{entry.id}</span> },
    { key: "kind", header: "Type", sortValue: (entry) => entry.kind, cell: (entry) => <span className="capitalize">{entry.kind.replaceAll("_", " ")}</span> },
    { key: "account", header: "Account", hideBelow: "lg", cell: (entry) => entry.account.replaceAll("_", " ") },
    { key: "memo", header: "Memo", hideBelow: "md", cell: (entry) => entry.memo ?? "—" },
    { key: "amount", header: "Amount", align: "right", sortValue: (entry) => entry.signedMinor, cell: (entry) => <span className="whitespace-nowrap tabular">{entry.direction === "debit" ? "−" : "+"}{money(entry.amountMinor, entry.currency)} <span className="text-[10px] text-ink-3">{entry.currency}</span></span> },
  ]
  async function loadOlder() {
    const before = cursor ?? ledger.data?.nextBefore
    if (!before || busy) return
    setBusy(true)
    try {
      const page = await api<LedgerPage>("/api/admin/finance/ledger", { query: { limit: 200, before } })
      setOlder((current) => [...(current.length ? current : ledger.data?.entries ?? []), ...page.entries]); setCursor(page.nextBefore)
    } catch (cause) { toast.error(errorMessage(cause, "Couldn't load older ledger entries.")) } finally { setBusy(false) }
  }
  return <Panel title="Ledger" description="Append-only journal entries, newest first. Amounts retain their original currency." className="rounded-[20px]" bodyClassName="px-3 sm:px-4 md:px-5">{ledger.error ? <PanelError message={errorMessage(ledger.error, "Couldn't load ledger entries.")} onRetry={() => void ledger.revalidate()} /> : null}<DataTable label="Finance ledger entries" rows={rows} columns={columns} getId={(entry) => entry.id} loading={ledger.isLoading} search={{ placeholder: "Search ledger entries", text: (entry) => `${entry.id} ${entry.transactionId} ${entry.kind} ${entry.memo ?? ""} ${entry.orderId ?? ""} ${entry.payoutId ?? ""}` }} empty={{ title: "No ledger entries", body: "Finance activity appears here as it is posted." }} initialSort={{ key: "at", dir: "desc" }} pageSizes={[25, 50]} initialPageSize={25} minWidth={360} />{ledger.data?.nextBefore || cursor ? <div className="mt-3"><Button type="button" variant="secondary" loading={busy} disabled={busy} onClick={() => void loadOlder()}>Load older entries</Button></div> : null}</Panel>
}

function Adjustments() {
  const key = useRef<{ fingerprint: string; value: string } | null>(null)
  const [brandId, setBrandId] = useState("")
  const [currency, setCurrency] = useState("USD")
  const [account, setAccount] = useState("brand_available")
  const [direction, setDirection] = useState("credit")
  const [amount, setAmount] = useState("")
  const [reason, setReason] = useState("")
  const [code, setCode] = useState("")
  const [reauth, setReauth] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<string | null>(null)
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const amountMinor = parseAmount(amount, currency)
    if (amountMinor === null) { setError(`Enter a positive amount with no more than ${currencies[ccy(currency)].minor} decimal places.`); return }
    const values = { brandId: brandId.trim(), currency, account, direction, amountMinor, reason: reason.trim() }
    const fingerprint = JSON.stringify(values)
    if (key.current?.fingerprint !== fingerprint) key.current = { fingerprint, value: `adj_${crypto.randomUUID()}` }
    setBusy(true); setError(null)
    try {
      if (reauth) await api("/api/auth/reauth", { method: "POST", query: { as: "admin" }, body: { code } })
      const result = await api<{ transactionId: string; duplicate: boolean }>("/api/admin/finance/adjustments", { method: "POST", body: { ...values, idempotencyKey: key.current.value } })
      setReceipt(`${money(amountMinor, currency)} ${direction === "credit" ? "credited to" : "debited from"} ${brandId.trim()} · ${result.transactionId}`)
      key.current = null; setReauth(false); setCode(""); setAmount(""); setReason("")
      revalidatePrefix("admin.finance.ledger")
      toast.success(result.duplicate ? "Adjustment already recorded" : "Adjustment posted")
    } catch (cause) { if (needsReauth(cause)) setReauth(true); else setError(errorMessage(cause, "The adjustment couldn't be posted.")) } finally { setBusy(false) }
  }
  return <Panel title="Post a ledger adjustment" description="This posts immediately as a new balanced entry. It cannot be edited or withdrawn; provide a clear reason." className="rounded-[20px]"><form className="grid min-w-0 gap-3 sm:grid-cols-2" onSubmit={(event) => void submit(event)}>
    <div className="grid min-w-0 gap-1.5"><Label htmlFor="adjust-brand">Brand ID</Label><Input id="adjust-brand" value={brandId} onChange={(event) => setBrandId(event.target.value)} maxLength={64} required /></div>
    <div className="grid min-w-0 gap-1.5"><Label htmlFor="adjust-currency">Currency</Label><select id="adjust-currency" className="h-10 rounded-md border border-white/10 bg-obsidian px-3 text-sm text-ink" value={currency} onChange={(event) => setCurrency(event.target.value)}>{Object.keys(currencies).map((value) => <option key={value} value={value}>{value}</option>)}</select></div>
    <div className="grid min-w-0 gap-1.5"><Label htmlFor="adjust-account">Brand account</Label><select id="adjust-account" className="h-10 rounded-md border border-white/10 bg-obsidian px-3 text-sm text-ink" value={account} onChange={(event) => setAccount(event.target.value)}><option value="brand_available">Available</option><option value="brand_reserve">Reserve</option><option value="brand_pending">Pending</option></select></div>
    <div className="grid min-w-0 gap-1.5"><Label htmlFor="adjust-direction">Direction</Label><select id="adjust-direction" className="h-10 rounded-md border border-white/10 bg-obsidian px-3 text-sm text-ink" value={direction} onChange={(event) => setDirection(event.target.value)}><option value="credit">Credit brand</option><option value="debit">Debit brand</option></select></div>
    <div className="grid min-w-0 gap-1.5"><Label htmlFor="adjust-amount">Amount ({currency})</Label><Input id="adjust-amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} required /></div>
    <div className="grid min-w-0 gap-1.5 sm:col-span-2"><Label htmlFor="adjust-reason">Reason</Label><Textarea id="adjust-reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} required rows={3} /></div>
    {reauth ? <div className="grid gap-1.5 sm:max-w-xs sm:col-span-2"><Label htmlFor="adjust-code">Authenticator code</Label><Input id="adjust-code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9 ]{6,7}" value={code} onChange={(event) => setCode(event.target.value)} required /></div> : null}
    {error ? <p role="alert" className="text-sm text-danger sm:col-span-2">{error}</p> : null}{receipt ? <p role="status" className="text-sm text-ink-2 sm:col-span-2">{receipt}</p> : null}
    <div className="sm:col-span-2"><Button type="submit" loading={busy} disabled={busy || (reauth && !code.trim())}>{reauth ? "Verify and retry" : "Post adjustment"}</Button></div>
  </form></Panel>
}