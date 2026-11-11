"use client"

import { useMemo, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { FloppyDiskIcon as SaveIcon, ImageSquareIcon as ImageIcon, RocketIcon as ScheduleIcon } from "@phosphor-icons/react"
import { toast } from "sonner"
import { EmptyState } from "@/components/dashboard/empty-state"
import { PageHeader } from "@/components/dashboard/page-header"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { MediaUploader } from "@/components/media/media-uploader"
import { BackLink } from "@/components/studio/business/shared"
import { useLeaveGuard } from "@/components/studio/catalog/save-bar"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { ApiError, api } from "@/lib/api/client"
import { errorMessage, fieldErrors } from "@/lib/api/errors"
import { fromStudioProduct, loadStudioProductDtos } from "@/components/studio/catalog/live"
import { useHydrated } from "@/hooks/use-hydrated"
import { useNow } from "@/hooks/use-now"
import { dropImageSrc, type DropAccessDto, type PublicDropDto, type StudioDropDto } from "@/lib/api/drops"
import { useApi } from "@/lib/api/use-api"
import type { Product } from "@/lib/data/types"
import { formatNumber, formatMoney } from "@/lib/money"
import { cn } from "@/lib/utils"
import { loadStudioDrops, studioDropsKey } from "./live-drops"
import { ChoiceCard, ChoiceGroup, EditorSkeleton, Field, inputClass, Panel } from "./form"

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const MAX_PRODUCTS = 20
const ACCESS: { value: DropAccessDto; label: string; description: string }[] = [
  { value: "first_come", label: "First come", description: "Anyone can buy from release until the available units are gone." },
  { value: "early_access", label: "Early access", description: "Followers get an exclusive period before public release." },
  { value: "draw", label: "Draw", description: "Shoppers enter before release; winners receive a purchase window." },
]

type Values = {
  name: string
  description: string
  productIds: string[]
  image: { id: string; src: string } | null
  date: string
  time: string
  durationHours: string
  access: DropAccessDto
  quantity: string
  limit: string
  winners: string
}
type Errors = Partial<Record<"name" | "description" | "products" | "release" | "duration" | "quantity" | "limit" | "winners", string>>

function dateParts(at: number) {
  const date = new Date(at)
  return {
    date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
    time: `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`,
  }
}

function initialValues(drop: StudioDropDto | null, now: number): Values {
  const start = drop ? Date.parse(drop.startsAt) : (() => {
    const next = new Date(now + 7 * DAY)
    next.setHours(11, 0, 0, 0)
    return next.getTime()
  })()
  const parts = dateParts(start)
  const duration = drop ? Math.max(1, Math.round((Date.parse(drop.endsAt) - start) / HOUR)) : 48
  return {
    name: drop?.name ?? "",
    description: drop?.description ?? "",
    productIds: drop?.productIds ?? [],
    image: drop?.image ? { id: drop.image, src: dropImageSrc(drop.image, "brand") } : null,
    date: parts.date,
    time: parts.time,
    durationHours: String(duration),
    access: drop?.access ?? "first_come",
    quantity: String(drop?.totalUnits || 100),
    limit: String(drop?.limitPerCustomer ?? 2),
    winners: String(drop?.winners ?? 1),
  }
}

function startAt(date: string, time: string) {
  if (!date || !time) return null
  const value = new Date(`${date}T${time}`)
  return Number.isNaN(value.getTime()) ? null : value
}

export function LiveDropBuilder({ id, brandId, canManage, onSaved }: { id: string | null; brandId: string; canManage: boolean; onSaved: () => void }) {
  const hydrated = useHydrated()
  const now = useNow(30_000)
  const dropsQuery = useApi(canManage ? studioDropsKey(brandId) : null, loadStudioDrops, { keepPrevious: false })
  const productsQuery = useApi(canManage ? `studio.catalog:${brandId}` : null, loadStudioProductDtos, { keepPrevious: false })
  const products = useMemo(() => (productsQuery.data ?? []).map(fromStudioProduct).filter((product) => product.status === "published"), [productsQuery.data])

  if (!canManage) {
    return <EmptyState title="Drops are read-only" body="Your Studio role does not have permission to create or edit drops." action={<Button asChild size="sm" variant="secondary"><Link href="/studio/drops">Back to drops</Link></Button>} />
  }
  if (!hydrated || now === null || dropsQuery.isLoading || productsQuery.isLoading) return <EditorSkeleton />
  const failure = dropsQuery.error ?? productsQuery.error
  if (failure) {
    return <div className="grid gap-4">
      <BackLink href="/studio/drops">Drops</BackLink>
      <div role="alert" className="grid max-w-xl gap-3 rounded-lg border border-line bg-surface p-5">
        <h1 className="text-base font-medium text-ink">The drop editor couldn&apos;t load</h1>
        <p className="text-sm text-ink-2">{errorMessage(failure)}</p>
        <Button variant="secondary" size="sm" className="w-fit" onClick={() => { void dropsQuery.revalidate(); void productsQuery.revalidate() }}>Try again</Button>
      </div>
    </div>
  }
  const existing = id ? (dropsQuery.data ?? []).find((drop) => drop.id === id) ?? null : null
  if (id && !existing) {
    return <EmptyState title="This drop isn&apos;t available" body="It may have been cancelled, removed from this brand, or the link may be incorrect." action={<Button asChild size="sm" variant="secondary"><Link href="/studio/drops">Back to drops</Link></Button>} />
  }
  return <LiveDropForm key={`${id ?? "new"}:${existing?.version ?? 0}`} id={id} existing={existing} products={products} now={now} onSaved={onSaved} onRefresh={() => void dropsQuery.revalidate()} />
}

function LiveDropForm({ id, existing, products, now, onSaved, onRefresh }: { id: string | null; existing: StudioDropDto | null; products: Product[]; now: number; onSaved: () => void; onRefresh: () => void }) {
  const router = useRouter()
  const [values, setValues] = useState(() => initialValues(existing, now))
  const [workingDrop, setWorkingDrop] = useState<PublicDropDto | null>(existing)
  const [errors, setErrors] = useState<Errors>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const guard = useLeaveGuard(dirty, { body: "Your changes to this drop will be lost." })
  const activeDrop = workingDrop ?? existing
  const accessLocked = activeDrop?.status === "scheduled"
  const hasStarted = !!activeDrop && (activeDrop.status === "live" || activeDrop.status === "ended" || activeDrop.status === "cancelled" || (activeDrop.status === "scheduled" && now >= Date.parse(activeDrop.earlyAccessAt ?? activeDrop.startsAt)))
  const selectedProducts = products.filter((product) => values.productIds.includes(product.id))
  const start = startAt(values.date, values.time)
  const duration = Number(values.durationHours)
  const quantity = Number(values.quantity)
  const limit = Number(values.limit)
  const winners = Number(values.winners)
  const canSelectProduct = (product: Product) => product.status === "published"

  const set = <K extends keyof Values>(key: K, value: Values[K]) => {
    setValues((current) => ({ ...current, [key]: value }))
    setDirty(true)
    setSaveError(null)
    setErrors((current) => ({ ...current, [key === "productIds" ? "products" : key === "date" || key === "time" ? "release" : key === "durationHours" ? "duration" : key === "quantity" ? "quantity" : key === "limit" ? "limit" : key === "winners" ? "winners" : key]: undefined }))
  }

  function validate(mode: "draft" | "schedule") {
    const next: Errors = {}
    if (!values.name.trim()) next.name = "Name the drop."
    else if (values.name.trim().length > 120) next.name = "Keep the name to 120 characters or fewer."
    if (values.description.length > 2000) next.description = "Keep the description to 2,000 characters or fewer."
    if (!values.productIds.length) next.products = "Choose at least one published product."
    else if (values.productIds.length > MAX_PRODUCTS) next.products = `Choose no more than ${MAX_PRODUCTS} products.`
    if (!start) next.release = "Enter a valid release date and time."
    else if (mode === "schedule" && start.getTime() <= now + 60_000) next.release = "Choose a release time at least one minute in the future."
    if (!Number.isInteger(duration) || duration < 1 || duration > 720) next.duration = "Choose a duration from 1 hour to 30 days."
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1_000_000) next.quantity = "Set a quantity from 1 to 1,000,000 units."
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) next.limit = "Set a customer limit from 1 to 20."
    if (values.access === "draw" && (!Number.isInteger(winners) || winners < 1 || winners > quantity)) next.winners = "Set between 1 winner and the total quantity."
    if (start && Number.isInteger(duration) && duration > 0 && duration <= 720 && start.getTime() + duration * HOUR - start.getTime() > 30 * DAY) next.duration = "A drop can run for 30 days at most."
    setErrors(next)
    return Object.keys(next).length === 0
  }

  function requestBody() {
    if (!start) throw new Error("Enter a valid release date and time.")
    const startsAt = start.toISOString()
    const opensAt = new Date(Math.max(now + 30_000, start.getTime() - DAY)).toISOString()
    return {
      name: values.name.trim(),
      description: values.description.trim(),
      productIds: values.productIds,
      image: values.image?.id ?? null,
      access: values.access,
      startsAt,
      endsAt: new Date(start.getTime() + duration * HOUR).toISOString(),
      earlyAccessAt: values.access === "early_access" ? opensAt : null,
      entryOpensAt: values.access === "draw" ? opensAt : null,
      entryClosesAt: values.access === "draw" ? startsAt : null,
      purchaseWindowMinutes: 1440,
      winnersCount: values.access === "draw" ? winners : null,
      limitPerCustomer: limit,
      totalUnits: quantity,
      reminderLeadMinutes: 60,
    }
  }

  async function save(mode: "draft" | "schedule") {
    if (saving || hasStarted || !validate(mode)) return
    setSaving(true)
    setSaveError(null)
    try {
      const body = requestBody()
      let target = activeDrop
      if (!target) {
        const result = await api<{ drop: PublicDropDto }>("/api/drops", { body })
        target = result.drop
        setWorkingDrop(target)
      } else {
        if (mode === "draft" && target.status === "scheduled") {
          const result = await api<{ drop: PublicDropDto }>(`/api/drops/${encodeURIComponent(target.id)}/schedule`, { method: "DELETE", body: { expectedVersion: target.version } })
          target = result.drop
          setWorkingDrop(target)
        }
        const result = await api<{ drop: PublicDropDto }>(`/api/drops/${encodeURIComponent(target.id)}`, {
          method: "PATCH",
          body: { ...body, expectedVersion: target.version },
        })
        target = result.drop
        setWorkingDrop(target)
      }

      if (mode === "schedule" && target.status === "draft") {
        const result = await api<{ drop: PublicDropDto }>(`/api/drops/${encodeURIComponent(target.id)}/schedule`, { body: { expectedVersion: target.version } })
        target = result.drop
        setWorkingDrop(target)
      }
      setDirty(false)
      onSaved()
      if (mode === "draft") {
        toast.success("Draft saved", { description: `${target.name} is ready to edit.` })
        if (!id) router.replace(`/studio/drops/${target.id}`)
        else guard.go("/studio/drops")
      } else {
        toast.success(target.status === "scheduled" ? "Schedule saved" : "Drop scheduled", { description: target.name })
        guard.go("/studio/drops")
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setSaveError(errorMessage(error))
        onRefresh()
      } else {
        const serverErrors = fieldErrors(error)
        if (Object.keys(serverErrors).length) {
          setErrors((current) => ({
            ...current,
            name: serverErrors.name,
            description: serverErrors.description,
            products: serverErrors.productIds,
            release: serverErrors.startsAt ?? serverErrors.entryOpensAt ?? serverErrors.entryClosesAt,
            duration: serverErrors.endsAt,
            quantity: serverErrors.totalUnits,
            limit: serverErrors.limitPerCustomer,
            winners: serverErrors.winnersCount,
          }))
        }
        setSaveError(errorMessage(error))
      }
    } finally {
      setSaving(false)
    }
  }

  if (hasStarted) {
    return <div className="grid gap-6">
      <BackLink href="/studio/drops">Drops</BackLink>
      <PageHeader title="This drop has started" description="Its schedule and products are locked. You can cancel it or run its draw from the drops list." />
      <Button asChild variant="secondary" size="sm" className="w-fit"><Link href="/studio/drops">Return to drops</Link></Button>
    </div>
  }

  const title = activeDrop ? activeDrop.status === "scheduled" ? "Edit scheduled drop" : "Edit draft drop" : "Create a drop"
  const startsAtLocal = start?.toISOString()

  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        <BackLink href="/studio/drops">Drops</BackLink>
        <PageHeader title={title} description="Choose your products, set the release window and decide how shoppers get access." actions={
          <div className="hidden items-center gap-2 sm:flex">
            {activeDrop?.status === "scheduled" ? <Button type="button" variant="secondary" size="sm" disabled={saving} onClick={() => void save("draft")}><SaveIcon /> Move to drafts</Button> : <Button type="button" variant="secondary" size="sm" disabled={saving} onClick={() => void save("draft")}><SaveIcon /> Save draft</Button>}
            <Button type="button" variant="primary" size="sm" loading={saving} onClick={() => void save("schedule")}><ScheduleIcon /> {activeDrop?.status === "scheduled" ? "Save schedule" : "Schedule drop"}</Button>
          </div>
        }>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {activeDrop ? <StatusBadge tone={activeDrop.status === "scheduled" ? "info" : "muted"}>{activeDrop.status === "scheduled" ? "Scheduled" : "Draft"}</StatusBadge> : null}
            <span className="text-xs text-ink-3">Times use this device&apos;s time zone. Shoppers see them in their own zone.</span>
          </div>
        </PageHeader>
      </div>

      {saveError ? <p role="alert" className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{saveError}</p> : null}

      <form noValidate onSubmit={(event) => { event.preventDefault(); void save("schedule") }} className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid min-w-0 content-start gap-5">
          <Panel title="Details" description="Shown on the drop page and in shopper reminders.">
            <div className="grid gap-4">
              <Field id="live-drop-name" label="Name" error={errors.name}>
                <Input id="live-drop-name" maxLength={120} value={values.name} onChange={(event) => set("name", event.target.value)} aria-invalid={!!errors.name} className={inputClass} />
              </Field>
              <Field id="live-drop-description" label="Description" hint="Describe what is included and why the release is limited." error={errors.description}>
                <Textarea id="live-drop-description" maxLength={2000} value={values.description} onChange={(event) => set("description", event.target.value)} aria-invalid={!!errors.description} className="min-h-24" />
              </Field>
            </div>
          </Panel>

          <Panel title="Products" description="Choose up to 20 published products from this brand.">
            <Field id="live-drop-products" label="Products in this drop" error={errors.products}>
              {products.length ? <ul className="grid max-h-80 gap-1 overflow-y-auto rounded-md border border-line-soft bg-card p-1 sm:grid-cols-2">
                {products.map((product) => {
                  const checked = values.productIds.includes(product.id)
                  const disabled = !checked && (values.productIds.length >= MAX_PRODUCTS || !canSelectProduct(product))
                  const checkboxId = `live-drop-product-${product.id}`
                  return <li key={product.id}>
                    <label htmlFor={checkboxId} className={cn("flex min-h-14 items-center gap-2.5 rounded-[5px] px-2 py-1.5", disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-white/[0.03]")}>
                      <Checkbox id={checkboxId} checked={checked} disabled={disabled} onCheckedChange={(selected) => set("productIds", selected ? [...values.productIds, product.id] : values.productIds.filter((productId) => productId !== product.id))} />
                      <span className="relative size-9 shrink-0 overflow-hidden rounded bg-surface">{product.images[0] ? <Image src={product.images[0].src} alt="" fill sizes="36px" className="object-cover" /> : null}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs text-ink">{product.name}</span>
                        <span className="block truncate text-[11px] text-ink-3">{formatMoney(product.price, product.currency)} · {formatNumber(product.variants.reduce((total, variant) => total + variant.stock, 0))} in stock</span>
                      </span>
                    </label>
                  </li>
                })}
              </ul> : <p className="rounded-md border border-dashed border-line p-4 text-sm text-ink-2">Publish a product in your catalogue before creating a drop.</p>}
              <p className="text-xs text-ink-3">{values.productIds.length} of {MAX_PRODUCTS} selected. Stock and purchase limits are enforced at checkout.</p>
            </Field>
          </Panel>

          <Panel title="Drop image" description="Upload a landscape image for the public drop page and cards." action={<ImageIcon className="size-4 text-ink-3" aria-hidden />}>
            <div className="grid gap-4">
              {values.image ? <div className="relative aspect-[4/3] max-w-md overflow-hidden rounded-md border border-line-soft bg-surface">
                <Image src={values.image.src} alt="Current drop image" fill sizes="(min-width: 768px) 448px, 90vw" className="object-cover" />
                <span className="absolute right-2 bottom-2 rounded-sm bg-obsidian/80 px-2 py-1 text-[11px] text-ink">Current image</span>
              </div> : null}
              <MediaUploader purpose="drop_image" as="brand" maxFiles={1} onUploaded={(media) => { set("image", { id: media.id, src: media.src }) }} onRemoved={(media) => { if (values.image?.id === media.id) set("image", null) }} />
            </div>
          </Panel>

          <Panel title="Release" description="The date and time are interpreted in this device&apos;s time zone.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="live-drop-date" label="Release date" error={errors.release}>
                <Input id="live-drop-date" type="date" value={values.date} onChange={(event) => set("date", event.target.value)} aria-invalid={!!errors.release} className={cn(inputClass, "[color-scheme:dark]")} />
              </Field>
              <Field id="live-drop-time" label="Release time">
                <Input id="live-drop-time" type="time" step={300} value={values.time} onChange={(event) => set("time", event.target.value)} aria-invalid={!!errors.release} className={cn(inputClass, "[color-scheme:dark]")} />
              </Field>
              <Field id="live-drop-duration" label="Duration (hours)" hint="From 1 hour up to 720 hours (30 days)." error={errors.duration}>
                <Input id="live-drop-duration" type="number" min={1} max={720} step={1} value={values.durationHours} onChange={(event) => set("durationHours", event.target.value)} aria-invalid={!!errors.duration} className={inputClass} />
              </Field>
            </div>
            {startsAtLocal ? <p className="mt-3 text-xs text-ink-3">Releases {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(startsAtLocal))}. The schedule is stored as UTC.</p> : null}
          </Panel>

          <Panel title="Access and limits" description="Choose how shoppers get access, then set the quantity and per-customer limit.">
            <div className="grid gap-4">
              <div className="grid gap-1.5">
                <p className="text-[13px] text-ink">Access type</p>
                <ChoiceGroup id="live-drop-access" label="Access type" value={values.access} onValueChange={(value) => set("access", value as DropAccessDto)} className="md:grid-cols-3">
                  {ACCESS.map((option) => <ChoiceCard key={option.value} value={option.value} disabled={accessLocked} className="min-h-24 p-3">
                    <span className="block text-sm font-medium text-ink">{option.label}</span>
                    <span className="mt-1 block text-xs leading-relaxed text-ink-2">{option.description}</span>
                  </ChoiceCard>)}
                </ChoiceGroup>
                {accessLocked ? <p className="text-xs text-ink-3">Access type cannot change after scheduling. Move the drop to drafts first.</p> : null}
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field id="live-drop-quantity" label="Total units" error={errors.quantity}>
                  <Input id="live-drop-quantity" type="number" min={1} max={1_000_000} step={1} value={values.quantity} onChange={(event) => set("quantity", event.target.value)} aria-invalid={!!errors.quantity} className={inputClass} />
                </Field>
                <Field id="live-drop-limit" label="Limit per customer" error={errors.limit}>
                  <Input id="live-drop-limit" type="number" min={1} max={20} step={1} value={values.limit} onChange={(event) => set("limit", event.target.value)} aria-invalid={!!errors.limit} className={inputClass} />
                </Field>
                {values.access === "draw" ? <Field id="live-drop-winners" label="Number of winners" error={errors.winners}>
                  <Input id="live-drop-winners" type="number" min={1} max={quantity || 1} step={1} value={values.winners} onChange={(event) => set("winners", event.target.value)} aria-invalid={!!errors.winners} className={inputClass} />
                </Field> : null}
              </div>
              {values.access === "draw" ? <p className="text-xs text-ink-3">Entries open 24 hours before release when the schedule allows. Winners have 24 hours to purchase; the public draw page publishes the fairness commitment.</p> : values.access === "early_access" ? <p className="text-xs text-ink-3">Follower access opens up to 24 hours before public release.</p> : null}
            </div>
          </Panel>
        </div>

        <aside className="grid content-start gap-3 xl:sticky xl:top-24 xl:self-start">
          <section aria-label="Drop summary" className="grid gap-3 rounded-lg border border-line-soft bg-card p-4">
            <h2 className="text-sm font-medium text-ink">Schedule summary</h2>
            <dl className="grid gap-2 text-xs">
              <div className="flex justify-between gap-3"><dt className="text-ink-3">Release</dt><dd className="text-right text-ink">{start ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(start) : "Not set"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink-3">Closes</dt><dd className="text-right text-ink">{start && Number.isInteger(duration) && duration > 0 ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(start.getTime() + duration * HOUR)) : "Not set"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink-3">Access</dt><dd className="text-right text-ink">{ACCESS.find((option) => option.value === values.access)?.label}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink-3">Quantity</dt><dd className="text-right text-ink tabular">{Number.isInteger(quantity) && quantity > 0 ? `${formatNumber(quantity)} units` : "Not set"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink-3">Products</dt><dd className="text-right text-ink tabular">{selectedProducts.length}</dd></div>
            </dl>
          </section>
          <p className="text-xs leading-relaxed text-ink-3">Shoppers can set reminders or enter draws from the public drop page. Checkout enforces stock and purchase windows.</p>
        </aside>

        <div className="glass-strong sticky bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-10 col-span-full flex justify-end gap-2 rounded-lg p-2 sm:hidden">
          <Button type="button" variant="secondary" size="sm" disabled={saving} onClick={() => void save("draft")}><SaveIcon /> {activeDrop?.status === "scheduled" ? "Move to drafts" : "Save draft"}</Button>
          <Button type="submit" variant="primary" size="sm" loading={saving}><ScheduleIcon /> {activeDrop?.status === "scheduled" ? "Save schedule" : "Schedule"}</Button>
        </div>
      </form>
      {guard.dialog}
    </div>
  )
}