"use client"

import { useRef, useState } from "react"
import { CopyIcon as Copy, PauseIcon as Pause, PencilSimpleIcon as Pencil, PlayIcon as Play, PlusIcon as Plus, ShuffleIcon as Shuffle, TagIcon as Tags, TrashIcon as Trash2 } from "@phosphor-icons/react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DataTable, type BulkAction, type Column, type RowAction } from "@/components/dashboard/data-table"
import { EmptyState } from "@/components/dashboard/empty-state"
import { MetricTile } from "@/components/dashboard/metric-tile"
import { PageHeader, SampleDataNote } from "@/components/dashboard/page-header"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { currencies, type CurrencyCode } from "@/config/markets"
import { useAsyncAction } from "@/hooks/use-async-action"
import { useNow } from "@/hooks/use-now"
import { collectionsOf } from "@/lib/data"
import { brandById } from "@/lib/data/brands"
import { convert, formatMoney, formatNumber, toMajor } from "@/lib/money"
import { useStudio } from "@/lib/stores/studio"
import { cn } from "@/lib/utils"
import type { Collection, Product } from "@/lib/data/types"
import { StatusTabs } from "@/components/studio/catalog/status-tabs"
import { PhoneSort, phoneCell, useFocusReturn } from "@/components/studio/business/shared"
import { PROMOTIONS_NOTE, promotionsDescription } from "./copy"
import { control, Field, inputClass, ListSkeleton, Segmented, selectClass } from "./form"
import { useGrowth, useGrowthReady, type DiscountType, type Promotion, type PromotionKind, type PromotionScope } from "./store"
import { brandZone, discountLabel, localId, formatDate, promotionStatus, promotionStatusMeta, todayIn, type PromotionStatus } from "./utils"

type Tab = "all" | "active" | "scheduled" | "paused" | "ended"
type Sort = "status" | "start" | "used" | "name"

/** The phone sort menu: the same orders the desktop column headers give. */
const sortOptions: { value: Sort; label: string }[] = [
  { value: "status", label: "Active first" },
  { value: "start", label: "Latest start date" },
  { value: "used", label: "Most redeemed" },
  { value: "name", label: "Name, A to Z" },
]

type Row = { p: Promotion; status: PromotionStatus }

export function PromotionsPage() {
  const ready = useGrowthReady()
  const now = useNow(60_000)
  if (!ready || now === null) return <ListSkeleton title="Promotions" description={promotionsDescription} tabs={5} />
  return <PromotionsView now={now} />
}

function scopeLabel(p: Promotion, collections: Collection[], products: Product[]) {
  if (p.scope === "all") return "All products"
  if (p.scope === "collection") return collections.find((c) => c.id === p.collectionIds[0])?.name ?? "A collection"
  if (p.productIds.length === 1) return products.find((x) => x.id === p.productIds[0])?.name ?? "1 product"
  return `${p.productIds.length} products`
}

function datesLabel(p: Promotion) {
  if (!p.endsOn) return `From ${formatDate(p.startsOn)}`
  const sameYear = p.startsOn.slice(0, 4) === p.endsOn.slice(0, 4)
  return `${formatDate(p.startsOn, { year: !sameYear })} to ${formatDate(p.endsOn)}`
}

/** A date in the hint lines: "31 Dec", with the year only when it isn't this one. */
function shortDate(date: string, today: string) {
  return formatDate(date, { year: date.slice(0, 4) !== today.slice(0, 4) })
}

/**
 * One specific line under each summary count, from the promotions themselves: the active one
 * that ends first, the scheduled one that starts next, what is on hold.
 */
