"use client"

import { useId, useState } from "react"
import { CalendarPlusIcon, CaretDownIcon, ChatTextIcon, CheckIcon, EyeIcon, GavelIcon, PackageIcon, TrashIcon, TruckIcon, WarningIcon } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DataTable, type Column, type RowAction } from "@/components/dashboard/data-table"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { StatCard } from "@/components/dashboard/insight/stat-card"
import { Reveal, RevealItem } from "@/components/admin/ui/motion"
import { Panel } from "@/components/admin/ui/panel"
import { Segmented, segmentedTabId } from "@/components/admin/ui/segmented"
import { DetailSection, DetailSheet, EmptyLine, Facts } from "@/components/admin/marketplace/detail-sheet"
import { countryName, formatDate, relDays } from "@/components/admin/marketplace/format"
import { AdminPageHead, PanelRail, StatRow } from "@/components/admin/marketplace/page-head"
import { InPageLinks, useSearchParam, writeParams } from "@/components/admin/marketplace/url-state"
import { useLast } from "@/components/admin/marketplace/use-last"
import { useNow } from "@/hooks/use-now"
import { adminKeys, listDelivery } from "@/lib/api/admin"
import { complaintKindLabels, DELIVERY_TABS, type DeliveryIssueDto, type DeliveryListDto, type DeliveryTab, type HolidayDto } from "@/lib/api/contracts/admin"
import { useApi } from "@/lib/api/use-api"
import { cn } from "@/lib/utils"
import { formatNumber } from "@/lib/money"
import { useRealtimeEvent } from "@/lib/realtime/use-realtime"
import { LoadError, NotInQueue, RelatedLinks, ServerActivity, TrustActionBar, TrustGate, sheetTrack, useAdminSession, useQueueFigures, useServerDecision, type TrustAction } from "./shared"

/*
 * Admin › Delivery (§6.5, §8.1): orders past their estimate, delivery complaints, carrier
 * exceptions and the holiday calendar the estimates read. Estimates are always estimates.
 */

const TABS: Record<DeliveryTab, { label: string; empty: string; emptyBody: string }> = {
  late: { label: "Late", empty: "No late orders to measure", emptyBody: "Orders still unshipped after their promised ship-by date, or past their promised arrival, show here." },
  complaints: { label: "Complaints", empty: "No open complaints", emptyBody: "Delivery problems shoppers report on their orders land here." },
  exceptions: { label: "Exceptions", empty: "No carrier exceptions", emptyBody: "Shipments a carrier or brand marked as an exception or returned show here." },
  resolved: { label: "Resolved", empty: "Nothing resolved yet", emptyBody: "Complaints you resolve are kept here." },
  holidays: { label: "Holidays", empty: "No holidays", emptyBody: "Public holidays and carrier closures the estimates skip." },
}
const isTab = (v: string | null): v is DeliveryTab => !!v && (DELIVERY_TABS as readonly string[]).includes(v)
const n = (v: number) => formatNumber(Math.round(v))
type Tone = "attention" | "info" | "muted" | "danger" | "success" | "neutral"
const statusMeta: Record<string, { label: string; tone: Tone }> = {
  late: { label: "Late", tone: "attention" },
  exception: { label: "Exception", tone: "danger" },
  open: { label: "Open", tone: "attention" },
  waiting_brand: { label: "Waiting for the brand", tone: "info" },
  brand_responded: { label: "Brand responded", tone: "info" },
  escalated: { label: "Escalated", tone: "danger" },
  resolved: { label: "Resolved", tone: "success" },
}
/** A date range in as few words as it needs: "17 to 25 Nov 2026", "28 Nov to 3 Dec 2026", or the full dates across years. */
function range(r: { from: string | null; to: string | null } | null, none = "No estimate") {
  if (!r?.from || !r.to) return none
  if (r.from === r.to) return formatDate(r.from)
  const [fy, fm] = r.from.split("-")
  const [ty, tm] = r.to.split("-")
  const from = formatDate(r.from).split(" ")
  if (fy !== ty || from.length !== 3) return `${formatDate(r.from)} to ${formatDate(r.to)}`
  return fm === tm ? `${from[0]} to ${formatDate(r.to)}` : `${from[0]} ${from[1]} to ${formatDate(r.to)}`
}
/** Days late against the promise, or why it can't be counted: with no promise or ship-by on record, it's "Not recorded". */
const lateWords = (i: Pick<DeliveryIssueDto, "daysLate" | "measurable">) =>
  !i.measurable || i.daysLate == null ? "Not recorded" : i.daysLate ? `${i.daysLate} ${i.daysLate === 1 ? "day" : "days"}` : "On time"
