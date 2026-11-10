"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { DataTable, type Column } from "@/components/dashboard/data-table"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { Panel, PanelError } from "@/components/admin/ui/panel"
import { api, ApiError } from "@/lib/api/client"
import { errorMessage } from "@/lib/api/errors"
import { useApi } from "@/lib/api/use-api"
import { formatMoney, formatNumber } from "@/lib/money"
import { currencies, type CurrencyCode } from "@/config/markets"
import { actionError, ActionErrorNote, ReauthCodeField, useReauth, type ActionError } from "./reauth"

type BrandFinance = { brand: { id: string; name: string; currency: string }; balances: { currency: string; pendingMinor: number; availableMinor: number; reserveMinor: number; inPayoutMinor: number }[]; account: { bankName: string; accountLast4: string } | null; rules: { tier: string; reserveBps: number; reserveDays: number; commissionBps: number; minPayoutMinor: number; onHold: boolean; holdReason: string | null; cooldownUntil: string | null }; payouts: unknown[]; overrides: { tierOverride: string | null; commissionBpsOverride: number | null } }
type Run = { id: string; windowFrom: string; windowTo: string; status: string; providerCompared: boolean; checked: number; mismatches: number; summary: Record<string, number>; triggeredBy: string; startedAt: string; finishedAt: string | null }
type Item = { id: string; runId: string; kind: string; ref: string; currency: string | null; ledgerMinor: number | null; providerMinor: number | null; facts: Record<string, string | number | boolean | null>; status: string; resolvedBy: string | null; resolvedAt: string | null; resolutionNote: string | null }
type ReconciliationDetail = { run: Run; items: Item[] }
type Tab = "brands" | "reconciliation"
const time = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })
const money = (minor: number, currency: string) => formatMoney(minor, (currency in currencies ? currency : "USD") as CurrencyCode)
const tones: Record<string, "muted" | "info" | "attention" | "success" | "danger"> = { ok: "success", mismatches: "danger", failed: "danger", running: "info", resolved: "success" }

export function FinanceControls({ tab }: { tab: Tab }) {
  return tab === "brands" ? <BrandSettings /> : <Reconciliation />
}

