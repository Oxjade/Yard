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
import { api } from "@/lib/api/client"
import { errorMessage } from "@/lib/api/errors"
import { revalidatePrefix, useApi } from "@/lib/api/use-api"
import { formatMoney } from "@/lib/money"
import { actionError, ActionErrorNote, ReauthCodeField, useReauth, type ActionError } from "./reauth"

type Batch = { id: string; currency: string; status: string; payoutCount: number; totalMinor: number; createdBy: string; createdAt: string; ranBy: string | null; ranAt: string | null; finishedAt: string | null }
type Payout = { id: string; currency: string; status: string; batchId: string | null }
type LedgerEntry = { id: string; transactionId: string; at: string; kind: string; memo: string | null; account: string; direction: "debit" | "credit"; amountMinor: number; signedMinor: number; currency: string; orderId: string | null; payoutId: string | null; refundId: string | null }
type LedgerPage = { entries: LedgerEntry[]; nextBefore: string | null }
type OpsTab = "batches" | "ledger" | "adjustments"
const ccy = (value: string): CurrencyCode => value in currencies ? value as CurrencyCode : "USD"
const money = (minor: number, currency: string) => formatMoney(minor, ccy(currency))
const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })
const statusTone: Record<string, "muted" | "info" | "attention" | "success" | "danger"> = { open: "attention", running: "info", partial: "attention", done: "success" }

/** A major-unit amount typed by an admin ("1150.50") in minor units for `currency`, or null. No float maths. */
export function parseAmount(value: string, currency: string): number | null {
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

/** Currencies with approved payouts that aren't in a batch yet: what createBatch will accept. Pages past 200. */
async function readyCurrencies(): Promise<string[]> {
  const found = new Set<string>()
  let before: string | undefined
  for (let page = 0; page < 10; page++) {
    const result = await api<{ payouts: Payout[]; nextBefore: string | null }>("/api/admin/finance/payouts", { query: { status: "approved", limit: 200, before } })
    for (const payout of result.payouts) if (!payout.batchId) found.add(payout.currency)
    if (result.payouts.length < 200 || !result.nextBefore) break
    before = result.nextBefore
  }
  return [...found].sort()
}

function Batches() {
  const batches = useApi<{ batches: Batch[] }>("admin.finance.batches", () => api("/api/admin/finance/batches"), { keepPrevious: false })
  const ready = useApi<string[]>("admin.finance.payouts:ready-currencies", readyCurrencies, { keepPrevious: false })
  const currenciesReady = ready.data ?? []
  const [chosen, setCurrency] = useState("")
  const currency = currenciesReady.includes(chosen) ? chosen : ""
  const [selected, setSelected] = useState<Batch | null>(null)
  const reauth = useReauth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ActionError | null>(null)
  const reload = () => { setError(null); void Promise.all([batches.revalidate(), ready.revalidate()]) }
  const columns: Column<Batch>[] = [
    { key: "id", header: "Batch", sortValue: (batch) => batch.id, cell: (batch) => <span className="font-medium text-ink">{batch.id}</span> },
    { key: "currency", header: "Currency", sortValue: (batch) => batch.currency, cell: (batch) => batch.currency },
    { key: "total", header: "Total", align: "right", sortValue: (batch) => batch.totalMinor, cell: (batch) => money(batch.totalMinor, batch.currency) },
    { key: "count", header: "Payouts", align: "right", sortValue: (batch) => batch.payoutCount, cell: (batch) => batch.payoutCount },
    { key: "status", header: "Status", cell: (batch) => <StatusBadge tone={statusTone[batch.status] ?? "muted"}>{batch.status}</StatusBadge> },
    { key: "created", header: "Created", hideBelow: "md", sortValue: (batch) => batch.createdAt, cell: (batch) => dateTime.format(new Date(batch.createdAt)) },
    { key: "run", header: "Run", cell: (batch) => batch.status === "done" ? "Complete" : <Button type="button" size="xs" variant="secondary" disabled={busy || batch.status === "running"} onClick={() => { setSelected(batch); setError(null); reauth.reset() }}>Run batch</Button> },
  ]
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !currency) return
    setBusy(true); setError(null)
    try {
      await api("/api/admin/finance/batches", { method: "POST", body: { currency } })
      await Promise.all([batches.revalidate(), ready.revalidate()])
      setCurrency("")
      toast.success("Payout batch created", { description: `Approved ${currency} payouts grouped into a batch.` })
    } catch (cause) { setError(actionError(cause, "The payout batch couldn't be created.")) } finally { setBusy(false) }
  }
  async function run(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !selected) return
    setBusy(true); setError(null)
    try {
      if (!(await reauth.verify())) return
      const result = await api<{ results: { payoutId: string; status: string }[] }>(`/api/admin/finance/batches/${selected.id}/run`, { method: "POST" })
      await Promise.all([batches.revalidate(), ready.revalidate()])
      setSelected(null)
      toast.success("Batch run finished", { description: result.results.map((item) => `${item.payoutId}: ${item.status}`).join(" · ") || "No payouts needed sending." })
    } catch (cause) { if (!reauth.catches(cause)) setError(actionError(cause, "The batch couldn't be run.")) } finally { setBusy(false) }
  }
  return <div className="grid gap-3">
    <Panel title="Create a payout batch" description="Groups approved, unbatched payouts in one currency. Brand payout holds are respected by the server." className="rounded-[20px]"><form className="flex flex-wrap items-end gap-3" onSubmit={(event) => void create(event)}><div className="grid min-w-48 gap-1.5"><Label htmlFor="batch-currency">Currency</Label><select id="batch-currency" className="h-10 rounded-md border border-white/10 bg-obsidian px-3 text-sm text-ink" value={currency} onChange={(event) => setCurrency(event.target.value)} required><option value="">Choose currency</option>{currenciesReady.map((value) => <option key={value} value={value}>{value}</option>)}</select></div><Button type="submit" loading={busy && !selected} disabled={busy || !currency}>Create batch</Button>{ready.isLoading && !ready.data ? <span className="text-xs text-ink-3">Checking approved payouts…</span> : ready.data && !currenciesReady.length ? <span className="text-xs text-ink-3">No approved, unbatched payouts are ready to batch.</span> : null}</form>{ready.error ? <div className="mt-3"><PanelError message={errorMessage(ready.error, "Couldn't check which payouts are ready.")} onRetry={() => void ready.revalidate()} /></div> : null}{!selected ? <ActionErrorNote error={error} onReload={reload} className="mt-3" /> : null}</Panel>
    {selected ? <Panel title="Run payout batch" description={`This asks the provider to send approved ${selected.currency} payouts. Re-running only sends payouts still approved.`} className="rounded-[20px]"><form className="grid max-w-md gap-3" onSubmit={(event) => void run(event)}><ReauthCodeField reauth={reauth} id="batch-code" /><ActionErrorNote error={error} onReload={() => { setSelected(null); reload() }} /><div className="flex gap-2"><Button type="submit" loading={busy} disabled={busy || reauth.waiting}>{reauth.required ? "Verify and run" : "Confirm batch run"}</Button><Button type="button" variant="ghost" disabled={busy} onClick={() => setSelected(null)}>Cancel</Button></div></form></Panel> : null}
    <Panel title="Recent batches" description="Batch totals and statuses from the server." className="rounded-[20px]" bodyClassName="px-3 sm:px-4 md:px-5">{batches.error ? <PanelError message={errorMessage(batches.error, "Couldn't load batches.")} onRetry={() => void batches.revalidate()} /> : null}<DataTable label="Payout batches" rows={batches.data?.batches ?? []} columns={columns} getId={(batch) => batch.id} loading={batches.isLoading} search={{ placeholder: "Search batch IDs", text: (batch) => batch.id }} empty={{ title: "No payout batches", body: "Create a batch after two different admins approve a payout." }} initialSort={{ key: "created", dir: "desc" }} pageSizes={[10, 25]} minWidth={360} /></Panel>
  </div>
}