/** Why an order is in the queue, only from what's on record. */
function whyHere(i: DeliveryIssueDto) {
  if (i.kind === "exception") return "The latest shipment update is an exception or a return."
  if (!i.measurable) return "Its estimate was recomputed as late; the original promise isn't on record (sample order)."
  if (i.shipment && i.shipment !== "label_created") return "Shipped, but past the end of its promised arrival."
  return "Still not shipped after its promised ship-by date."
}

export function DeliveryView() {
  return (
    <Reveal ssrVisible className="@container grid gap-3">
      <AdminPageHead
        title="Delivery"
        description="Orders past their delivery estimate, complaints from shoppers, carrier exceptions and the holiday calendar."
        note="Order history is sample data anchored to 5 Nov 2026. Every date here is an estimate from the brand's settings; no carrier is connected in this build. Sample orders estimated after they were already late have no promise on record, so their days late aren't counted."
      />
      <TrustGate feature="Delivery" anyOf={["shipping.view"]}>
        <DeliveryQueues />
      </TrustGate>
    </Reveal>
  )
}

function DeliveryQueues() {
  const qid = useId()
  const linked = useSearchParam("tab")
  // Notifications link to ?order= (a late order) and ?complaint= (a complaint).
  const orderLink = useSearchParam("order")
  const complaintLink = useSearchParam("complaint")
  const tab: DeliveryTab = isTab(linked) ? linked : complaintLink ? "complaints" : "late"
  const caseId = useSearchParam("case") ?? complaintLink ?? orderLink
  const [country, setCountry] = useState<string | undefined>(undefined)
  const q = useApi(adminKeys.delivery(tab, tab === "holidays" ? country : undefined), () => listDelivery(tab, tab === "holidays" ? country : undefined), { refreshInterval: 60_000 })
  useRealtimeEvent("moderation.counts", () => void q.revalidate())
  const { ask, dialog } = useServerDecision(() => document.getElementById(segmentedTabId(qid, tab)))
  // Counts come with each tab's response: the last ones stay while another tab loads.
  const figures = useQueueFigures(q.data?.counts, q.error)
  const counts = figures.counts
  const ready = figures.ready
  const data = q.data?.tab === tab ? q.data : undefined

  return (
    <div className="grid gap-3">
      <InPageLinks>
        <StatRow label="Delivery figures">
          <RevealItem className="min-w-0">
            <StatCard surface="admin" variant={ready && counts?.late ? "brand" : "default"} icon={TruckIcon} label="Late orders" value={counts?.late ?? 0} format={figures.format(n)} hint={figures.hint("Against a recorded promise")} href="/admin/delivery#delivery-queue" hrefLabel="Show late orders" ready={ready} className="h-full" />
          </RevealItem>
          <RevealItem className="min-w-0">
            <StatCard surface="admin" variant={ready && counts?.complaints ? "brand" : "default"} icon={ChatTextIcon} label="Open complaints" value={counts?.complaints ?? 0} format={figures.format(n)} hint={figures.hint("From shoppers")} href="/admin/delivery?tab=complaints#delivery-queue" hrefLabel="Show complaints" ready={ready} className="h-full" />
          </RevealItem>
          <RevealItem className="min-w-0">
            <StatCard surface="admin" icon={WarningIcon} label="Exceptions" value={counts?.exceptions ?? 0} format={figures.format(n)} hint={figures.hint("Carrier or brand")} href="/admin/delivery?tab=exceptions#delivery-queue" hrefLabel="Show exceptions" ready={ready} className="h-full" />
          </RevealItem>
          <RevealItem className="min-w-0">
            <StatCard surface="admin" icon={CheckIcon} label="Resolved" value={counts?.resolved ?? 0} format={figures.format(n)} hint={figures.hint("Complaints closed")} href="/admin/delivery?tab=resolved#delivery-queue" hrefLabel="Show resolved complaints" ready={ready} className="h-full" />
          </RevealItem>
        </StatRow>
      </InPageLinks>

      <Panel id="delivery-queue" title="Delivery queue" description="Open an order for the promise, the current estimate and its history. Every decision asks for a reason." className="scroll-mt-24 rounded-[20px]" bodyClassName="px-0 pb-0 md:px-0 md:pb-0">
        <PanelRail value={tab}>
          <Segmented
            label="Delivery queue"
            size="sm"
            value={tab}
            onChange={(t) => writeParams({ tab: t === "late" ? null : t, case: null, order: null, complaint: null })}
            loading={!counts}
            idBase={qid}
            panelId={`${qid}-panel`}
            options={DELIVERY_TABS.map((t) => ({ value: t, label: TABS[t].label, count: t === "late" || t === "complaints" || t === "exceptions" ? counts?.[t] : undefined }))}
          />
        </PanelRail>
        <div id={`${qid}-panel`} role="tabpanel" aria-labelledby={segmentedTabId(qid, tab)} className="border-t border-[var(--admin-hairline)] p-3 sm:p-4 md:p-5">
          {q.error && !q.data ? (
            <LoadError error={q.error} onRetry={() => void q.revalidate()} what={TABS[tab].label.toLowerCase()} />
          ) : tab === "holidays" ? (
            <Holidays data={data} country={country} setCountry={setCountry} ask={ask} />
          ) : (
            <Issues tab={tab} items={data?.items} unmeasured={data?.unmeasured} ask={ask} caseId={caseId} />
          )}
        </div>
      </Panel>
      {dialog}
    </div>
  )
}