function BrandSettings() {
  const [brandInput, setBrandInput] = useState("")
  const [brandId, setBrandId] = useState<string | null>(null)
  const settings = useApi<BrandFinance>(brandId ? `admin.finance.brand:${brandId}` : null, () => api(`/api/admin/finance/brands/${brandId}`), { keepPrevious: false })
  // undefined = untouched, so a save leaves that setting as stored; "" = no override (sent as null to clear one).
  const [tier, setTier] = useState<string | undefined>(undefined)
  const [commission, setCommission] = useState<string | undefined>(undefined)
  const [hold, setHold] = useState<boolean | null>(null)
  const [holdReason, setHoldReason] = useState<string | undefined>(undefined)
  const reauth = useReauth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ActionError | null>(null)
  function resetForm() {
    setTier(undefined); setCommission(undefined); setHold(null); setHoldReason(undefined); reauth.reset(); setError(null)
  }
  function load(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBrandId(brandInput.trim()); resetForm()
  }
  async function reload() {
    resetForm(); await settings.revalidate()
  }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!brandId || !settings.data || busy) return
    const stored = settings.data.overrides
    const rules = settings.data.rules
    const body: { tierOverride?: string | null; commissionBpsOverride?: number | null; payoutsOnHold?: boolean; holdReason?: string | null } = {}
    if (tier !== undefined && (tier || null) !== stored.tierOverride) body.tierOverride = tier || null
    if (commission !== undefined) {
      const bps = commission.trim() === "" ? null : Number(commission)
      if (bps !== null && (!Number.isInteger(bps) || bps < 0 || bps > 5000)) { setError({ message: "Commission override must be a whole number from 0 to 5000 basis points.", conflict: false }); return }
      if (bps !== stored.commissionBpsOverride) body.commissionBpsOverride = bps
    }
    const onHold = hold ?? rules.onHold
    const reason = (holdReason ?? rules.holdReason ?? "").trim()
    if (onHold && !reason) { setError({ message: "Give a reason for holding payouts.", conflict: false }); return }
    if (onHold !== rules.onHold || (onHold && reason !== (rules.holdReason ?? ""))) { body.payoutsOnHold = onHold; body.holdReason = onHold ? reason : null }
    if (!Object.keys(body).length) { setError(null); toast.info("Nothing to save", { description: "No setting differs from what's stored." }); return }
    setBusy(true); setError(null)
    try {
      if (!(await reauth.verify())) return
      await api(`/api/admin/finance/brands/${brandId}`, { method: "PUT", body })
      await settings.revalidate(); resetForm()
      toast.success("Brand finance settings saved")
    } catch (cause) {
      if (!reauth.catches(cause)) setError(actionError(cause, "Brand finance settings couldn't be saved."))
    } finally { setBusy(false) }
  }
  const data = settings.data
  const tierValue = tier ?? data?.overrides.tierOverride ?? ""
  const commissionValue = commission ?? (data?.overrides.commissionBpsOverride == null ? "" : String(data.overrides.commissionBpsOverride))
  return <div className="grid gap-3">
    <Panel title="Find a brand" description="Load balances and finance settings using the server brand ID." className="rounded-[20px]"><form className="flex flex-wrap items-end gap-3" onSubmit={load}><div className="grid min-w-0 flex-1 gap-1.5 sm:max-w-md"><Label htmlFor="finance-brand-id">Brand ID</Label><Input id="finance-brand-id" value={brandInput} onChange={(event) => setBrandInput(event.target.value)} maxLength={64} required /></div><Button type="submit">Load brand</Button></form>{settings.error ? <div className="mt-3"><PanelError message={errorMessage(settings.error, "Couldn't load brand finance settings.")} onRetry={() => void settings.revalidate()} /></div> : null}{brandId && settings.isLoading && !data ? <div className="skeleton mt-3 h-24 rounded-md" aria-label="Loading brand" /> : null}</Panel>
    {data ? <>
      <Panel title={data.brand.name} description={`${data.brand.id} · ${data.brand.currency} · ${data.rules.tier} tier · ${data.rules.reserveBps / 100}% reserve · ${data.rules.commissionBps} bps commission`} className="rounded-[20px]"><div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{data.balances.map((balance) => <p key={balance.currency} className="text-[11px] text-ink-3">{balance.currency} available<span className="mt-1 block text-sm tabular text-ink">{money(balance.availableMinor, balance.currency)}</span></p>)}<p className="text-[11px] text-ink-3">Payout account<span className="mt-1 block text-sm text-ink">{data.account ? `${data.account.bankName} •••• ${data.account.accountLast4}` : "Not set"}</span></p></div></Panel>
      <Panel title="Finance settings" description="Only the settings you change are saved. Commission override changes require recent authenticator verification. A payout hold requires a reason." className="rounded-[20px]"><form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => void save(event)}>
        <div className="grid min-w-0 gap-1.5"><Label htmlFor="finance-tier">Tier override</Label><select id="finance-tier" className="h-10 rounded-md border border-white/10 bg-obsidian px-3 text-sm text-ink" value={tierValue} onChange={(event) => setTier(event.target.value)}><option value="">No override (computed tier)</option><option value="new">New</option><option value="standard">Standard</option><option value="trusted">Trusted</option></select><p className="text-xs text-ink-3">{data.overrides.tierOverride ? `Stored override: ${data.overrides.tierOverride}.` : "No tier override stored."}{tierValue ? <> <button type="button" className="text-ink-2 underline underline-offset-2 hover:text-ink" onClick={() => setTier("")}>Clear override</button></> : null}</p></div>
        <div className="grid min-w-0 gap-1.5"><Label htmlFor="finance-commission">Commission override (basis points)</Label><Input id="finance-commission" inputMode="numeric" value={commissionValue} onChange={(event) => setCommission(event.target.value)} placeholder={`No override · ${data.rules.commissionBps} effective`} /><p className="text-xs text-ink-3">{data.overrides.commissionBpsOverride != null ? `Stored override: ${data.overrides.commissionBpsOverride} bps.` : "No commission override stored; the platform default applies."}{commissionValue ? <> <button type="button" className="text-ink-2 underline underline-offset-2 hover:text-ink" onClick={() => setCommission("")}>Clear override</button></> : null}</p></div>
        <label className="flex min-h-10 items-center gap-2 text-sm text-ink sm:col-span-2"><input type="checkbox" checked={hold ?? data.rules.onHold} onChange={(event) => setHold(event.target.checked)} />Place payouts on hold</label>
        {(hold ?? data.rules.onHold) ? <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="finance-hold-reason">Hold reason</Label><Textarea id="finance-hold-reason" value={holdReason ?? data.rules.holdReason ?? ""} onChange={(event) => setHoldReason(event.target.value)} maxLength={300} required rows={2} /></div> : null}
        <ReauthCodeField reauth={reauth} id="finance-auth-code" className="sm:col-span-2 sm:max-w-xs" />
        <ActionErrorNote error={error} onReload={() => void reload()} className="sm:col-span-2" /><div className="sm:col-span-2"><Button type="submit" loading={busy} disabled={busy || reauth.waiting}>{reauth.required ? "Verify and save" : "Save settings"}</Button></div>
      </form></Panel>
    </> : null}
  </div>
}

