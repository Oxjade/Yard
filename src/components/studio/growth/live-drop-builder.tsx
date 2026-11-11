"use client"

import { useMemo, useRef, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { ArrowCounterClockwiseIcon as RetryIcon, FloppyDiskIcon as SaveIcon, ImageSquareIcon as ImageIcon, RocketIcon as ScheduleIcon } from "@phosphor-icons/react"
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
import { dropImageSrc, isApiImage, type DropAccessDto, type PublicDropDto, type StudioDropDto } from "@/lib/api/drops"
import { useApi } from "@/lib/api/use-api"
import type { Product } from "@/lib/data/types"
import { formatNumber, formatMoney } from "@/lib/money"
import { cn } from "@/lib/utils"
import { loadStudioDrops, studioDropsKey } from "./live-drops"
import { ChoiceCard, ChoiceGroup, EditorSkeleton, Field, inputClass, Panel } from "./form"

const HOUR = 60 * 60 * 1000
const summaryDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })
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
  /** Hours before release: when follower early access opens, when draw entries open and close. */
  earlyHours: string
  entryOpenHours: string
  entryCloseHours: string
  /** How long each draw winner has to buy. */
  windowHours: string
}
type ErrorKey = "name" | "description" | "products" | "image" | "release" | "duration" | "quantity" | "limit" | "winners" | "early" | "entryOpen" | "entryClose" | "window"
type Errors = Partial<Record<ErrorKey, string>>
type Body = {
  name: string
  description: string
  productIds: string[]
  image: string | null
  access: DropAccessDto
  startsAt: string
  endsAt: string
  earlyAccessAt: string | null
  entryOpensAt: string | null
  entryClosesAt: string | null
  purchaseWindowMinutes: number
  winnersCount: number | null
  limitPerCustomer: number
  totalUnits: number
}

/** Which form values each request field is built from: an edit sends a field only when one of them changed. */
const SOURCES: Record<keyof Body, (keyof Values)[]> = {
  name: ["name"],
  description: ["description"],
  productIds: ["productIds"],
  image: ["image"],
  access: ["access"],
  startsAt: ["date", "time"],
  endsAt: ["date", "time", "durationHours"],
  earlyAccessAt: ["access", "date", "time", "earlyHours"],
  entryOpensAt: ["access", "date", "time", "entryOpenHours"],
  entryClosesAt: ["access", "date", "time", "entryCloseHours"],
  purchaseWindowMinutes: ["windowHours"],
  winnersCount: ["access", "winners"],
  limitPerCustomer: ["limit"],
  totalUnits: ["quantity"],
}

/** Server field → the form field that shows its message. */
const FIELD_FOR: Record<string, ErrorKey> = {
  name: "name",
  slug: "name",
  description: "description",
  productIds: "products",
  variantIds: "products",
  image: "image",
  startsAt: "release",
  endsAt: "duration",
  earlyAccessAt: "early",
  entryOpensAt: "entryOpen",
  entryClosesAt: "entryClose",
  purchaseWindowMinutes: "window",
  totalUnits: "quantity",
  limitPerCustomer: "limit",
  winnersCount: "winners",
}

const VERSION_CONFLICT = /changed this drop/i

function dateParts(at: number) {
  const date = new Date(at)
  return {
    date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
    time: `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`,
  }
}

const hoursText = (ms: number) => String(Math.round((ms / HOUR) * 100) / 100)

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
    earlyHours: drop?.earlyAccessAt ? hoursText(start - Date.parse(drop.earlyAccessAt)) : "24",
    entryOpenHours: drop?.entryOpensAt ? hoursText(start - Date.parse(drop.entryOpensAt)) : "24",
    entryCloseHours: drop?.entryClosesAt ? hoursText(start - Date.parse(drop.entryClosesAt)) : "0",
    windowHours: drop?.purchaseWindowMinutes ? hoursText(drop.purchaseWindowMinutes * 60_000) : "24",
  }
}

const sameValue = (a: Values[keyof Values], b: Values[keyof Values]) => JSON.stringify(a) === JSON.stringify(b)

function startAt(date: string, time: string) {
  if (!date || !time) return null
  const value = new Date(`${date}T${time}`)
  return Number.isNaN(value.getTime()) ? null : value
}

/** The time at the moment of an action (submit), not the 30-second display tick. */
const currentTime = () => Date.now()

/** A new Idempotency-Key for one create action (reused on its retries). */
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `drop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`)