type Ask = ReturnType<typeof useServerDecision>["ask"]

function issueDecisions(ask: Ask) {
  return {
    contact: (i: DeliveryIssueDto) =>
      ask({
        action: "contact-brand-about-delivery",
        body: { id: i.id },
        title: `Contact ${i.brand.name} about order ${i.reference}?`,
        description: `${i.brand.name} gets a notification in Studio naming the order and the problem, written by Yard (no free text). Your reason stays in the audit log.`,
        fieldLabel: "Reason, for the audit log",
        confirmLabel: "Contact brand",
        done: "Brand contacted",
      }),
    resolve: (i: DeliveryIssueDto) =>
      ask({
        action: "resolve-delivery-issue",
        // The resolution is what the admin types: filled from the reason field when it's sent.
        body: { id: i.id, resolution: "" },
        withReason: (reason) => ({ resolution: reason }),
        title: `Mark the complaint on ${i.reference} resolved?`,
        description: `${i.customer.name} and ${i.brand.name} are notified that it's resolved. What you write is the resolution on the order and is recorded in the audit log.`,
        fieldLabel: `Resolution, seen with the order by ${i.customer.name} and ${i.brand.name}`,
        confirmLabel: "Mark resolved",
        presets: ["Brand confirmed delivery with tracking", "Brand reshipped the order", "Shopper confirmed it arrived"],
        done: "Complaint resolved",
      }),
    escalate: (i: DeliveryIssueDto) =>
      ask({
        action: "escalate-delivery-issue",
        body: { id: i.id },
        title: `Escalate the complaint on ${i.reference}?`,
        description: "It moves to the escalated list for a senior decision. Nobody outside the Control Center is told; your reason stays in the audit log.",
        fieldLabel: "Reason, for the audit log",
        confirmLabel: "Escalate",
        done: "Complaint escalated",
      }),
  }
}