function summaryHints(rows: Row[], today: string) {
  const name = (p: Promotion) => p.code ?? p.title
  const of = (status: PromotionStatus) => rows.filter((r) => r.status === status).map((r) => r.p)
  const active = of("active")
  const scheduled = of("scheduled").sort((a, b) => a.startsOn.localeCompare(b.startsOn))
  const paused = of("paused")
  // Ending first; a promotion with no end date only when none of them has one.
  const ending = [...active].sort((a, b) => (a.endsOn ?? "9999").localeCompare(b.endsOn ?? "9999"))[0]
  const more = (list: Promotion[]) => (list.length > 1 ? `, ${list.length - 1} more` : "")
  return {
    active: ending
      ? ending.endsOn
        ? `${name(ending)} ends ${active.length > 1 ? "first, " : ""}${shortDate(ending.endsOn, today)}`
        : `${name(ending)} has no end date`
      : "None running",
    scheduled: scheduled[0] ? `${name(scheduled[0])} starts ${shortDate(scheduled[0].startsOn, today)}${more(scheduled)}` : "None scheduled",
    paused: paused[0] ? `${name(paused[0])} on hold${more(paused)}` : "None paused",
  }
}

function PromotionsView({ now }: { now: number }) {
  const brandId = useStudio((s) => s.brandId)
  const products = useStudio((s) => s.products)
  const all = useGrowth((s) => s.promotions)
  const setPaused = useGrowth((s) => s.setPromotionPaused)
  const removePromotion = useGrowth((s) => s.removePromotion)
  const brand = brandById.get(brandId)!
  const today = todayIn(brandZone(brand).tz, now)
  const collections = collectionsOf(brandId)
  const [tab, setTab] = useState<Tab>("all")
  const [sort, setSort] = useState<Sort>("status")
  const [editing, setEditing] = useState<Promotion | "new" | null>(null)
  const [confirm, setConfirm] = useState<Promotion[] | null>(null)
  // The dialog keeps what it asked about while it animates closed.
  const [lastConfirm, setLastConfirm] = useState<Promotion[] | null>(null)
  if (confirm && confirm !== lastConfirm) setLastConfirm(confirm)
  const asked = confirm ?? lastConfirm
  // Opened from a row menu or the bulk bar: focus returns to the promotion, or to the list once it's gone.
  const deleteFocus = useFocusReturn(() => (asked?.length === 1 ? document.querySelector<HTMLElement>(`[data-promo="${CSS.escape(asked[0].id)}"]`) : null) ?? document.getElementById("promotion-list"))

  // Rows arrive sorted by the phone sort menu (active first by default); the column headers re-sort on wider screens.
  const rows: Row[] = (() => {
    const rank: Record<PromotionStatus, number> = { active: 0, scheduled: 1, paused: 2, "used-up": 3, expired: 3 }
    return all
      .filter((p) => p.brandId === brandId)
      .map((p) => ({ p, status: promotionStatus(p, today) }))
      .sort((a, b) =>
        sort === "start" ? b.p.startsOn.localeCompare(a.p.startsOn) : sort === "used" ? b.p.used - a.p.used : sort === "name" ? (a.p.code ?? a.p.title).localeCompare(b.p.code ?? b.p.title) : rank[a.status] - rank[b.status] || b.p.startsOn.localeCompare(a.p.startsOn),
      )
  })()

  const count = (s: PromotionStatus[]) => rows.filter((r) => s.includes(r.status)).length
  const tabStatuses: Record<Tab, PromotionStatus[]> = { all: ["active", "scheduled", "paused", "expired", "used-up"], active: ["active"], scheduled: ["scheduled"], paused: ["paused"], ended: ["expired", "used-up"] }
  const visible = rows.filter((r) => tabStatuses[tab].includes(r.status))
  const redemptions = rows.reduce((s, r) => s + r.p.used, 0)
  const hints = summaryHints(rows, today)

  // Status badges change in place, so pausing needs no toast.
  function setPausedFor(list: Row[], pause: boolean) {
    const eligible = list.filter((r) => (pause ? r.status === "active" || r.status === "scheduled" : r.status === "paused"))
    for (const r of eligible) setPaused(r.p.id, pause)
    if (eligible.length < list.length) {
      toast.info(`${eligible.length} of ${list.length} ${pause ? "paused" : "resumed"}`, { description: pause ? "Only active and scheduled promotions can be paused." : "Only paused promotions can be resumed." })
    }
  }

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code)
      toast.success("Code copied", { description: code })
    } catch {
      toast.error("Couldn't copy the code", { description: `Select it and copy it by hand: ${code}` })
    }
  }

  function remove(list: Promotion[]) {
    for (const p of list) removePromotion(p.id)
    setConfirm(null)
  }

  const name = (p: Promotion) => p.code ?? p.title
  const columns: Column<Row>[] = [
    {
      key: "promotion",
      header: "Promotion",
      sortValue: (r) => name(r.p),
      cell: ({ p, status }) => (
        <div className={cn(phoneCell, "relative")}>
          <div className="flex items-start justify-between gap-3">
            {/* Phones: the button's hit area covers the whole first cell, never the checkbox or the row menu. */}
            <button type="button" data-promo={p.id} onClick={() => setEditing(p)} className="block min-w-0 rounded-sm text-left outline-none after:absolute after:-inset-y-2 after:inset-x-0 focus-visible:ring-2 focus-visible:ring-violet md:after:hidden">
              <PromoName p={p} />
            </button>
            <span className="text-sm whitespace-nowrap text-ink tabular md:hidden">{discountLabel(p, brand.currency)}</span>
          </div>
          {/* Phones: status, dates and use fold into the first cell. */}
          <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 md:hidden">
            <StatusBadge tone={promotionStatusMeta[status].tone}>{promotionStatusMeta[status].label}</StatusBadge>
            <span className="text-xs text-ink-2 tabular">{datesLabel(p)}</span>
          </span>
        </div>
      ),
    },
    { key: "discount", header: "Discount", sortValue: (r) => (r.p.discountType === "percentage" ? r.p.value : r.p.value / 1e6), hideBelow: "md", cell: ({ p }) => <span className="whitespace-nowrap text-ink tabular">{discountLabel(p, brand.currency)}</span> },
    { key: "scope", header: "Applies to", hideBelow: "lg", className: "max-w-[200px]", cell: ({ p }) => <span className="line-clamp-1 text-ink-2">{scopeLabel(p, collections, products)}</span> },
    { key: "dates", header: "Dates", sortValue: (r) => r.p.startsOn, hideBelow: "md", cell: ({ p }) => <span className="whitespace-nowrap text-ink-2 tabular">{datesLabel(p)}</span> },
    {
      key: "used",
      header: "Used",
      align: "right",
      sortValue: (r) => r.p.used,
      hideBelow: "md",
      cell: ({ p }) => (
        <span className="whitespace-nowrap text-ink">
          {formatNumber(p.used)}
          {p.usageLimit !== null ? <span className="text-ink-3"> / {formatNumber(p.usageLimit)}</span> : null}
        </span>
      ),
    },
    { key: "status", header: "Status", sortValue: (r) => promotionStatusMeta[r.status].label, hideBelow: "md", cell: ({ status }) => <StatusBadge tone={promotionStatusMeta[status].tone}>{promotionStatusMeta[status].label}</StatusBadge> },
  ]
  const rowActions: RowAction<Row>[] = [
    { label: "Edit", icon: Pencil, onSelect: (r) => setEditing(r.p) },
    { label: "Copy code", icon: Copy, onSelect: (r) => r.p.code && copyCode(r.p.code), disabled: (r) => !r.p.code },
    { label: "Pause", icon: Pause, onSelect: (r) => setPausedFor([r], true), disabled: (r) => r.status !== "active" && r.status !== "scheduled", separatorBefore: true },
    { label: "Resume", icon: Play, onSelect: (r) => setPausedFor([r], false), disabled: (r) => r.status !== "paused" },
    { label: "Delete", icon: Trash2, onSelect: (r) => setConfirm([r.p]), destructive: true, separatorBefore: true },
  ]
  const bulkActions: BulkAction<Row>[] = [
    { label: "Pause", onSelect: (list) => setPausedFor(list, true) },
    { label: "Resume", onSelect: (list) => setPausedFor(list, false) },
    { label: "Delete", onSelect: (list) => setConfirm(list.map((r) => r.p)), destructive: true },
  ]

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Promotions"
        description={promotionsDescription}
        actions={
          <Button variant="primary" size="sm" onClick={() => setEditing("new")}>
            <Plus /> Create promotion
          </Button>
        }
      >
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <SampleDataNote />
          <p className="text-xs text-ink-3">{PROMOTIONS_NOTE}</p>
        </div>
      </PageHeader>

      {rows.length === 0 ? (
        <EmptyState icon={Tags} title="Create your first promotion" body="A discount code for your followers, or an automatic sale on a collection." action={<Button size="sm" variant="secondary" onClick={() => setEditing("new")}><Plus /> Create promotion</Button>} />
      ) : (
        <>
          <section aria-label="Promotion summary" className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricTile label="Active now" value={count(["active"])} format={(n) => formatNumber(Math.round(n))} hint={hints.active} />
            <MetricTile label="Scheduled" value={count(["scheduled"])} format={(n) => formatNumber(Math.round(n))} hint={hints.scheduled} />
            <MetricTile label="Paused" value={count(["paused"])} format={(n) => formatNumber(Math.round(n))} hint={hints.paused} />
            <MetricTile label="Redemptions" value={redemptions} format={(n) => formatNumber(Math.round(n))} hint="All promotions, sample data" />
          </section>

          <div className="grid gap-4">
            <StatusTabs
              id="promotion-status"
              label="Promotion status"
              value={tab}
              onChange={setTab}
              controls="promotion-list"
              tabs={[
                { value: "all", label: "All", count: rows.length },
                { value: "active", label: "Active", count: count(["active"]) },
                { value: "scheduled", label: "Scheduled", count: count(["scheduled"]) },
                { value: "paused", label: "Paused", count: count(["paused"]) },
                { value: "ended", label: "Ended", count: count(["expired", "used-up"]) },
              ]}
            />

            <section id="promotion-list" aria-label="Promotions" tabIndex={-1} className="outline-none">
              <DataTable
                label="Promotions"
                rows={visible}
                columns={columns}
                getId={(r) => r.p.id}
                search={{ placeholder: "Search codes and sales", text: (r) => `${r.p.code ?? ""} ${r.p.title}` }}
                toolbar={<PhoneSort value={sort} onChange={setSort} options={sortOptions} className="ml-auto" />}
                rowActions={rowActions}
                bulkActions={bulkActions}
                minWidth={300}
                empty={{ title: "No promotions here", body: "Promotions move between these tabs as they start, pause and end.", action: <Button variant="secondary" size="sm" onClick={() => setTab("all")}>Show all promotions</Button> }}
              />
            </section>
            <p className="text-xs text-ink-3">Dates follow your brand&apos;s time zone: a promotion starts at midnight on its first day and ends at 23:59 on its last.</p>
          </div>
        </>
      )}

      <PromotionDialog
        key={editing === "new" ? "new" : editing?.id ?? "closed"}
        open={editing !== null}
        promotion={editing === "new" ? null : editing}
        onClose={() => setEditing(null)}
        brandId={brandId}
        currency={brand.currency}
        today={today}
        collections={collections}
        products={products}
        existing={rows.map((r) => r.p)}
      />

      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent className="sm:max-w-[440px]" {...deleteFocus}>
          <DialogHeader>
            <DialogTitle>{asked && asked.length > 1 ? `Delete ${asked.length} promotions?` : `Delete ${asked?.[0] ? name(asked[0]) : "this promotion"}?`}</DialogTitle>
            <DialogDescription className="text-ink-2">
              {asked && asked.length > 1 ? "They're removed from Studio." : "It's removed from Studio."} Orders that already used a code keep their discount. This can&apos;t be undone; pause instead if you might bring it back.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirm(null)}>Keep</Button>
            <Button variant="destructive-solid" onClick={() => confirm && remove(confirm)}><Trash2 /> {asked && asked.length > 1 ? `Delete ${asked.length}` : "Delete promotion"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function PromoName({ p }: { p: Promotion }) {
  return (
    <div className="min-w-0">
      {p.kind === "code" ? (
        <p className="inline-flex max-w-full items-center rounded-[5px] border border-line bg-surface px-1.5 text-[13px] font-medium tracking-wider text-ink">{p.code}</p>
      ) : (
        <p className="truncate font-medium text-ink">{p.title}</p>
      )}
      <p className="mt-1 truncate text-xs text-ink-3">{p.kind === "code" ? (p.title ? `Discount code, ${p.title}` : "Discount code") : "Automatic sale, no code needed"}</p>
    </div>
  )
}

/* ---------- Create / edit ---------- */

type Form = {
  kind: PromotionKind
  code: string
  title: string
  discountType: DiscountType
  value: string
  scope: PromotionScope
  collectionId: string
  productIds: string[]
  startsOn: string
  endsOn: string
  noEnd: boolean
  limited: boolean
  usageLimit: string
  oncePerCustomer: boolean
}

type FormErrors = Partial<Record<"code" | "title" | "value" | "collection" | "products" | "startsOn" | "endsOn" | "usageLimit", string>>

function randomCode() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  return Array.from({ length: 8 }, () => letters[Math.floor(Math.random() * letters.length)]).join("")
}