const LEDGER_PAGE = 200

function Ledger() {
  const [brandIdDraft, setBrandIdDraft] = useState("")
  const [brandFilter, setBrandFilter] = useState("")
  const ledger = useApi<LedgerPage>(`admin.finance.ledger:${brandFilter}`, () => api("/api/admin/finance/ledger", { query: { limit: LEDGER_PAGE, ...(brandFilter ? { brandId: brandFilter } : {}) } }), { keepPrevious: false })
  // Older pages belong to the first page they were loaded under: when that page revalidates (a new
  // adjustment, say), they're dropped and paging starts again from the fresh first page.
  const [older, setOlder] = useState<{ base: LedgerPage; entries: LedgerEntry[]; cursor: string | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const first = ledger.data
  const extra = older && older.base === first ? older : null
  const rows = first ? (extra ? [...first.entries, ...extra.entries] : first.entries) : []
  // null = no more pages: the server returns a cursor for any non-empty page, so a short page is the end.
  const cursor = extra ? extra.cursor : first && first.entries.length >= LEDGER_PAGE ? first.nextBefore : null
  const columns: Column<LedgerEntry>[] = [
    { key: "at", header: "Date (UTC)", hideBelow: "md", sortValue: (entry) => entry.at, cell: (entry) => dateTime.format(new Date(entry.at)) },
    { key: "id", header: "Entry", sortValue: (entry) => entry.id, cell: (entry) => <span className="block max-w-48 truncate font-medium" title={entry.id}>{entry.id}</span> },
    { key: "kind", header: "Type", sortValue: (entry) => entry.kind, cell: (entry) => <span className="capitalize">{entry.kind.replaceAll("_", " ")}</span> },
    { key: "account", header: "Account", hideBelow: "lg", cell: (entry) => entry.account.replaceAll("_", " ") },
    { key: "memo", header: "Memo", hideBelow: "md", cell: (entry) => entry.memo ?? "—" },
    { key: "amount", header: "Amount", align: "right", sortValue: (entry) => entry.signedMinor, cell: (entry) => <span className="whitespace-nowrap tabular">{entry.direction === "debit" ? "−" : "+"}{money(entry.amountMinor, entry.currency)} <span className="text-[10px] text-ink-3">{entry.currency}</span></span> },
  ]
  async function loadOlder() {
    if (!first || !cursor || busy) return
    setBusy(true)
    try {
      const page = await api<LedgerPage>("/api/admin/finance/ledger", { query: { limit: LEDGER_PAGE, before: cursor, ...(brandFilter ? { brandId: brandFilter } : {}) } })
      const seen = new Set([...first.entries, ...(extra?.entries ?? [])].map((entry) => entry.id))
      setOlder({ base: first, entries: [...(extra?.entries ?? []), ...page.entries.filter((entry) => !seen.has(entry.id))], cursor: page.entries.length >= LEDGER_PAGE ? page.nextBefore : null })
    } catch (cause) { toast.error(errorMessage(cause, "Couldn't load older ledger entries.")) } finally { setBusy(false) }
  }
  return <Panel title="Ledger" description={brandFilter ? `Brand ${brandFilter} journal entries, newest first. Amounts retain their original currency.` : "Platform journal entries, newest first. Amounts retain their original currency."} className="rounded-[20px]" bodyClassName="px-3 sm:px-4 md:px-5">{ledger.error ? <PanelError message={errorMessage(ledger.error, "Couldn't load ledger entries.")} onRetry={() => void ledger.revalidate()} /> : null}<form className="mb-3 flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); setBrandFilter(brandIdDraft.trim()) }}><div className="grid min-w-0 max-w-sm flex-1 gap-1.5"><Label htmlFor="ledger-brand-filter">Brand ID</Label><Input id="ledger-brand-filter" value={brandIdDraft} onChange={(event) => setBrandIdDraft(event.target.value)} maxLength={80} placeholder="Leave empty for platform ledger" /></div><Button type="submit" variant="secondary">Apply filter</Button>{brandFilter ? <Button type="button" variant="ghost" onClick={() => { setBrandIdDraft(""); setBrandFilter("") }}>Clear brand</Button> : null}</form><DataTable label="Finance ledger entries" rows={rows} columns={columns} getId={(entry) => entry.id} loading={ledger.isLoading} search={{ placeholder: "Search ledger entries", text: (entry) => `${entry.id} ${entry.transactionId} ${entry.kind} ${entry.memo ?? ""} ${entry.orderId ?? ""} ${entry.payoutId ?? ""}` }} empty={{ title: "No ledger entries", body: brandFilter ? "No journal entries were found for this brand." : "Finance activity appears here as it is posted." }} initialSort={{ key: "at", dir: "desc" }} pageSizes={[25, 50]} initialPageSize={25} minWidth={360} />{cursor ? <div className="mt-3"><Button type="button" variant="secondary" loading={busy} disabled={busy} onClick={() => void loadOlder()}>Load older entries</Button></div> : extra ? <p className="mt-3 text-xs text-ink-3">That&apos;s the start of the ledger.</p> : null}</Panel>
}

function Adjustments() {
  const key = useRef<{ fingerprint: string; value: string } | null>(null)
  const [brandId, setBrandId] = useState("")
  // The brand's own currency, looked up once the ID is entered, so the currency isn't left on a default.
  const [brand, setBrand] = useState<{ id: string; name: string; currency: string } | null>(null)
  const [currency, setCurrency] = useState("")
  const [account, setAccount] = useState("brand_available")
  const [direction, setDirection] = useState("credit")
  const [amount, setAmount] = useState("")
  const [reason, setReason] = useState("")
  const reauth = useReauth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ActionError | null>(null)
  const [receipt, setReceipt] = useState<string | null>(null)
  async function lookUpBrand() {
    const id = brandId.trim()
    if (!id || brand?.id === id) return
    try {
      const result = await api<{ brand: { id: string; name: string; currency: string } }>(`/api/admin/finance/brands/${encodeURIComponent(id)}`)
      if (result.brand.id !== id) return
      setBrand(result.brand)
      setCurrency((current) => current || result.brand.currency)
    } catch { setBrand(null) }
  }
  const knownBrand = brand && brand.id === brandId.trim() ? brand : null
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    if (!currency) { setError({ message: "Choose the currency to post in.", conflict: false }); return }
    const amountMinor = parseAmount(amount, currency)
    if (amountMinor === null) { setError({ message: `Enter a positive amount with no more than ${currencies[ccy(currency)].minor} decimal places.`, conflict: false }); return }
    const values = { brandId: brandId.trim(), currency, account, direction, amountMinor, reason: reason.trim() }
    const fingerprint = JSON.stringify(values)
    if (key.current?.fingerprint !== fingerprint) key.current = { fingerprint, value: `adj_${crypto.randomUUID()}` }
    setBusy(true); setError(null)
    try {
      if (!(await reauth.verify())) return
      const result = await api<{ transactionId: string; duplicate: boolean }>("/api/admin/finance/adjustments", { method: "POST", body: { ...values, idempotencyKey: key.current.value } })
      setReceipt(`${money(amountMinor, currency)} ${direction === "credit" ? "credited to" : "debited from"} ${brandId.trim()} · ${result.transactionId}`)
      key.current = null; setAmount(""); setReason("")
      revalidatePrefix("admin.finance.ledger")
      toast.success(result.duplicate ? "Adjustment already recorded" : "Adjustment posted")
    } catch (cause) { if (!reauth.catches(cause)) setError(actionError(cause, "The adjustment couldn't be posted.")) } finally { setBusy(false) }
  }
  return <Panel title="Post a ledger adjustment" description="This posts immediately as a new balanced entry. It cannot be edited or withdrawn; provide a clear reason." className="rounded-[20px]"><form className="grid min-w-0 gap-3 sm:grid-cols-2" onSubmit={(event) => void submit(event)}>
    <div className="grid min-w-0 gap-1.5"><Label htmlFor="adjust-brand">Brand ID</Label><Input id="adjust-brand" value={brandId} onChange={(event) => setBrandId(event.target.value)} onBlur={() => void lookUpBrand()} maxLength={64} required />{knownBrand ? <p className="text-xs text-ink-3">{knownBrand.name} · pays out in {knownBrand.currency}</p> : null}</div>
    <div className="grid min-w-0 gap-1.5"><Label htmlFor="adjust-currency">Currency</Label><select id="adjust-currency" className="h-10 rounded-md border border-white/10 bg-obsidian px-3 text-sm text-ink" value={currency} onChange={(event) => setCurrency(event.target.value)} required aria-describedby="adjust-currency-note"><option value="">Choose currency</option>{Object.keys(currencies).map((value) => <option key={value} value={value}>{value}</option>)}</select>{knownBrand && currency && currency !== knownBrand.currency ? <p id="adjust-currency-note" role="alert" className="text-xs text-danger">{knownBrand.name} pays out in {knownBrand.currency}. A {currency} balance can&apos;t be paid out to its account.</p> : null}</div>
    <div className="grid min-w-0 gap-1.5"><Label htmlFor="adjust-account">Brand account</Label><select id="adjust-account" className="h-10 rounded-md border border-white/10 bg-obsidian px-3 text-sm text-ink" value={account} onChange={(event) => setAccount(event.target.value)}><option value="brand_available">Available</option><option value="brand_reserve">Reserve</option><option value="brand_pending">Pending</option></select></div>
    <div className="grid min-w-0 gap-1.5"><Label htmlFor="adjust-direction">Direction</Label><select id="adjust-direction" className="h-10 rounded-md border border-white/10 bg-obsidian px-3 text-sm text-ink" value={direction} onChange={(event) => setDirection(event.target.value)}><option value="credit">Credit brand</option><option value="debit">Debit brand</option></select></div>
    <div className="grid min-w-0 gap-1.5"><Label htmlFor="adjust-amount">Amount{currency ? ` (${currency})` : ""}</Label><Input id="adjust-amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} required /></div>
    <div className="grid min-w-0 gap-1.5 sm:col-span-2"><Label htmlFor="adjust-reason">Reason</Label><Textarea id="adjust-reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} required rows={3} /></div>
    <ReauthCodeField reauth={reauth} id="adjust-code" className="sm:col-span-2 sm:max-w-xs" />
    <ActionErrorNote error={error} onReload={() => setError(null)} className="sm:col-span-2" />{receipt ? <p role="status" className="text-sm text-ink-2 sm:col-span-2">{receipt}</p> : null}
    <div className="sm:col-span-2"><Button type="submit" loading={busy} disabled={busy || reauth.waiting}>{reauth.required ? "Verify and retry" : "Post adjustment"}</Button></div>
  </form></Panel>
}