export function LiveDropBuilder({ id, brandId, canManage, onSaved }: { id: string | null; brandId: string; canManage: boolean; onSaved: () => void }) {
  const hydrated = useHydrated()
  const now = useNow(30_000)
  // No refetch on focus: the editor never swaps a drop out from under someone typing (409 → Reload does it on request).
  const dropsQuery = useApi(canManage ? studioDropsKey(brandId) : null, loadStudioDrops, { keepPrevious: false, revalidateOnFocus: false })
  const productsQuery = useApi(canManage ? `studio.catalog:${brandId}` : null, loadStudioProductDtos, { keepPrevious: false, revalidateOnFocus: false })
  const products = useMemo(() => (productsQuery.data ?? []).map(fromStudioProduct).filter((product) => product.status === "published"), [productsQuery.data])

  if (!canManage) {
    return <EmptyState title="Drops are read-only" body="Your Studio role does not have permission to create or edit drops." action={<Button asChild size="sm" variant="secondary"><Link href="/studio/drops">Back to drops</Link></Button>} />
  }
  if (!hydrated || now === null || (dropsQuery.isLoading && !dropsQuery.data) || (productsQuery.isLoading && !productsQuery.data)) return <EditorSkeleton />
  const failure = (!dropsQuery.data && dropsQuery.error) || (!productsQuery.data && productsQuery.error)
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
    return <EmptyState title="This drop isn&apos;t available" body="It may have been removed from this brand, or the link may be incorrect." action={<Button asChild size="sm" variant="secondary"><Link href="/studio/drops">Back to drops</Link></Button>} />
  }
  // Keyed on the drop only (not its version): a newer version never remounts the form and loses typed edits.
  return <LiveDropForm key={id ?? "new"} id={id} existing={existing} products={products} now={now} onSaved={onSaved} onReload={async () => {
    const list = await dropsQuery.revalidate()
    return list?.find((drop) => drop.id === id) ?? null
  }} />
}