function Issues({ tab, items, unmeasured, ask, caseId }: { tab: DeliveryTab; items?: DeliveryIssueDto[]; unmeasured?: DeliveryIssueDto[]; ask: Ask; caseId: string | null }) {
  const [showUnmeasured, setShowUnmeasured] = useState(false)
  const now = useNow(60_000)
  const { reason } = useAdminSession()
  const d = issueDecisions(ask)
  const resolveR = reason("shipping.resolve")
  const viewR = reason("shipping.view")
  const open = (i: DeliveryIssueDto) => writeParams({ case: i.id, order: null, complaint: null })
  const isComplaint = (i: DeliveryIssueDto) => i.kind === "complaint"
  const columns: Column<DeliveryIssueDto>[] = [
    {
      key: "order",
      header: "Order",
      sortValue: (i) => i.reference,
      cell: (i) => (
        <button type="button" onClick={() => open(i)} className="group block min-h-10 max-w-full min-w-0 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-violet">
          <span className="flex items-center gap-1.5">
            <span className="block truncate font-medium text-ink tabular group-hover:text-violet">{i.reference}</span>
          </span>
          <span className="block max-w-[44vw] truncate text-[11.5px] text-ink-3 sm:max-w-[220px]">
            {i.brand.name}, to {i.city ? `${i.city}, ` : ""}
            {countryName(i.country)}
          </span>
        </button>
      ),
    },
    { key: "customer", header: "Customer", hideBelow: "lg", cell: (i) => <span className="whitespace-nowrap text-ink-2">{i.customer.name}</span> },
    { key: "promised", header: "Promised", hideBelow: "md", cell: (i) => <span className={cn("whitespace-nowrap", i.promised ? "text-ink-2" : "text-ink-3")}>{range(i.promised, "Not recorded")}</span> },
    { key: "current", header: "Current estimate", hideBelow: "xl", cell: (i) => <span className="whitespace-nowrap text-ink-2">{range(i.current)}</span> },
    { key: "late", header: "Days late", align: "right", hideBelow: "sm", sortValue: (i) => i.daysLate ?? -1, cell: (i) => <span className={i.daysLate ? "font-medium text-ink tabular" : "text-[12.5px] text-ink-3"}>{i.daysLate ? i.daysLate : lateWords(i)}</span> },
    { key: "kind", header: tab === "late" ? "Status" : "Complaint", hideBelow: "md", cell: (i) => (i.complaintKind ? <StatusBadge tone="attention">{complaintKindLabels[i.complaintKind]}</StatusBadge> : <StatusBadge tone={statusMeta[i.status]?.tone ?? "neutral"}>{statusMeta[i.status]?.label ?? i.status}</StatusBadge>) },
    ...(tab === "complaints" || tab === "resolved" ? [{ key: "status", header: "Status", hideBelow: "lg" as const, cell: (i: DeliveryIssueDto) => <StatusBadge tone={statusMeta[i.status]?.tone ?? "neutral"}>{statusMeta[i.status]?.label ?? i.status}</StatusBadge> }] : []),
  ]
  const rowActions: RowAction<DeliveryIssueDto>[] = [
    { label: "Open", icon: EyeIcon, onSelect: open },
    { label: "Contact brand", icon: ChatTextIcon, separatorBefore: true, hidden: (i) => i.status === "resolved", disabled: () => !!resolveR, disabledReason: () => resolveR, onSelect: (i) => void d.contact(i) },
    { label: "Mark resolved", icon: CheckIcon, hidden: (i) => !isComplaint(i) || i.status === "resolved", disabled: () => !!resolveR, disabledReason: () => resolveR, onSelect: (i) => void d.resolve(i) },
    { label: "Escalate", icon: GavelIcon, hidden: (i) => !isComplaint(i) || i.status === "resolved" || i.status === "escalated", disabled: () => !!viewR, disabledReason: () => viewR, onSelect: (i) => void d.escalate(i) },
  ]
  const shown = items?.find((i) => i.id === caseId || i.orderId === caseId) ?? unmeasured?.find((i) => i.id === caseId || i.orderId === caseId)
  const missing = !!caseId && !!items && !shown
  const rest = unmeasured ?? []
  return (
    <>
      <DataTable
        key={tab}
        label={TABS[tab].label}
        rows={items ?? []}
        columns={columns}
        getId={(i) => i.id}
        loading={!items}
        search={{ placeholder: "Search reference, brand or customer", text: (i) => `${i.reference} ${i.brand.name} ${i.customer.name} ${i.city ?? ""}` }}
        rowActions={rowActions}
        empty={{ title: TABS[tab].empty, body: rest.length ? `${TABS[tab].emptyBody} Orders with no promise on record are listed below and aren't counted.` : TABS[tab].emptyBody }}
        initialPageSize={25}
        minWidth={300}
      />
      {tab === "late" && rest.length ? (
        <section aria-label="No promise on record" className="mt-4 grid gap-3">
          <button
            type="button"
            aria-expanded={showUnmeasured}
            onClick={() => setShowUnmeasured((v) => !v)}
            className="admin-inset flex min-h-11 w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-violet"
          >
            <span className="min-w-0">
              <span className="block text-[13px] text-ink">No promise on record (sample), {n(rest.length)}</span>
              <span className="block text-[11.5px] text-ink-3">Estimated only after they were already late, so days late can&apos;t be measured. Not counted as queue work.</span>
            </span>
            <CaretDownIcon aria-hidden className={cn("size-4 shrink-0 text-ink-3 transition-transform motion-reduce:transition-none", showUnmeasured && "rotate-180")} />
          </button>
          {showUnmeasured ? (
            <DataTable
              label="Late orders with no promise on record"
              rows={rest}
              columns={columns}
              getId={(i) => i.id}
              search={{ placeholder: "Search reference, brand or customer", text: (i) => `${i.reference} ${i.brand.name} ${i.customer.name} ${i.city ?? ""}` }}
              rowActions={rowActions}
              empty={{ title: "None", body: "Every late order has a promise on record." }}
              initialPageSize={10}
              minWidth={300}
            />
          ) : null}
        </section>
      ) : null}
      {missing ? (
        <DetailSheet open onOpenChange={(o) => !o && writeParams({ case: null, order: null, complaint: null })} title="Order not found">
          <NotInQueue what="order" href={`/admin/delivery${tab === "late" ? "" : `?tab=${tab}`}`} queue={`the ${TABS[tab].label.toLowerCase()} list`} />
        </DetailSheet>
      ) : null}
      <IssueSheet issue={shown} open={!!shown} d={d} resolveR={resolveR} viewR={viewR} now={now} onOpenChange={(o) => !o && writeParams({ case: null, order: null, complaint: null })} />
    </>
  )
}