function PromotionDialog({
  open,
  promotion,
  onClose,
  brandId,
  currency,
  today,
  collections,
  products,
  existing,
}: {
  open: boolean
  promotion: Promotion | null
  onClose: () => void
  brandId: string
  currency: CurrencyCode
  today: string
  collections: Collection[]
  products: Product[]
  existing: Promotion[]
}) {
  const upsert = useGrowth((s) => s.upsertPromotion)
  // Opened from a row menu, focus returns to that promotion's name.
  const focus = useFocusReturn(() => (promotion ? document.querySelector<HTMLElement>(`[data-promo="${CSS.escape(promotion.id)}"]`) : null))
  const minor = 10 ** currencies[currency].minor
  // One id per dialog, so a repeated submit saves the same promotion instead of a copy.
  const idRef = useRef(promotion?.id ?? localId("promo_"))
  const [form, setForm] = useState<Form>(() =>
    promotion
      ? {
          kind: promotion.kind,
          code: promotion.code ?? "",
          title: promotion.title,
          discountType: promotion.discountType,
          value: promotion.discountType === "percentage" ? String(promotion.value) : String(toMajor(promotion.value, currency)),
          scope: promotion.scope,
          collectionId: promotion.collectionIds[0] ?? "",
          productIds: promotion.productIds,
          startsOn: promotion.startsOn,
          endsOn: promotion.endsOn ?? "",
          noEnd: !promotion.endsOn,
          limited: promotion.usageLimit !== null,
          usageLimit: promotion.usageLimit !== null ? String(promotion.usageLimit) : "100",
          oncePerCustomer: promotion.oncePerCustomer,
        }
      : { kind: "code", code: "", title: "", discountType: "percentage", value: "10", scope: "all", collectionId: "", productIds: [], startsOn: today, endsOn: "", noEnd: true, limited: false, usageLimit: "100", oncePerCustomer: true },
  )
  const [errors, setErrors] = useState<FormErrors>({})
  const errorFor: Partial<Record<keyof Form, keyof FormErrors>> = { code: "code", title: "title", value: "value", collectionId: "collection", productIds: "products", startsOn: "startsOn", endsOn: "endsOn", usageLimit: "usageLimit", kind: "title" }
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    const ek = errorFor[k]
    if (ek) setErrors((e) => (e[ek] ? { ...e, [ek]: undefined } : e))
  }
  const symbol = currencies[currency].symbol

  // The cheapest product the promotion would apply to, in the brand currency: a fixed amount must stay under it.
  const inScope = form.scope === "all" ? products.filter((p) => p.status !== "archived") : form.scope === "collection" ? products.filter((p) => collections.find((c) => c.id === form.collectionId)?.productIds.includes(p.id)) : products.filter((p) => form.productIds.includes(p.id))
  const cheapest = inScope.map((p) => ({ name: p.name, price: convert(p.price, p.currency, currency) })).sort((a, b) => a.price - b.price)[0]

  function validate(): FormErrors {
    const e: FormErrors = {}
    if (form.kind === "code") {
      const code = form.code.trim().toUpperCase()
      if (!code) e.code = "Enter a code shoppers will type at checkout."
      else if (!/^[A-Z0-9]{3,20}$/.test(code)) e.code = "Use 3 to 20 letters or numbers, no spaces."
      else if (existing.some((p) => p.id !== promotion?.id && p.code === code)) e.code = "You already have a promotion with this code."
      if (form.title.length > 80) e.title = "Keep the note to 80 characters or fewer."
    } else {
      if (!form.title.trim()) e.title = "Name the sale. Shoppers see it on the product and in the bag."
      else if (form.title.length > 40) e.title = "Keep the name to 40 characters or fewer."
    }
    const v = Number(form.value)
    if (form.discountType === "percentage") {
      if (!/^\d+$/.test(form.value) || v < 1 || v > 90) e.value = "Enter a whole percentage from 1 to 90."
    } else if (!/^\d+(\.\d{1,2})?$/.test(form.value) || v <= 0) e.value = `Enter an amount in ${currency}, more than 0.`
    // A fixed amount has to leave something to pay on every product it applies to.
    else if (cheapest && Math.round(v * minor) >= cheapest.price) e.value = `Keep it under ${formatMoney(cheapest.price, currency)}, the price of ${cheapest.name}, the cheapest product it applies to.`
    if (form.scope === "collection" && !form.collectionId) e.collection = "Choose a collection."
    if (form.scope === "products" && form.productIds.length === 0) e.products = "Choose at least one product."
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.startsOn)) e.startsOn = "Choose a start date."
    else if (!promotion && form.startsOn < today) e.startsOn = "Start today or later."
    if (!form.noEnd) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(form.endsOn)) e.endsOn = "Choose an end date, or tick No end date."
      else if (form.endsOn < form.startsOn) e.endsOn = "The end date can't be before the start date."
    }
    if (form.limited) {
      const n = Number(form.usageLimit)
      if (!/^\d+$/.test(form.usageLimit) || n < 1) e.usageLimit = "Allow at least 1 use."
      else if (promotion && n < promotion.used) e.usageLimit = `It's been used ${promotion.used} times already, so the limit can't go below that.`
    }
    return e
  }

  const save = useAsyncAction((p: Promotion) => upsert(p), {
    success: () => (promotion ? "Promotion saved" : "Promotion created"),
    successDescription: () => (form.startsOn > today ? `Scheduled in Studio from ${formatDate(form.startsOn)}.` : "Active in Studio."),
    onSuccess: onClose,
  })

  function submit(ev: React.FormEvent) {
    ev.preventDefault()
    const e = validate()
    setErrors(e)
    const first = Object.keys(e)[0]
    if (first) {
      document.getElementById(`promo-${first}`)?.focus()
      return
    }
    const p: Promotion = {
      id: idRef.current,
      brandId,
      kind: form.kind,
      code: form.kind === "code" ? form.code.trim().toUpperCase() : null,
      title: form.title.trim(),
      discountType: form.discountType,
      value: form.discountType === "percentage" ? Number(form.value) : Math.round(Number(form.value) * minor),
      scope: form.scope,
      collectionIds: form.scope === "collection" ? [form.collectionId] : [],
      productIds: form.scope === "products" ? form.productIds : [],
      startsOn: form.startsOn,
      endsOn: form.noEnd ? null : form.endsOn,
      usageLimit: form.limited ? Number(form.usageLimit) : null,
      oncePerCustomer: form.oncePerCustomer,
      used: promotion?.used ?? 0,
      paused: promotion?.paused ?? false,
      createdAt: promotion?.createdAt ?? new Date().toISOString(),
    }
    void save.run(p)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-[560px]" {...focus}>
        <DialogHeader className="border-b border-white/8 p-5 pr-12">
          <DialogTitle>{promotion ? "Edit promotion" : "Create promotion"}</DialogTitle>
          <DialogDescription className="text-ink-2">A code shoppers type at checkout, or a sale that applies on its own.</DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={submit} className="flex min-h-0 flex-col">
          <div className="grid min-h-0 gap-5 overflow-y-auto p-5">
            <Field id="promo-kind" label="Type" as="legend">
              <Segmented<PromotionKind>
                id="promo-kind"
                label="Type"
                value={form.kind}
                onChange={(v) => set("kind", v)}
                options={[
                  { value: "code", label: "Discount code" },
                  { value: "automatic", label: "Automatic sale" },
                ]}
              />
            </Field>

            {form.kind === "code" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="promo-code" label="Code" error={errors.code} hint="Not case-sensitive for shoppers.">
                  <div className="flex gap-2">
                    <Input {...control("promo-code", errors.code, true)} value={form.code} onChange={(e) => set("code", e.target.value.toUpperCase().replace(/\s/g, ""))} placeholder="NIGHTBUS15" maxLength={24} autoComplete="off" className={cn(inputClass, "font-medium tracking-wider uppercase")} />
                    <Button type="button" variant="secondary" size="icon" className="size-11 shrink-0 md:size-9" onClick={() => { set("code", randomCode()); setErrors((x) => ({ ...x, code: undefined })) }} aria-label="Generate a code">
                      <Shuffle />
                    </Button>
                  </div>
                </Field>
                <Field id="promo-title" label="Internal note" optional error={errors.title}>
                  <Input {...control("promo-title", errors.title)} value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="For the newsletter" maxLength={90} className={inputClass} />
                </Field>
              </div>
            ) : (
              <Field id="promo-title" label="Sale name" error={errors.title} hint="Shown on the product and in the bag.">
                <Input {...control("promo-title", errors.title, true)} value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="Danfo week" maxLength={50} className={inputClass} />
              </Field>
            )}

            <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-start">
              <Field id="promo-discount-type" label="Discount" as="legend">
                <Segmented<DiscountType>
                  id="promo-discount-type"
                  label="Discount type"
                  value={form.discountType}
                  onChange={(v) => { set("discountType", v); set("value", v === "percentage" ? "10" : ""); setErrors((x) => ({ ...x, value: undefined })) }}
                  options={[
                    { value: "percentage", label: "Percentage" },
                    { value: "fixed", label: "Fixed amount" },
                  ]}
                />
              </Field>
              <Field id="promo-value" label={form.discountType === "percentage" ? "Percentage off" : `Amount off (${currency})`} error={errors.value}>
                <div className="relative">
                  {form.discountType === "fixed" ? <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-ink-3">{symbol}</span> : null}
                  <Input {...control("promo-value", errors.value)} inputMode="decimal" value={form.value} onChange={(e) => set("value", e.target.value.replace(/[^\d.]/g, ""))} className={cn(inputClass, "tabular", form.discountType === "fixed" ? "pl-9" : "pr-9")} />
                  {form.discountType === "percentage" ? <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-ink-3">%</span> : null}
                </div>
              </Field>
            </div>

            <Field id="promo-scope" label="Applies to" as="legend">
              <Segmented<PromotionScope>
                id="promo-scope"
                label="Applies to"
                value={form.scope}
                onChange={(v) => set("scope", v)}
                options={[
                  { value: "all", label: "All products" },
                  { value: "collection", label: "Collection" },
                  { value: "products", label: "Products" },
                ]}
              />
            </Field>
            {form.scope === "collection" ? (
              <Field id="promo-collection" label="Collection" error={errors.collection}>
                <Select value={form.collectionId} onValueChange={(v) => { set("collectionId", v); setErrors((x) => ({ ...x, collection: undefined })) }}>
                  <SelectTrigger {...control("promo-collection", errors.collection)} className={selectClass}>
                    <SelectValue placeholder="Choose a collection" />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    {collections.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name} ({c.productIds.length})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            ) : null}
            {form.scope === "products" ? (
              <Field id="promo-products" label="Products" as="legend" error={errors.products}>
                <ul id="promo-products" tabIndex={-1} className="grid max-h-56 grid-cols-1 gap-1 overflow-y-auto rounded-md border border-line p-1 outline-none">
                  {products.map((p) => {
                    const on = form.productIds.includes(p.id)
                    return (
                      <li key={p.id}>
                        <label className="flex cursor-pointer items-center gap-3 rounded-[5px] px-2 py-2 hover:bg-elevated">
                          <Checkbox checked={on} aria-invalid={errors.products ? true : undefined} onCheckedChange={(c) => { set("productIds", c ? [...form.productIds, p.id] : form.productIds.filter((x) => x !== p.id)); setErrors((x) => ({ ...x, products: undefined })) }} />
                          <span className="min-w-0 flex-1 truncate text-sm text-ink">{p.name}</span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              </Field>
            ) : null}

            <div className="grid grid-cols-2 gap-4">
              <Field id="promo-startsOn" label="Starts" error={errors.startsOn}>
                <Input {...control("promo-startsOn", errors.startsOn)} type="date" value={form.startsOn} min={promotion ? undefined : today} onChange={(e) => set("startsOn", e.target.value)} className={cn(inputClass, "[color-scheme:dark]")} />
              </Field>
              <Field id="promo-endsOn" label="Ends" error={errors.endsOn}>
                <Input {...control("promo-endsOn", errors.endsOn)} type="date" value={form.noEnd ? "" : form.endsOn} min={form.startsOn} disabled={form.noEnd} onChange={(e) => set("endsOn", e.target.value)} className={cn(inputClass, "[color-scheme:dark]")} />
              </Field>
              <label className="col-span-2 -mt-2 flex items-center gap-2 text-[13px] text-ink-2">
                <Checkbox checked={form.noEnd} onCheckedChange={(c) => { set("noEnd", !!c); if (!c && !form.endsOn) set("endsOn", form.startsOn) ; setErrors((x) => ({ ...x, endsOn: undefined })) }} />
                No end date
              </label>
            </div>

            <div className="grid gap-3 rounded-md border border-line-soft bg-surface/50 p-3">
              <div className="flex flex-wrap items-center gap-3">
                <Label className="flex items-center gap-2 text-[13px] font-normal text-ink">
                  <Checkbox checked={form.limited} onCheckedChange={(c) => set("limited", !!c)} />
                  Limit total uses
                </Label>
                {form.limited ? (
                  <Input {...control("promo-usageLimit", errors.usageLimit)} aria-label="Total uses" inputMode="numeric" value={form.usageLimit} onChange={(e) => set("usageLimit", e.target.value.replace(/[^\d]/g, ""))} className={cn(inputClass, "w-28 tabular")} />
                ) : null}
              </div>
              {errors.usageLimit ? <p id="promo-usageLimit-error" className="text-xs text-danger">{errors.usageLimit}</p> : null}
              <Label className="flex items-center gap-2 text-[13px] font-normal text-ink">
                <Checkbox checked={form.oncePerCustomer} onCheckedChange={(c) => set("oncePerCustomer", !!c)} />
                One use per customer
              </Label>
            </div>
          </div>
          <DialogFooter className="mx-0 mb-0 shrink-0">
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" loading={save.pending}>{promotion ? "Save promotion" : "Create promotion"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
