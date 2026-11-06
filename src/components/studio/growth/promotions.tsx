"use client"

import { useState } from "react"
import { CopyIcon as Copy, DotsThreeIcon as MoreHorizontal, PauseIcon as Pause, PencilSimpleIcon as Pencil, PlayIcon as Play, PlusIcon as Plus, ShuffleIcon as Shuffle, TagIcon as Tags, TrashIcon as Trash2 } from "@phosphor-icons/react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { EmptyState } from "@/components/dashboard/empty-state"
import { MetricTile } from "@/components/dashboard/metric-tile"
import { PageHeader, SampleDataNote } from "@/components/dashboard/page-header"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { currencies, type CurrencyCode } from "@/config/markets"
import { useNow } from "@/hooks/use-now"
import { collectionsOf } from "@/lib/data"
import { brandById } from "@/lib/data/brands"
import { formatNumber, toMajor } from "@/lib/money"
import { useStudio } from "@/lib/stores/studio"
import { cn } from "@/lib/utils"
import type { Collection, Product } from "@/lib/data/types"
import { StatusTabs } from "@/components/studio/catalog/status-tabs"
import { control, Field, inputClass, ListSkeleton, Segmented, selectClass } from "./form"
import { useGrowth, useGrowthReady, type DiscountType, type Promotion, type PromotionKind, type PromotionScope } from "./store"
import { brandZone, discountLabel, localId, formatDate, promotionStatus, promotionStatusMeta, todayIn, type PromotionStatus } from "./utils"

type Tab = "all" | "active" | "scheduled" | "paused" | "ended"