function IssueSheet({ issue, open, d, resolveR, viewR, now, onOpenChange }: { issue?: DeliveryIssueDto; open: boolean; d: ReturnType<typeof issueDecisions>; resolveR?: string; viewR?: string; now: number | null; onOpenChange: (o: boolean) => void }) {
  const last = useLast(issue)
  const i = issue ?? last
  if (!i) return null
  const actions: TrustAction[] = []
  if (i.status !== "resolved") actions.push({ key: "contact", label: "Contact brand", icon: ChatTextIcon, variant: "secondary", onSelect: () => void d.contact(i), disabledReason: resolveR })
  if (i.kind === "complaint" && i.status !== "resolved" && i.status !== "escalated") actions.push({ key: "escalate", label: "Escalate", icon: GavelIcon, variant: "secondary", onSelect: () => void d.escalate(i), disabledReason: viewR })
  if (i.kind === "complaint" && i.status !== "resolved") actions.push({ key: "resolve", label: "Mark resolved", icon: CheckIcon, variant: "primary", onSelect: () => void d.resolve(i), disabledReason: resolveR })
  const st = statusMeta[i.status]
  return (
    <DetailSheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Order ${i.reference}`}
      description={`${i.brand.name} to ${i.customer.name}`}
      lead={<span aria-hidden className="inline-flex size-11 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-ink-2"><PackageIcon className="size-5" /></span>}
      badges={
        <>
          {i.complaintKind ? <StatusBadge tone="attention">{complaintKindLabels[i.complaintKind]}</StatusBadge> : null}
          <StatusBadge tone={st?.tone ?? "neutral"}>{st?.label ?? i.status}</StatusBadge>
          {i.daysLate ? <StatusBadge tone="attention">{i.daysLate} {i.daysLate === 1 ? "day" : "days"} late</StatusBadge> : !i.measurable ? <StatusBadge tone="muted">No promise on record</StatusBadge> : null}
        </>
      }
      actions={actions.length ? <TrustActionBar note="Every decision needs a reason and is recorded in the audit log." actions={actions} /> : undefined}
    >
      <Facts
        items={[
          { label: "Ship to", value: `${i.city ? `${i.city}, ` : ""}${countryName(i.country)}` },
          { label: "Shipment", value: i.shipment ? i.shipment.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "Not shipped yet" },
          { label: "Promised ship-by", value: i.shipBy ? formatDate(i.shipBy) : "Not recorded" },
          { label: "Promised arrival", value: range(i.promised, "Not recorded") },
          { label: "Current estimate", value: range(i.current) },
          { label: i.kind === "complaint" ? "Complaint" : "Placed", value: relDays(i.createdAt, now) },
        ]}
      />
      {i.kind === "complaint" ? (
        <DetailSection title="Evidence" className={sheetTrack}>
          <blockquote className="grid gap-1.5 rounded-[10px] border-l-2 border-violet/60 bg-white/[0.02] px-3 py-2.5 text-[13px] text-ink-2">
            <p>
              <span className="text-ink-3">{i.customer.name}: </span>
              {i.details || `${complaintKindLabels[i.complaintKind!]}, no details given.`}
            </p>
            {i.brandResponse ? (
              <p>
                <span className="text-ink-3">{i.brand.name}: </span>
                {i.brandResponse}
              </p>
            ) : (
              <p className="text-ink-3">{i.brand.name} hasn&apos;t responded yet.</p>
            )}
            {i.resolution ? (
              <p>
                <span className="text-ink-3">Resolution: </span>
                {i.resolution}
              </p>
            ) : null}
          </blockquote>
        </DetailSection>
      ) : (
        <DetailSection title="Why it's here">
          <EmptyLine>{whyHere(i)}</EmptyLine>
        </DetailSection>
      )}
      <RelatedLinks links={[{ href: `/admin/orders?order=${encodeURIComponent(i.orderId)}`, label: `Order ${i.reference} in Orders`, hint: "Items and timeline (sample)" }]} />
      <DetailSection title="Activity" className={sheetTrack}>
        <ServerActivity subjectIds={[i.id, i.orderId]} extra={[{ at: i.createdAt, label: i.kind === "complaint" ? "Complaint received" : "Order placed" }]} />
      </DetailSection>
    </DetailSheet>
  )
}

/* ── Holidays ──────────────────────────────────────────────────────── */

function Holidays({ data, country, setCountry, ask }: { data?: DeliveryListDto; country?: string; setCountry: (c?: string) => void; ask: Ask }) {
  const { reason } = useAdminSession()
  const r = reason("holidays.edit")
  const [form, setForm] = useState({ country: country ?? "NG", date: "", name: "", estimated: false })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const countries = data?.countries ?? []
  const add = () => {
    const e: Record<string, string> = {}
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) e.date = "Choose a date."
    if (form.name.trim().length < 2) e.name = "Name the holiday."
    setErrors(e)
    if (Object.keys(e).length) return
    void ask({
      action: "add-holiday",
      body: { id: form.country, date: form.date, name: form.name.trim(), kind: "public", estimated: form.estimated },
      title: `Add ${form.name.trim()} to ${countryName(form.country)}'s calendar?`,
      description: `Delivery estimates for ${countryName(form.country)} skip ${formatDate(form.date)} from their next calculation${form.estimated ? ", and Studio shows it as estimated" : ""}. Your reason stays in the audit log.`,
      fieldLabel: "Reason, for the audit log",
      confirmLabel: "Add holiday",
      done: "Holiday added",
      onDone: () => setForm((f) => ({ ...f, date: "", name: "", estimated: false })),
    })
  }
  const columns: Column<HolidayDto>[] = [
    { key: "date", header: "Date", sortValue: (h) => h.date, cell: (h) => <span className="whitespace-nowrap text-ink tabular">{formatDate(h.date)}</span> },
    { key: "name", header: "Holiday", cell: (h) => <span className="flex flex-wrap items-center gap-1.5 text-ink-2">{h.name}{h.estimated ? <SampleLike label="Estimated" /> : null}{h.kind === "carrier" ? <SampleLike label="Carrier closure" /> : null}</span> },
    { key: "country", header: "Country", hideBelow: "sm", cell: (h) => <span className="whitespace-nowrap text-ink-2">{countryName(h.country)}</span> },
    { key: "source", header: "Source", hideBelow: "md", cell: (h) => <span className="text-ink-3">{h.source === "admin" ? "Added by an admin" : "Yard's calendar"}</span> },
  ]
  const rowActions: RowAction<HolidayDto>[] = [
    {
      label: "Remove holiday",
      icon: TrashIcon,
      destructive: true,
      disabled: () => !!r,
      disabledReason: () => r,
      onSelect: (h) =>
        void ask({
          action: "remove-holiday",
          body: { id: h.id },
          title: `Remove ${h.name} (${formatDate(h.date)})?`,
          description: `Delivery estimates for ${countryName(h.country)} count it as a working day from their next calculation. Your reason stays in the audit log.`,
          fieldLabel: "Reason, for the audit log",
          confirmLabel: "Remove holiday",
          destructive: true,
          done: "Holiday removed",
        }),
    },
  ]
  return (
    <div className="grid gap-4">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
        className="admin-inset grid gap-3 p-3.5 @3xl:grid-cols-[160px_160px_1fr_auto] @3xl:items-end"
        aria-label="Add a holiday"
      >
        <div className="grid gap-1.5">
          <Label htmlFor="hol-country">Country</Label>
          <Select value={form.country} onValueChange={(v) => setForm((f) => ({ ...f, country: v }))} disabled={!!r}>
            <SelectTrigger id="hol-country" className="h-10 w-full data-[size=default]:h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(countries.length ? countries : ["NG"]).map((c) => (
                <SelectItem key={c} value={c}>
                  {countryName(c)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="hol-date">Date</Label>
          <Input id="hol-date" type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} aria-invalid={!!errors.date} disabled={!!r} className="h-10" />
          {errors.date ? <p className="text-xs text-danger">{errors.date}</p> : null}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="hol-name">Name</Label>
          <Input id="hol-name" value={form.name} maxLength={80} placeholder="Eid al-Fitr" onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} aria-invalid={!!errors.name} disabled={!!r} className="h-10" />
          {errors.name ? <p className="text-xs text-danger">{errors.name}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex min-h-10 items-center gap-2 text-[12.5px] text-ink-2">
            <Checkbox checked={form.estimated} onCheckedChange={(v) => setForm((f) => ({ ...f, estimated: v === true }))} disabled={!!r} />
            Estimated date
          </label>
          <Button type="submit" size="sm" variant="secondary" className="h-10" disabled={!!r}>
            <CalendarPlusIcon aria-hidden /> Add holiday
          </Button>
        </div>
        {r ? <p className="text-[11.5px] text-ink-3 @3xl:col-span-4">{r}.</p> : null}
      </form>
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor="hol-filter" className="text-[12px] text-ink-3">
          Show
        </Label>
        <Select value={country ?? "all"} onValueChange={(v) => setCountry(v === "all" ? undefined : v)}>
          <SelectTrigger id="hol-filter" className="h-10 w-[200px] data-[size=default]:h-10 sm:data-[size=default]:h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Every country</SelectItem>
            {countries.map((c) => (
              <SelectItem key={c} value={c}>
                {countryName(c)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[11.5px] text-ink-3">Check every date against the official calendar before launch; lunar dates are estimated.</p>
      </div>
      <DataTable label="Holidays" rows={data?.holidays ?? []} columns={columns} getId={(h) => h.id} loading={!data} rowActions={rowActions} search={{ placeholder: "Search holidays", text: (h) => `${h.name} ${countryName(h.country)} ${h.date}` }} empty={{ title: TABS.holidays.empty, body: TABS.holidays.emptyBody }} initialPageSize={25} minWidth={300} />
    </div>
  )
}

function SampleLike({ label }: { label: string }) {
  return <span className="inline-flex h-5 items-center rounded-full border border-white/10 px-1.5 text-[10.5px] text-ink-3">{label}</span>
}