function Reconciliation() {
  const runs = useApi<{ runs: Run[] }>("admin.finance.reconciliation", () => api("/api/admin/finance/reconciliation"), { keepPrevious: false })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const detail = useApi<ReconciliationDetail>(selectedId ? `admin.finance.reconciliation:${selectedId}` : null, () => api(`/api/admin/finance/reconciliation/${selectedId}`), { keepPrevious: false })
  const [resolveId, setResolveId] = useState<string | null>(null)
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ActionError | null>(null)
  const columns: Column<Run>[] = [
    { key: "started", header: "Started", sortValue: (run) => run.startedAt, cell: (run) => time.format(new Date(run.startedAt)) },
    { key: "status", header: "Status", cell: (run) => <StatusBadge tone={tones[run.status] ?? "muted"}>{run.status}</StatusBadge> },
    { key: "checked", header: "Checked", align: "right", sortValue: (run) => run.checked, cell: (run) => formatNumber(run.checked) },
    { key: "mismatches", header: "Mismatches", align: "right", sortValue: (run) => run.mismatches, cell: (run) => formatNumber(run.mismatches) },
    { key: "provider", header: "Provider", hideBelow: "md", cell: (run) => run.providerCompared ? "Compared" : "Internal checks only" },
    { key: "details", header: "Details", cell: (run) => <Button type="button" size="xs" variant="secondary" onClick={() => { setSelectedId(run.id); void detail.revalidate() }}>Inspect</Button> },
  ]
  async function runNow() {
    if (busy) return
    setBusy(true); setError(null)
    try {
      const result = await api<{ runId: string; checked: number; mismatches: number; providerCompared: boolean }>("/api/admin/finance/reconciliation", { method: "POST" })
      await runs.revalidate(); setSelectedId(result.runId)
      toast.success("Reconciliation complete", { description: `${result.checked} checks · ${result.mismatches} mismatches · ${result.providerCompared ? "provider compared" : "internal checks only"}` })
    } catch (cause) { setError(actionError(cause, "Reconciliation couldn't run.")) } finally { setBusy(false) }
  }
  async function resolve(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!resolveId || busy) return
    setBusy(true); setError(null)
    try {
      await api(`/api/admin/finance/reconciliation/items/${resolveId}/resolve`, { method: "POST", body: { note: note.trim() } })
      await detail.revalidate(); setResolveId(null); setNote("")
      toast.success("Reconciliation item resolved")
    } catch (cause) { setError(actionError(cause, "The item couldn't be resolved.")); if (cause instanceof ApiError && cause.status === 409) void detail.revalidate() } finally { setBusy(false) }
  }
  return <div className="grid gap-3">
    <Panel title="Run reconciliation" description="Checks ledger balances and payout state; compares provider events when available." action={<Button type="button" size="sm" loading={busy && !resolveId} disabled={busy} onClick={() => void runNow()}>Run now</Button>} className="rounded-[20px]">{!resolveId ? <ActionErrorNote error={error} onReload={() => { setError(null); void runs.revalidate() }} /> : null}</Panel>
    {selectedId ? <Panel title="Reconciliation details" description={detail.data ? `${detail.data.run.checked} checks · ${detail.data.run.mismatches} mismatches` : detail.isLoading ? "Loading run…" : undefined} className="rounded-[20px]">{detail.error ? <PanelError message={errorMessage(detail.error, "Couldn't load this run.")} onRetry={() => void detail.revalidate()} /> : null}
      {detail.data?.items.length ? <ul className="grid gap-3">{detail.data.items.map((item) => <li key={item.id} className="admin-inset grid min-w-0 gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><StatusBadge tone={item.status === "resolved" ? "success" : "danger"}>{item.status}</StatusBadge><span className="text-sm font-medium capitalize text-ink">{item.kind.replaceAll("_", " ")}</span></div><p className="mt-1 break-all text-xs text-ink-3">{item.ref}{item.currency ? ` · ${item.currency}` : ""}</p><p className="mt-1 text-xs text-ink-2">Ledger {item.ledgerMinor === null ? "—" : money(item.ledgerMinor, item.currency ?? "USD")} · Provider {item.providerMinor === null ? "—" : money(item.providerMinor, item.currency ?? "USD")}</p>{item.resolutionNote ? <p className="mt-1 text-xs text-ink-3">Resolution: {item.resolutionNote}</p> : null}</div>{item.status === "open" ? <Button type="button" size="sm" variant="secondary" onClick={() => { setResolveId(item.id); setError(null) }}>Resolve</Button> : null}</li>)}</ul> : detail.data ? <p className="text-sm text-ink-3">No mismatch items in this run.</p> : null}
      {resolveId ? <form className="mt-3 grid gap-2" onSubmit={(event) => void resolve(event)}><Label htmlFor="resolution-note">Resolution note</Label><Textarea id="resolution-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} minLength={3} required rows={2} /><ActionErrorNote error={error} onReload={() => { setError(null); setResolveId(null); void detail.revalidate() }} /><div className="flex gap-2"><Button type="submit" loading={busy} disabled={busy || note.trim().length < 3}>Record resolution</Button><Button type="button" variant="ghost" disabled={busy} onClick={() => setResolveId(null)}>Cancel</Button></div></form> : null}
    </Panel> : null}
    <Panel title="Recent runs" description="Run history and provider comparison status." className="rounded-[20px]" bodyClassName="px-3 sm:px-4 md:px-5">{runs.error ? <PanelError message={errorMessage(runs.error, "Couldn't load reconciliation runs.")} onRetry={() => void runs.revalidate()} /> : null}<DataTable label="Reconciliation runs" rows={runs.data?.runs ?? []} columns={columns} getId={(run) => run.id} loading={runs.isLoading} search={{ placeholder: "Search reconciliation runs", text: (run) => `${run.id} ${run.status} ${run.triggeredBy}` }} empty={{ title: "No reconciliation runs", body: "Run the checks to verify ledger consistency." }} initialSort={{ key: "started", dir: "desc" }} pageSizes={[10, 25]} minWidth={360} /></Panel>
  </div>
}