function LiveDropForm({ id, existing, products, now, onSaved, onReload }: { id: string | null; existing: StudioDropDto | null; products: Product[]; now: number; onSaved: () => void; onReload: () => Promise<StudioDropDto | null> }) {
  const [initial, setInitial] = useState(() => initialValues(existing, now))
  const [values, setValues] = useState(initial)
  const [workingDrop, setWorkingDrop] = useState<PublicDropDto | null>(existing)
  const [errors, setErrors] = useState<Errors>({})
  const [saveError, setSaveError] = useState<{ message: string; reload: boolean; extra?: string[] } | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [reloading, setReloading] = useState(false)
  const createKey = useRef<{ signature: string; key: string } | null>(null)
  const guard = useLeaveGuard(dirty, { body: "Your changes to this drop will be lost." })
  const activeDrop = workingDrop ?? existing
  const accessLocked = activeDrop?.status === "scheduled"
  const hasStarted = !!activeDrop && (activeDrop.status === "live" || activeDrop.status === "ended" || activeDrop.status === "cancelled" || (activeDrop.status === "scheduled" && now >= Date.parse(activeDrop.earlyAccessAt ?? activeDrop.startsAt)))
  // A scheduled draw whose entries have opened (or that has entries): shoppers entered on these terms, so they stay fixed.
  const drawLocked = !!activeDrop && activeDrop.status === "scheduled" && activeDrop.access === "draw" && ((activeDrop.entryOpensAt !== null && now >= Date.parse(activeDrop.entryOpensAt)) || (activeDrop.entries ?? 0) > 0)
  const selectedProducts = products.filter((product) => values.productIds.includes(product.id))
  const start = startAt(values.date, values.time)
  const duration = Number(values.durationHours)
  const quantity = Number(values.quantity)
  const limit = Number(values.limit)
  const winners = Number(values.winners)
  const earlyHours = Number(values.earlyHours)
  const entryOpenHours = Number(values.entryOpenHours)
  const entryCloseHours = Number(values.entryCloseHours)
  const windowHours = Number(values.windowHours)
  const canSelectProduct = (product: Product) => product.status === "published"

  const errorKeyFor: Partial<Record<keyof Values, ErrorKey>> = { productIds: "products", image: "image", date: "release", time: "release", durationHours: "duration", quantity: "quantity", limit: "limit", winners: "winners", earlyHours: "early", entryOpenHours: "entryOpen", entryCloseHours: "entryClose", windowHours: "window", name: "name", description: "description" }
  const set = <K extends keyof Values>(key: K, value: Values[K]) => {
    setValues((current) => ({ ...current, [key]: value }))
    setDirty(true)
    if (!saveError?.reload) setSaveError(null)
    const errorKey = errorKeyFor[key]
    if (errorKey) setErrors((current) => ({ ...current, [errorKey]: undefined }))
  }

  function validate(mode: "draft" | "schedule") {
    const next: Errors = {}
    if (!values.name.trim()) next.name = "Name the drop."
    else if (values.name.trim().length > 120) next.name = "Keep the name to 120 characters or fewer."
    if (values.description.length > 2000) next.description = "Keep the description to 2,000 characters or fewer."
    if (!values.productIds.length) next.products = "Choose at least one published product."
    else if (values.productIds.length > MAX_PRODUCTS) next.products = `Choose no more than ${MAX_PRODUCTS} products.`
    if (!start) next.release = "Enter a valid release date and time."
    else if (mode === "schedule" && start.getTime() <= currentTime() + 60_000) next.release = "Choose a release time at least one minute in the future."
    if (!Number.isInteger(duration) || duration < 1 || duration > 720) next.duration = "Choose a duration from 1 hour to 30 days."
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1_000_000) next.quantity = "Set a quantity from 1 to 1,000,000 units."
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) next.limit = "Set a customer limit from 1 to 20."
    if (values.access === "draw") {
      if (!Number.isInteger(winners) || winners < 1 || winners > quantity) next.winners = "Set between 1 winner and the total quantity."
      if (!Number.isFinite(entryOpenHours) || entryOpenHours <= 0 || entryOpenHours > 720) next.entryOpen = "Open entries between a few minutes and 30 days before release."
      if (!Number.isFinite(entryCloseHours) || entryCloseHours < 0 || entryCloseHours > 720) next.entryClose = "Close entries at release or up to 30 days before it."
      else if (Number.isFinite(entryOpenHours) && entryCloseHours >= entryOpenHours) next.entryClose = "Close entries after they open."
      if (!Number.isFinite(windowHours) || windowHours * 60 < 5 || windowHours * 60 > 10080) next.window = "Give winners between 5 minutes and 7 days to buy."
    }
    if (values.access === "early_access" && (!Number.isFinite(earlyHours) || earlyHours <= 0 || earlyHours > 168)) next.early = "Open early access up to 7 days (168 hours) before release."
    setErrors(next)
    return Object.keys(next).length === 0
  }

  /** The whole request, its times worked out now (not on the 30-second tick). */
  function requestBody(at: number): Body {
    if (!start) throw new Error("Enter a valid release date and time.")
    const release = start.getTime()
    const startsAt = start.toISOString()
    const closes = release - (entryCloseHours || 0) * HOUR
    return {
      name: values.name.trim(),
      description: values.description.trim(),
      productIds: values.productIds,
      image: values.image?.id ?? null,
      access: values.access,
      startsAt,
      endsAt: new Date(release + duration * HOUR).toISOString(),
      // Never in the past: a release soon after now opens early access and entries a moment from now.
      earlyAccessAt: values.access === "early_access" ? new Date(Math.max(at + 90_000, release - earlyHours * HOUR)).toISOString() : null,
      entryOpensAt: values.access === "draw" ? new Date(Math.min(closes - 60_000, Math.max(at + 30_000, release - entryOpenHours * HOUR))).toISOString() : null,
      entryClosesAt: values.access === "draw" ? new Date(closes).toISOString() : null,
      purchaseWindowMinutes: Math.round(windowHours * 60),
      winnersCount: values.access === "draw" ? winners : null,
      limitPerCustomer: limit,
      totalUnits: quantity,
    }
  }

  /** An edit sends only what changed; a draft about to be scheduled also refreshes opening times that have passed. */
  function changedFields(full: Body, target: PublicDropDto, mode: "draft" | "schedule"): Partial<Body> {
    const changed = new Set((Object.keys(values) as (keyof Values)[]).filter((key) => !sameValue(values[key], initial[key])))
    const out: Partial<Body> = {}
    for (const field of Object.keys(SOURCES) as (keyof Body)[]) {
      if (SOURCES[field].some((key) => changed.has(key))) (out as Record<string, unknown>)[field] = full[field]
    }
    if (mode === "schedule" && target.status === "draft") {
      const past = (value: string | null) => value !== null && Date.parse(value) <= currentTime() + 60_000
      if (target.access === "early_access" && past(target.earlyAccessAt)) out.earlyAccessAt = full.earlyAccessAt
      if (target.access === "draw" && past(target.entryOpensAt)) out.entryOpensAt = full.entryOpensAt
    }
    return out
  }

  function showError(error: unknown) {
    if (error instanceof ApiError && error.status === 409 && VERSION_CONFLICT.test(error.message)) {
      setSaveError({ message: errorMessage(error), reload: true })
      return
    }
    const serverErrors = fieldErrors(error)
    const next: Errors = {}
    const unmapped: string[] = []
    for (const [field, message] of Object.entries(serverErrors)) {
      const key = FIELD_FOR[field] ?? FIELD_FOR[field.split(".")[0]]
      if (key) next[key] = next[key] ?? message
      else unmapped.push(message)
    }
    if (Object.keys(next).length) setErrors((current) => ({ ...current, ...next }))
    setSaveError({ message: errorMessage(error), reload: false, extra: unmapped.length ? unmapped : undefined })
  }

  async function reload() {
    setReloading(true)
    try {
      const fresh = await onReload()
      if (!fresh) {
        setSaveError({ message: "This drop couldn't be reloaded. It may have been cancelled or removed.", reload: true })
        return
      }
      const next = initialValues(fresh, currentTime())
      setInitial(next)
      setValues(next)
      setWorkingDrop(fresh)
      setErrors({})
      setDirty(false)
      setSaveError(null)
      toast.success("Drop reloaded", { description: "You're now editing the latest version." })
    } finally {
      setReloading(false)
    }
  }

  async function save(mode: "draft" | "schedule") {
    if (saving || hasStarted || !validate(mode)) return
    setSaving(true)
    setSaveError(null)
    let target = activeDrop
    let created = false
    try {
      const full = requestBody(currentTime())
      if (!target) {
        // One key per create action, reused when the same form is retried after a lost response.
        const signature = JSON.stringify(values)
        if (!createKey.current || createKey.current.signature !== signature) createKey.current = { signature, key: newKey() }
        const result = await api<{ drop: PublicDropDto }>("/api/drops", { body: full, headers: { "Idempotency-Key": createKey.current.key } })
        target = result.drop
        created = true
        createKey.current = null
        setWorkingDrop(target)
        setInitial(values)
        setDirty(false)
        onSaved()
        // The draft exists now: the address follows it, so a failed schedule step leaves the brand editing it (not a second create).
        if (!id) window.history.replaceState(null, "", `/studio/drops/${encodeURIComponent(target.id)}`)
      } else {
        if (mode === "draft" && target.status === "scheduled") {
          const result = await api<{ drop: PublicDropDto }>(`/api/drops/${encodeURIComponent(target.id)}/schedule`, { method: "DELETE", body: { expectedVersion: target.version } })
          target = result.drop
          setWorkingDrop(target)
        }
        const patch = changedFields(full, target, mode)
        if (Object.keys(patch).length) {
          const result = await api<{ drop: PublicDropDto }>(`/api/drops/${encodeURIComponent(target.id)}`, { method: "PATCH", body: { ...patch, expectedVersion: target.version } })
          target = result.drop
          setWorkingDrop(target)
        }
        setInitial(values)
        setDirty(false)
      }

      if (mode === "schedule" && target.status === "draft") {
        const result = await api<{ drop: PublicDropDto }>(`/api/drops/${encodeURIComponent(target.id)}/schedule`, { body: { expectedVersion: target.version } })
        target = result.drop
        setWorkingDrop(target)
      }
      onSaved()
      if (mode === "draft") {
        toast.success("Draft saved", { description: `${target.name} is ready to edit.` })
        if (id) guard.go("/studio/drops")
      } else {
        toast.success(activeDrop?.status === "scheduled" ? "Schedule saved" : "Drop scheduled", { description: target.name })
        guard.go("/studio/drops")
      }
    } catch (error) {
      if (created) onSaved()
      showError(error)
    } finally {
      setSaving(false)
    }
  }

  if (hasStarted) {
    return <div className="grid gap-6">
      <BackLink href="/studio/drops">Drops</BackLink>
      <PageHeader
        title={activeDrop?.status === "cancelled" ? "This drop was cancelled" : activeDrop?.status === "ended" || (activeDrop && now >= Date.parse(activeDrop.endsAt)) ? "This drop has ended" : "This drop has started"}
        description={activeDrop?.status === "cancelled" ? "Cancelled drops can't be edited or scheduled again. Create a new drop instead." : activeDrop?.status === "ended" || (activeDrop && now >= Date.parse(activeDrop.endsAt)) ? "Ended drops can't be edited. Its results stay on the public drop page." : `Its schedule and products are locked. You can cancel it${activeDrop?.access === "draw" ? " or run its draw" : ""} from the drops list.`}
      />
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

      {saveError ? (
        <div role="alert" className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
          <div className="min-w-0">
            <p>{saveError.message}</p>
            {saveError.extra?.length ? <ul className="mt-1 list-disc pl-5">{saveError.extra.map((message) => <li key={message}>{message}</li>)}</ul> : null}
            {saveError.reload ? <p className="mt-1 text-ink-2">Reload to see the latest version. Your unsaved changes here will be replaced.</p> : null}
          </div>
          {saveError.reload ? <Button type="button" variant="secondary" size="sm" loading={reloading} onClick={() => void reload()}><RetryIcon /> Reload</Button> : null}
        </div>
      ) : null}
      {drawLocked ? <p role="status" className="rounded-md border border-line bg-surface p-3 text-sm text-ink-2">Entries are open for this draw, so its pieces, quantities, winners and times are fixed. You can still edit the name, description and image, or cancel the drop from the drops list.</p> : null}

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
                  const disabled = drawLocked || (!checked && (values.productIds.length >= MAX_PRODUCTS || !canSelectProduct(product)))
                  const checkboxId = `live-drop-product-${product.id}`
                  return <li key={product.id}>
                    <label htmlFor={checkboxId} className={cn("flex min-h-14 items-center gap-2.5 rounded-[5px] px-2 py-1.5", disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-white/[0.03]")}>
                      <Checkbox id={checkboxId} checked={checked} disabled={disabled} onCheckedChange={(selected) => set("productIds", selected ? [...values.productIds, product.id] : values.productIds.filter((productId) => productId !== product.id))} />
                      <span className="relative size-9 shrink-0 overflow-hidden rounded bg-surface">{product.images[0] ? <Image src={product.images[0].src} alt="" fill unoptimized={isApiImage(product.images[0].src)} sizes="36px" className="object-cover" /> : null}</span>
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
                <Image src={values.image.src} alt="Current drop image" fill unoptimized={isApiImage(values.image.src)} sizes="(min-width: 768px) 448px, 90vw" className="object-cover" />
                <span className="absolute right-2 bottom-2 rounded-sm bg-obsidian/80 px-2 py-1 text-[11px] text-ink">Current image</span>
              </div> : null}
              <MediaUploader purpose="drop_image" as="brand" maxFiles={1} onUploaded={(media) => { set("image", { id: media.id, src: media.src }) }} onRemoved={(media) => { if (values.image?.id === media.id) set("image", null) }} />
              {errors.image ? <p role="alert" className="text-xs text-danger">{errors.image}</p> : null}
            </div>
          </Panel>

          <Panel title="Release" description="The date and time are interpreted in this device&apos;s time zone.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="live-drop-date" label="Release date" error={errors.release}>
                <Input id="live-drop-date" type="date" disabled={drawLocked} value={values.date} onChange={(event) => set("date", event.target.value)} aria-invalid={!!errors.release} className={cn(inputClass, "[color-scheme:dark]")} />
              </Field>
              <Field id="live-drop-time" label="Release time">
                <Input id="live-drop-time" type="time" step={300} disabled={drawLocked} value={values.time} onChange={(event) => set("time", event.target.value)} aria-invalid={!!errors.release} className={cn(inputClass, "[color-scheme:dark]")} />
              </Field>
              <Field id="live-drop-duration" label="Duration (hours)" hint="From 1 hour up to 720 hours (30 days)." error={errors.duration}>
                <Input id="live-drop-duration" type="number" min={1} max={720} step={1} disabled={drawLocked} value={values.durationHours} onChange={(event) => set("durationHours", event.target.value)} aria-invalid={!!errors.duration} className={inputClass} />
              </Field>
            </div>
            {startsAtLocal ? <p className="mt-3 text-xs text-ink-3">Releases {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(startsAtLocal))}. The schedule is stored as UTC.</p> : null}
          </Panel>

          <Panel title="Access and limits" description="Choose how shoppers get access, then set the quantity and per-customer limit.">
            <div className="grid gap-4">
              <div className="grid gap-1.5">
                <p className="text-[13px] text-ink">Access type</p>
                <ChoiceGroup id="live-drop-access" label="Access type" value={values.access} onValueChange={(value) => set("access", value as DropAccessDto)} className="md:grid-cols-3">
                  {ACCESS.map((option) => <ChoiceCard key={option.value} value={option.value} disabled={accessLocked || drawLocked} className="min-h-24 p-3">
                    <span className="block text-sm font-medium text-ink">{option.label}</span>
                    <span className="mt-1 block text-xs leading-relaxed text-ink-2">{option.description}</span>
                  </ChoiceCard>)}
                </ChoiceGroup>
                {accessLocked ? <p className="text-xs text-ink-3">Access type cannot change after scheduling. Move the drop to drafts first.</p> : null}
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field id="live-drop-quantity" label="Total units" error={errors.quantity}>
                  <Input id="live-drop-quantity" type="number" min={1} max={1_000_000} step={1} disabled={drawLocked} value={values.quantity} onChange={(event) => set("quantity", event.target.value)} aria-invalid={!!errors.quantity} className={inputClass} />
                </Field>
                <Field id="live-drop-limit" label="Limit per customer" error={errors.limit}>
                  <Input id="live-drop-limit" type="number" min={1} max={20} step={1} disabled={drawLocked} value={values.limit} onChange={(event) => set("limit", event.target.value)} aria-invalid={!!errors.limit} className={inputClass} />
                </Field>
                {values.access === "draw" ? <Field id="live-drop-winners" label="Number of winners" error={errors.winners}>
                  <Input id="live-drop-winners" type="number" min={1} max={quantity || 1} step={1} disabled={drawLocked} value={values.winners} onChange={(event) => set("winners", event.target.value)} aria-invalid={!!errors.winners} className={inputClass} />
                </Field> : null}
              </div>
              {values.access === "draw" ? <div className="grid gap-4 sm:grid-cols-3">
                <Field id="live-drop-entry-open" label="Entries open (hours before release)" error={errors.entryOpen}>
                  <Input id="live-drop-entry-open" type="number" min={0.25} max={720} step="any" disabled={drawLocked} value={values.entryOpenHours} onChange={(event) => set("entryOpenHours", event.target.value)} aria-invalid={!!errors.entryOpen} className={inputClass} />
                </Field>
                <Field id="live-drop-entry-close" label="Entries close (hours before release)" hint="0 closes entries at release." error={errors.entryClose}>
                  <Input id="live-drop-entry-close" type="number" min={0} max={720} step="any" disabled={drawLocked} value={values.entryCloseHours} onChange={(event) => set("entryCloseHours", event.target.value)} aria-invalid={!!errors.entryClose} className={inputClass} />
                </Field>
                <Field id="live-drop-window" label="Winner purchase window (hours)" error={errors.window}>
                  <Input id="live-drop-window" type="number" min={0.1} max={168} step="any" disabled={drawLocked} value={values.windowHours} onChange={(event) => set("windowHours", event.target.value)} aria-invalid={!!errors.window} className={inputClass} />
                </Field>
              </div> : values.access === "early_access" ? <Field id="live-drop-early" label="Follower early access (hours before release)" hint="Up to 168 hours (7 days)." error={errors.early}>
                <Input id="live-drop-early" type="number" min={0.25} max={168} step="any" value={values.earlyHours} onChange={(event) => set("earlyHours", event.target.value)} aria-invalid={!!errors.early} className={cn(inputClass, "sm:max-w-48")} />
              </Field> : null}
              {values.access === "draw" ? <p className="text-xs text-ink-3">The draw runs when entries close. Each winner then has the purchase window to buy; the public drop page publishes the fairness commitment.</p> : null}
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
              {start && values.access === "draw" && Number.isFinite(entryOpenHours) && Number.isFinite(entryCloseHours) ? <>
                <div className="flex justify-between gap-3"><dt className="text-ink-3">Entries open</dt><dd className="text-right text-ink">{activeDrop?.entryOpensAt && drawLocked ? summaryDate.format(new Date(activeDrop.entryOpensAt)) : summaryDate.format(new Date(Math.max(now, start.getTime() - entryOpenHours * HOUR)))}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-ink-3">Entries close</dt><dd className="text-right text-ink">{summaryDate.format(new Date(start.getTime() - entryCloseHours * HOUR))}</dd></div>
              </> : null}
              {start && values.access === "early_access" && Number.isFinite(earlyHours) ? <div className="flex justify-between gap-3"><dt className="text-ink-3">Early access</dt><dd className="text-right text-ink">{summaryDate.format(new Date(Math.max(now, start.getTime() - earlyHours * HOUR)))}</dd></div> : null}
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