export function PromotionsPage() {
  const ready = useGrowthReady()
  const now = useNow(60_000)
  if (!ready || now === null) return <ListSkeleton />
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
  const [editing, setEditing] = useState<Promotion | "new" | null>(null)
  const [confirm, setConfirm] = useState<Promotion | null>(null)

  const rows = (() => {
    const rank: Record<PromotionStatus, number> = { active: 0, scheduled: 1, paused: 2, "used-up": 3, expired: 3 }
    return all
      .filter((p) => p.brandId === brandId)
      .map((p) => ({ p, status: promotionStatus(p, today) }))
      .sort((a, b) => rank[a.status] - rank[b.status] || b.p.startsOn.localeCompare(a.p.startsOn))
  })()

  const count = (s: PromotionStatus[]) => rows.filter((r) => s.includes(r.status)).length
  const tabStatuses: Record<Tab, PromotionStatus[]> = { all: ["active", "scheduled", "paused", "expired", "used-up"], active: ["active"], scheduled: ["scheduled"], paused: ["paused"], ended: ["expired", "used-up"] }
  const visible = rows.filter((r) => tabStatuses[tab].includes(r.status))
  const redemptions = rows.reduce((s, r) => s + r.p.used, 0)

  function togglePause(p: Promotion, status: PromotionStatus) {
    const pause = status !== "paused"
    setPaused(p.id, pause)
    const name = p.code ?? p.title
    toast(pause ? `${name} paused` : `${name} resumed`, { description: pause ? "Shoppers can't use it until you resume it." : p.startsOn > today ? `It starts ${formatDate(p.startsOn)}.` : "Shoppers can use it again now." })
  }

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code)
      toast("Code copied", { description: code })
    } catch {
      toast("Couldn't copy the code", { description: `Select it and copy it by hand: ${code}` })
    }
  }

  function remove(p: Promotion) {
    removePromotion(p.id)
    setConfirm(null)
    toast(`${p.code ?? p.title} deleted`, { description: "Orders that already used it keep their discount." })
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Campaigns"
        description="Promotions for your shop: discount codes shoppers type at checkout, and sales that apply on their own. You fund the discount; it comes off the price the customer pays."
        actions={
          <Button variant="primary" size="sm" onClick={() => setEditing("new")}>
            <Plus /> Create promotion
          </Button>
        }
      >
        <SampleDataNote className="mt-3" />
      </PageHeader>

      {rows.length === 0 ? (
        <EmptyState icon={Tags} title="Create your first promotion" body="A discount code for your followers, or an automatic sale on a collection." action={<Button size="sm" variant="secondary" onClick={() => setEditing("new")}><Plus /> Create promotion</Button>} />
      ) : (
        <>
          <section aria-label="Promotion summary" className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricTile label="Active now" value={count(["active"])} format={(n) => formatNumber(Math.round(n))} />
            <MetricTile label="Scheduled" value={count(["scheduled"])} format={(n) => formatNumber(Math.round(n))} />
            <MetricTile label="Paused" value={count(["paused"])} format={(n) => formatNumber(Math.round(n))} />
            <MetricTile label="Redemptions" value={redemptions} format={(n) => formatNumber(Math.round(n))} hint="all promotions" />
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

            <section id="promotion-list" aria-label="Promotions" className="overflow-hidden rounded-lg border border-line-soft bg-card">
              {visible.length === 0 ? (
                <div className="p-4 md:p-5">
                  <EmptyState icon={Tags} title="No promotions here" body="Promotions move between these tabs as they start, pause and end." action={<Button variant="secondary" size="sm" onClick={() => setTab("all")}>Show all promotions</Button>} />
                </div>
              ) : (
                <>
                  <ul className="divide-y divide-line-soft md:hidden">
                    {visible.map(({ p, status }) => (
                      <li key={p.id} className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <PromoName p={p} />
                          <RowActions p={p} status={status} onEdit={setEditing} onToggle={togglePause} onCopy={copyCode} onDelete={setConfirm} />
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <StatusBadge tone={promotionStatusMeta[status].tone}>{promotionStatusMeta[status].label}</StatusBadge>
                          <span className="text-sm text-ink tabular">{discountLabel(p, brand.currency)}</span>
                        </div>
                        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                          <div className="min-w-0">
                            <dt className="text-ink-3">Applies to</dt>
                            <dd className="mt-0.5 truncate text-ink-2">{scopeLabel(p, collections, products)}</dd>
                          </div>
                          <div>
                            <dt className="text-ink-3">Used</dt>
                            <dd className="mt-0.5 text-ink-2 tabular">{formatNumber(p.used)}{p.usageLimit !== null ? ` of ${formatNumber(p.usageLimit)}` : ""}</dd>
                          </div>
                          <div className="col-span-2">
                            <dt className="text-ink-3">Dates</dt>
                            <dd className="mt-0.5 text-ink-2 tabular">{datesLabel(p)}</dd>
                          </div>
                        </dl>
                      </li>
                    ))}
                  </ul>

                  <div className="hidden overflow-x-auto md:block">
                    <table className="w-full min-w-[900px] text-left text-sm">
                      <thead className="border-b border-line-soft bg-surface/60 text-xs text-ink-3">
                        <tr>
                          <th scope="col" className="px-4 py-2.5 font-normal md:px-5">Promotion</th>
                          <th scope="col" className="px-3 py-2.5 font-normal">Discount</th>
                          <th scope="col" className="px-3 py-2.5 font-normal">Applies to</th>
                          <th scope="col" className="px-3 py-2.5 font-normal">Dates</th>
                          <th scope="col" className="px-3 py-2.5 text-right font-normal">Used</th>
                          <th scope="col" className="px-3 py-2.5 font-normal">Status</th>
                          <th scope="col" className="px-4 py-2.5 font-normal md:px-5"><span className="sr-only">Actions</span></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line-soft">
                        {visible.map(({ p, status }) => (
                          <tr key={p.id} className="transition-colors hover:bg-white/[0.02]">
                            <td className="max-w-[280px] px-4 py-3 md:px-5"><PromoName p={p} /></td>
                            <td className="px-3 py-3 whitespace-nowrap text-ink tabular">{discountLabel(p, brand.currency)}</td>
                            <td className="max-w-[200px] px-3 py-3 text-ink-2"><span className="line-clamp-1">{scopeLabel(p, collections, products)}</span></td>
                            <td className="px-3 py-3 whitespace-nowrap text-ink-2 tabular">{datesLabel(p)}</td>
                            <td className="px-3 py-3 text-right whitespace-nowrap text-ink tabular">
                              {formatNumber(p.used)}
                              {p.usageLimit !== null ? <span className="text-ink-3"> / {formatNumber(p.usageLimit)}</span> : null}
                            </td>
                            <td className="px-3 py-3"><StatusBadge tone={promotionStatusMeta[status].tone}>{promotionStatusMeta[status].label}</StatusBadge></td>
                            <td className="px-4 py-3 text-right md:px-5"><RowActions p={p} status={status} onEdit={setEditing} onToggle={togglePause} onCopy={copyCode} onDelete={setConfirm} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </section>
            <p className="text-xs text-ink-3">Dates follow your brand&apos;s time zone: a promotion starts at midnight on its first day and ends at 23:59 on its last. Redemption counts are sample data until the store is connected.</p>
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
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Delete {confirm?.code ?? confirm?.title}?</DialogTitle>
            <DialogDescription className="text-ink-2">
              Shoppers won&apos;t be able to use it any more. Orders that already used it keep their discount. This can&apos;t be undone; pause it instead if you might bring it back.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirm(null)}>Keep it</Button>
            <Button variant="destructive" onClick={() => confirm && remove(confirm)}><Trash2 /> Delete promotion</Button>
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

function RowActions({ p, status, onEdit, onToggle, onCopy, onDelete }: { p: Promotion; status: PromotionStatus; onEdit: (p: Promotion) => void; onToggle: (p: Promotion, s: PromotionStatus) => void; onCopy: (code: string) => void; onDelete: (p: Promotion) => void }) {
  const canToggle = status === "active" || status === "scheduled" || status === "paused"
  return (
    <div className="flex shrink-0 items-center justify-end gap-1">
      {canToggle ? (
        <Button variant="secondary" size="xs" onClick={() => onToggle(p, status)} aria-label={`${status === "paused" ? "Resume" : "Pause"} ${p.code ?? p.title}`}>
          {status === "paused" ? <Play /> : <Pause />}
          {status === "paused" ? "Resume" : "Pause"}
        </Button>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${p.code ?? p.title}`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onSelect={() => onEdit(p)}><Pencil /> Edit</DropdownMenuItem>
          {p.code ? <DropdownMenuItem onSelect={() => onCopy(p.code!)}><Copy /> Copy code</DropdownMenuItem> : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => onDelete(p)}><Trash2 /> Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
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
  const minor = 10 ** currencies[currency].minor
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
      id: promotion?.id ?? localId("promo_"),
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
    upsert(p)
    const name = p.code ?? p.title
    toast(promotion ? `${name} saved` : `${name} created`, {
      description: p.startsOn > today ? `It starts ${formatDate(p.startsOn)}.` : p.paused ? "It's paused. Resume it when you're ready." : `${discountLabel(p, currency)} is live now.`,
    })
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-[560px]">
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
            <Button type="submit" variant="primary">{promotion ? "Save promotion" : "Create promotion"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
