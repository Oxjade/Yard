"use client"

import { useCallback, useLayoutEffect, useRef, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CalendarXIcon as CalendarX, CheckIcon as Check, DiceFiveIcon as Dices, ImageSquareIcon as ImagePlus, LockIcon as Lock, RocketIcon as Rocket, UsersIcon as Users, LightningIcon as Zap } from "@phosphor-icons/react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { EmptyState } from "@/components/dashboard/empty-state"
import { PageHeader } from "@/components/dashboard/page-header"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { DropCard } from "@/components/market/drop-card"
import { BackLink, useFocusReturn } from "@/components/studio/business/shared"
import { useLeaveGuard } from "@/components/studio/catalog/save-bar"
import { imageFileError, readImage } from "@/components/studio/onboarding/image-utils"
import { getDemoAnchor, useNow } from "@/hooks/use-now"
import { collectionsOf } from "@/lib/data"
import { brandById } from "@/lib/data/brands"
import { productStock } from "@/lib/data/products"
import { dropAccessLabel } from "@/lib/drops"
import { formatMoney, formatNumber } from "@/lib/money"
import { useStudio } from "@/lib/stores/studio"
import { cn } from "@/lib/utils"
import type { Drop, DropAccess, ImageAsset } from "@/lib/data/types"
import { CATALOGUE_NOTE } from "./copy"
import { ChoiceCard, ChoiceGroup, control, EditorSkeleton, Field, inputClass, NumberStepper, Panel, selectClass } from "./form"
import { useGrowth, useGrowthReady } from "./store"
import { addDays, brandZone, countryZone, dropStatusMeta, formatInZone, HOUR, localId, notifyCount, relativeTime, studioDropStatus, todayIn, utcToZoned, zoneAbbr, zoneLongName, zonedToUtc } from "./utils"

type Mode = "draft" | "schedule" | "publish" | "save"

type Values = {
  name: string
  description: string
  productIds: string[]
  imageSrc: string | null
  date: string
  time: string
  /** IANA zone the date and time are entered in. */
  timeZone: string
  durationHours: string
  access: DropAccess
  limit: string
  quantity: string
}

type Errors = Partial<Record<"name" | "description" | "products" | "image" | "release" | "quantity" | "limit", string>>

const DURATIONS = [
  { value: "6", label: "6 hours" },
  { value: "12", label: "12 hours" },
  { value: "24", label: "24 hours" },
  { value: "48", label: "48 hours" },
  { value: "72", label: "3 days" },
  { value: "168", label: "7 days" },
]

const ACCESS: { value: DropAccess; icon: React.ComponentType<{ className?: string }>; title: string; body: string }[] = [
  { value: "first-come", icon: Zap, title: "First come, first served", body: "Anyone can buy from the release time until units run out." },
  { value: "draw", icon: Dices, title: "Draw", body: "Shoppers enter before release. Winners are picked at random and only winners pay." },
  { value: "early-access", icon: Users, title: "Early access for followers", body: "Followers can buy for 24 hours before everyone else." },
]

const MIN_LEAD_MINUTES = 30

/** Zones a release can be entered in: each market's main zone, the brand's first, then the browser's. */
function zoneOptions(brandTz: string, userTz: string | null, at: number) {
  const seen = new Set<string>()
  const list: { tz: string; label: string }[] = []
  const add = (tz: string, label: string) => {
    if (seen.has(tz)) return
    seen.add(tz)
    list.push({ tz, label })
  }
  const brandCity = Object.values(countryZone).find((z) => z.tz === brandTz)?.city ?? brandTz
  add(brandTz, `${brandCity} (${zoneAbbr(brandTz, at)}), your brand`)
  if (userTz) add(userTz, `${userTz.split("/").pop()?.replace(/_/g, " ")} (${zoneAbbr(userTz, at)}), this device`)
  for (const z of Object.values(countryZone)) add(z.tz, `${z.city} (${zoneAbbr(z.tz, at)})`)
  return list
}

function slugify(s: string) {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "drop"
}

/** The next Thursday or Saturday at least two days out: the usual "drop day" slots. */
function suggestedDate(today: string) {
  for (let i = 2; i < 10; i++) {
    const d = addDays(today, i)
    const wd = new Date(`${d}T12:00:00Z`).getUTCDay()
    if (wd === 4 || wd === 6) return d
  }
  return addDays(today, 7)
}

export function DropBuilder({ id }: { id: string | null }) {
  const [generation, setGeneration] = useState(0)
  const reset = useCallback(() => setGeneration((g) => g + 1), [])
  const ready = useGrowthReady()
  const now = useNow(30_000)
  const drops = useStudio((s) => s.drops)
  if (!ready || now === null) return <EditorSkeleton />
  const existing = id ? drops.find((d) => d.id === id) : undefined
  if (id && !existing) {
    return (
      <div className="grid gap-6">
        <BackLink href="/studio/drops">Drops</BackLink>
        <EmptyState
          icon={CalendarX}
          title="This drop isn't here"
          body="It may have been deleted, or it was created in another browser. Drops are saved in this browser until the store is connected."
          action={<Button asChild size="sm" variant="secondary"><Link href="/studio/drops">Back to drops</Link></Button>}
        />
      </div>
    )
  }
  return <DropForm key={`${id ?? "new"}:${generation}`} existing={existing} now={now} onReset={reset} />
}

function DropForm({ existing, now, onReset }: { existing?: Drop; now: number; onReset: () => void }) {
  const router = useRouter()
  const rootRef = useRef<HTMLDivElement>(null)
  const savedRef = useRef(false)

  // Next keeps visited pages alive (hidden) for back/forward. Once this form has saved, start
  // fresh the next time it's shown, so "Schedule a drop" never reopens the last drop's values.
  useLayoutEffect(() => {
    return () => {
      if (savedRef.current) {
        savedRef.current = false
        onReset()
      }
    }
  }, [onReset])
  const brandId = useStudio((s) => s.brandId)
  const products = useStudio((s) => s.products)
  const allDrops = useStudio((s) => s.drops)
  const upsertDrop = useStudio((s) => s.upsertDrop)
  const meta = useGrowth((s) => (existing ? s.dropMeta[existing.id] : undefined))
  const setDropMeta = useGrowth((s) => s.setDropMeta)
  const brand = brandById.get(brandId)!
  const anchor = getDemoAnchor()
  const brandTz = brandZone(brand).tz
  const savedTz = meta?.timeZone ?? brandTz
  const status = existing ? studioDropStatus(existing, meta, now, anchor) : null
  const locked = status === "live" || status === "sold-out" || status === "ended"
  const sold = existing ? Math.max(0, existing.totalUnits - existing.unitsLeft) : 0

  const [values, setValues] = useState<Values>(() => {
    if (existing) {
      const release = utcToZoned(anchor + existing.releaseOffsetHours * HOUR, savedTz)
      return {
        name: existing.name,
        description: existing.description,
        productIds: existing.productIds,
        imageSrc: existing.image.src,
        date: release.date,
        time: release.time,
        timeZone: savedTz,
        durationHours: String(existing.durationHours),
        access: existing.access,
        limit: String(existing.limitPerCustomer),
        quantity: String(existing.totalUnits),
      }
    }
    return { name: "", description: "", productIds: [], imageSrc: null, date: suggestedDate(todayIn(savedTz, now)), time: "11:00", timeZone: savedTz, durationHours: "48", access: "first-come", limit: "2", quantity: "100" }
  })
  const tz = values.timeZone
  const [errors, setErrors] = useState<Errors>({})
  const [uploads, setUploads] = useState<ImageAsset[]>([])
  const [dirty, setDirty] = useState(false)
  const [confirmPublish, setConfirmPublish] = useState(false)
  // One id for this form, so a repeated click updates the same drop instead of making a second.
  const idRef = useRef(existing?.id ?? localId("d_local_"))
  // Set once a save is leaving the page: blocks repeat submits while the route changes.
  const [leaving, setLeaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Asks before the page is left with unsaved changes: reload or close, and in-app links.
  const guard = useLeaveGuard(dirty, { body: "Your changes to this drop will be lost." })

  const errorFor: Partial<Record<keyof Values, keyof Errors>> = { name: "name", description: "description", productIds: "products", imageSrc: "image", date: "release", time: "release", timeZone: "release", quantity: "quantity", limit: "limit" }
  const set = <K extends keyof Values>(key: K, value: Values[K]) => {
    setValues((v) => ({ ...v, [key]: value }))
    setDirty(true)
    const ek = errorFor[key]
    if (ek) setErrors((e) => (e[ek] ? { ...e, [ek]: undefined, ...(ek === "quantity" ? { limit: undefined } : {}) } : e))
  }

  /* Brand photos: the drop's current image, product shots, the cover and collection images. */
  const library = (() => {
    const seen = new Set<string>()
    const list: ImageAsset[] = []
    const add = (img: ImageAsset) => {
      if (seen.has(img.src)) return
      seen.add(img.src)
      list.push(img)
    }
    uploads.forEach(add)
    if (existing) add(existing.image)
    products.forEach((p) => p.images.forEach(add))
    add(brand.cover)
    collectionsOf(brandId).forEach((c) => add(c.image))
    return list.slice(0, 18)
  })()

  const sellable = products.filter((p) => p.status !== "archived")
  const otherDropOf = (productId: string) => allDrops.find((d) => d.id !== existing?.id && d.productIds.includes(productId))
  const selectedStock = values.productIds.reduce((n, pid) => n + productStock(products.find((p) => p.id === pid) ?? ({ variants: [] } as never)), 0)

  const releaseUtc = zonedToUtc(values.date, values.time, tz)
  const duration = Number(values.durationHours) || 48
  const quantity = Number(values.quantity)
  const limit = Number(values.limit)
  const image = library.find((i) => i.src === values.imageSrc) ?? null
  const fallbackImage = products.find((p) => values.productIds.includes(p.id))?.images[0] ?? brand.cover

  const previewDrop: Drop = {
    id: existing?.id ?? "d_preview",
    slug: existing?.slug ?? "preview",
    brandId,
    name: values.name.trim() || "Untitled drop",
    description: values.description,
    image: image ?? fallbackImage,
    productIds: values.productIds,
    releaseOffsetHours: ((releaseUtc ?? now + 7 * 24 * HOUR) - anchor) / HOUR,
    durationHours: duration,
    access: values.access,
    limitPerCustomer: Number.isFinite(limit) && limit > 0 ? limit : 1,
    totalUnits: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
    unitsLeft: Math.max(0, (Number.isFinite(quantity) && quantity > 0 ? quantity : 1) - sold),
    sponsored: existing?.sponsored,
  }

  const followers = brand.followers
  const expectedNotify = existing && status !== "draft" ? notifyCount(existing, status ?? "scheduled", followers) : 0
  const demand = Number.isFinite(quantity) && quantity > 0 ? (expectedNotify + 0.1 * followers) / quantity : 0

  function validate(mode: Mode): Errors {
    const e: Errors = {}
    const full = mode === "schedule" || mode === "publish"
    const name = values.name.trim()
    if (!name) e.name = "Give the drop a name."
    else if (name.length > 60) e.name = "Keep the name to 60 characters or fewer."
    const desc = values.description.trim()
    if (full && desc.length < 20) e.description = "Describe the drop in at least 20 characters: what's in it and why it's limited."
    else if (desc.length > 500) e.description = "Keep the description to 500 characters or fewer."
    if (full && values.productIds.length === 0) e.products = "Choose at least one product for the drop."
    if (full && !image) e.image = "Choose a promotional image or upload one."
    if (mode === "schedule") {
      if (!releaseUtc) e.release = "Enter a release date and time."
      else if (releaseUtc < now + MIN_LEAD_MINUTES * 60_000) e.release = `Choose a release time in the future, at least ${MIN_LEAD_MINUTES} minutes from now, so followers get their alert.`
    }
    if (!/^\d+$/.test(values.quantity) || quantity < 1) e.quantity = "Release at least 1 unit."
    else if (quantity > 10_000) e.quantity = "Drops are limited to 10,000 units."
    else if (quantity < sold) e.quantity = `${formatNumber(sold)} units have already sold, so the quantity can't go below that.`
    if (!/^\d+$/.test(values.limit) || limit < 1) e.limit = "Allow at least 1 per customer."
    else if (limit > 10) e.limit = "Keep the limit to 10 or fewer per customer."
    else if (!e.quantity && limit > quantity) e.limit = "The limit can't be more than the quantity."
    return e
  }

  const fieldIds: Record<keyof Errors, string> = { name: "drop-name", description: "drop-description", products: "drop-products", image: "drop-image", release: "drop-date", quantity: "drop-quantity", limit: "drop-limit" }

  function submit(mode: Mode) {
    if (leaving) return
    const e = validate(mode)
    setErrors(e)
    const first = (Object.keys(fieldIds) as (keyof Errors)[]).find((k) => e[k])
    if (first) {
      const el = rootRef.current?.querySelector<HTMLElement>(`#${fieldIds[first]}`)
      el?.scrollIntoView({ behavior: "smooth", block: "center" })
      // The image picker is a radiogroup, which can't take focus: focus its chosen tile, or the first.
      const target = el?.getAttribute("role") === "radiogroup" ? (el.querySelector<HTMLElement>("[role=radio][data-state=checked]") ?? el.querySelector<HTMLElement>("[role=radio]")) : el
      target?.focus({ preventScroll: true })
      return
    }
    if (mode === "publish" && !confirmPublish) {
      setConfirmPublish(true)
      return
    }
    save(mode)
  }

  function save(mode: Mode) {
    if (leaving) return
    setConfirmPublish(false)
    const id = idRef.current
    const release = mode === "publish" ? now : (releaseUtc ?? (existing ? anchor + existing.releaseOffsetHours * HOUR : now + 7 * 24 * HOUR))
    const drop: Drop = {
      ...previewDrop,
      id,
      slug: existing?.slug ?? `${slugify(values.name)}-${id.slice(-4)}`,
      name: values.name.trim(),
      description: values.description.trim(),
      image: image ?? fallbackImage,
      releaseOffsetHours: locked && existing ? existing.releaseOffsetHours : (release - anchor) / HOUR,
      totalUnits: quantity,
      unitsLeft: Math.max(0, quantity - sold),
    }
    upsertDrop(drop)
    setDropMeta(id, { draft: mode === "draft", timeZone: tz, updatedAt: new Date().toISOString() })
    setDirty(false)
    savedRef.current = true

    if (mode === "draft") {
      toast.success("Draft saved", { description: "It stays in Studio until you schedule it." })
      if (!existing) {
        setLeaving(true)
        router.replace(`/studio/drops/${id}`)
      }
      return
    }
    setLeaving(true)
    if (mode === "publish") toast.success("Drop is live in Studio", { description: `${drop.name} is open for ${DURATIONS.find((d) => d.value === values.durationHours)?.label ?? `${duration} hours`}.` })
    else if (mode === "schedule") toast.success(status === "scheduled" ? "Schedule updated" : "Drop scheduled", { description: `${drop.name} releases ${formatInZone(release, tz)} ${zoneAbbr(tz, release)}.` })
    else toast.success("Changes saved", { description: drop.name })
    guard.go("/studio/drops")
  }

  async function onFile(file: File | undefined) {
    if (!file) return
    const problem = imageFileError(file)
    if (problem) {
      setErrors((e) => ({ ...e, image: problem }))
      return
    }
    try {
      const src = await readImage(file, { max: 1400 })
      const asset: ImageAsset = { src, alt: `${values.name.trim() || "Drop"} by ${brand.name}`, width: 1400, height: 1050 }
      setUploads((u) => [asset, ...u])
      // The new tile appears selected in the grid, which is the confirmation.
      set("imageSrc", src)
      setErrors((e) => ({ ...e, image: undefined }))
    } catch {
      setErrors((e) => ({ ...e, image: "That image couldn't be read. Try a JPG, PNG or WebP." }))
    } finally {
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  const userTz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : null
  const zones = zoneOptions(brandTz, userTz, releaseUtc ?? now)
  const otherZones = [
    ...(tz !== brandTz ? [{ label: "Your brand's time", tz: brandTz }] : []),
    ...(userTz && userTz !== tz && userTz !== brandTz ? [{ label: "This device", tz: userTz }] : []),
    ...[countryZone.GB, countryZone.US].filter((z) => z.tz !== tz && z.tz !== userTz && z.tz !== brandTz).map((z) => ({ label: z.city, tz: z.tz })),
  ]

  const publishFocus = useFocusReturn()
  const title = existing ? (status === "draft" ? "Edit draft drop" : locked ? existing.name : "Edit drop") : "Schedule a drop"
  const statusMeta = status ? dropStatusMeta[status] : null

  return (
    <div ref={rootRef} className="grid gap-6">
      <div className="grid gap-2">
        <BackLink href="/studio/drops">Drops</BackLink>
        <PageHeader
          title={title}
          description={locked ? "This drop has been released. Its products, timing, access and quantity are locked; you can still edit how it's presented." : "Pick the products, set a release time and choose who gets access. The preview shows how shoppers will see it."}
          actions={
            // Phones get the same actions in the floating bar at the bottom of the form.
            locked ? (
              <Button type="submit" form="drop-form" variant="primary" size="sm" className="hidden sm:inline-flex" disabled={leaving}>Save changes</Button>
            ) : (
              <div className="hidden items-center gap-2 sm:flex">
                <Button type="button" variant="secondary" size="sm" onClick={() => submit("draft")} disabled={leaving}>
                  {status === "scheduled" ? "Move to drafts" : "Save draft"}
                </Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => submit("publish")} disabled={leaving}>
                  <Rocket /> Publish now
                </Button>
                <Button type="submit" form="drop-form" variant="primary" size="sm" disabled={leaving}>
                  {status === "scheduled" ? "Save schedule" : "Schedule"}
                </Button>
              </div>
            )
          }
        >
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {statusMeta ? <StatusBadge tone={statusMeta.tone}>{statusMeta.label}</StatusBadge> : null}
            <span className="text-xs text-ink-3">
              {dirty ? "Unsaved changes" : meta?.updatedAt ? `Saved ${relativeTime(new Date(meta.updatedAt).getTime(), now)}` : existing ? "Saved" : "New drop, not saved yet"}
            </span>
          </div>
          <p className="mt-2 text-xs text-ink-3">{CATALOGUE_NOTE}</p>
        </PageHeader>
      </div>

      <form id="drop-form" noValidate onSubmit={(e) => { e.preventDefault(); submit(locked ? "save" : "schedule") }} className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid min-w-0 content-start gap-6">
          <Panel title="Details" description="Shown on the drop page and in the notification followers get.">
            <div className="grid gap-4">
              <Field id="drop-name" label="Name" error={errors.name} aside={<span className="text-xs text-ink-3 tabular">{values.name.length}/60</span>}>
                <Input {...control("drop-name", errors.name)} value={values.name} maxLength={80} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Drop 08: Night bus" className={inputClass} />
              </Field>
              <Field id="drop-description" label="Description" error={errors.description} hint="What's in it, how many, and why it's limited. For example: hoodies and tees printed with long exposures of the bridge, 180 pieces across the run.">
                <Textarea {...control("drop-description", errors.description, true)} value={values.description} maxLength={600} onChange={(e) => set("description", e.target.value)} placeholder="e.g. What's in the run and how many" className="min-h-24" />
              </Field>
            </div>
          </Panel>

          <Panel title="Products" description={locked ? "Products can't change after release." : "What's in the drop. Stock is held for the drop from release until it closes."}>
            <Field id="drop-products" label="Products in this drop" as="legend" error={errors.products} hint={values.productIds.length ? `${values.productIds.length} selected, ${formatNumber(selectedStock)} units in stock across them.` : undefined}>
              <ul id="drop-products" tabIndex={-1} className="grid grid-cols-1 gap-1.5 outline-none sm:grid-cols-2">
                {sellable.map((p) => {
                  const on = values.productIds.includes(p.id)
                  const stock = productStock(p)
                  const other = otherDropOf(p.id)
                  const cid = `drop-product-${p.id}`
                  return (
                    <li key={p.id}>
                      <label htmlFor={cid} className={cn("flex cursor-pointer items-center gap-3 rounded-md border p-2 transition-colors", on ? "border-purple/70 bg-purple/10" : "border-line hover:bg-elevated/60", locked && "cursor-not-allowed opacity-70")}>
                        <Checkbox id={cid} checked={on} disabled={locked} aria-invalid={errors.products ? true : undefined} onCheckedChange={(c) => set("productIds", c ? [...values.productIds, p.id] : values.productIds.filter((x) => x !== p.id))} />
                        <span className="relative size-11 shrink-0 overflow-hidden rounded-md bg-surface">
                          <Image src={p.images[0].src} alt="" fill sizes="44px" className="object-cover" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-ink">{p.name}</span>
                          <span className="block truncate text-xs text-ink-3 tabular">
                            {formatMoney(p.price, p.currency)}, {stock ? `${formatNumber(stock)} in stock` : "out of stock"}
                            {other ? `, in ${other.name}` : ""}
                          </span>
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            </Field>
          </Panel>

          <Panel
            title="Promotional image"
            description="Leads the drop card, the drop page and the alert. Landscape works best (4:3)."
            action={
              <>
                <input ref={fileRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => onFile(e.target.files?.[0])} />
                <Button type="button" variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
                  <ImagePlus /> Upload
                </Button>
              </>
            }
          >
            <ChoiceGroup id="drop-image" label="Promotional image" value={values.imageSrc} onValueChange={(v) => { set("imageSrc", v); setErrors((e) => ({ ...e, image: undefined })) }} error={errors.image} className="grid-cols-3 sm:grid-cols-4 lg:grid-cols-6">
              {library.map((img, i) => (
                <ChoiceCard key={img.src} value={img.src} aria-label={img.alt || `Brand photo ${i + 1}`} className="overflow-hidden p-0">
                  <span className="relative block aspect-[4/3] overflow-hidden rounded-[7px]">
                    <Image src={img.src} alt="" fill sizes="(min-width: 1024px) 12vw, 30vw" className="object-cover" />
                    {values.imageSrc === img.src ? (
                      <span className="absolute top-1.5 right-1.5 inline-flex size-5 items-center justify-center rounded-full bg-purple text-ink"><Check className="size-3" /></span>
                    ) : null}
                    {uploads.some((u) => u.src === img.src) ? <span className="glass absolute bottom-1.5 left-1.5 inline-flex h-5 items-center rounded-[4px] px-1.5 text-[10px] text-ink">Uploaded</span> : null}
                  </span>
                </ChoiceCard>
              ))}
            </ChoiceGroup>
            {errors.image ? <p id="drop-image-error" className="mt-2 text-xs text-danger">{errors.image}</p> : <p className="mt-2 text-xs text-ink-3">Photos from your products, cover and collections. Uploads stay in this browser until the store is connected.</p>}
          </Panel>

          <Panel title="Release" description={`Enter the date and time in any zone. It's saved as one moment, and shoppers see the countdown in their own time.`} action={locked ? <LockedNote /> : undefined}>
            {/* One row where the form is wide (lg, and from 1400px beside the preview), a 2×2 grid where the preview
                narrows it. The zone's names are the longest values, so it gets the widest column. */}
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,1fr)] xl:grid-cols-2 min-[87.5rem]:grid-cols-[minmax(0,1.5fr)_minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,1fr)]">
              <Field id="drop-tz" label="Time zone" className="col-span-2 lg:col-span-1" hint={tz === brandTz ? undefined : zoneLongName(tz, releaseUtc ?? now)}>
                <Select value={tz} onValueChange={(v) => set("timeZone", v)} disabled={locked}>
                  <SelectTrigger id="drop-tz" aria-describedby={tz === brandTz ? undefined : "drop-tz-hint"} title={zones.find((z) => z.tz === tz)?.label} className={cn(selectClass, "min-w-0 *:data-[slot=select-value]:block *:data-[slot=select-value]:min-w-0 *:data-[slot=select-value]:truncate")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper" className="max-h-72">
                    {zones.map((z) => (
                      <SelectItem key={z.tz} value={z.tz}>{z.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field id="drop-date" label="Release date" error={errors.release}>
                <Input {...control("drop-date", errors.release)} type="date" disabled={locked} value={values.date} min={todayIn(tz, now)} onChange={(e) => { set("date", e.target.value); setErrors((x) => ({ ...x, release: undefined })) }} className={cn(inputClass, "[color-scheme:dark]")} />
              </Field>
              <Field id="drop-time" label={`Time (${zoneAbbr(tz, releaseUtc ?? now)})`}>
                <Input id="drop-time" type="time" disabled={locked} aria-invalid={errors.release ? true : undefined} aria-describedby={errors.release ? "drop-date-error" : undefined} value={values.time} step={300} onChange={(e) => { set("time", e.target.value); setErrors((x) => ({ ...x, release: undefined })) }} className={cn(inputClass, "[color-scheme:dark]")} />
              </Field>
              <Field id="drop-duration" label="Stays open for" className="col-span-2 lg:col-span-1">
                <Select value={values.durationHours} onValueChange={(v) => set("durationHours", v)} disabled={locked}>
                  <SelectTrigger id="drop-duration" className={selectClass}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    {DURATIONS.map((d) => (
                      <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            {releaseUtc ? (
              <div className="mt-4 grid gap-2 rounded-md border border-line-soft bg-surface/60 p-3 text-xs sm:grid-cols-2">
                <p className="text-ink-2">
                  Releases <span className="text-ink tabular">{formatInZone(releaseUtc, tz)} {zoneAbbr(tz, releaseUtc)}</span>
                  <span className="text-ink-3"> ({relativeTime(releaseUtc, now)})</span>
                </p>
                <p className="text-ink-2">
                  Closes <span className="text-ink tabular">{formatInZone(releaseUtc + duration * HOUR, tz)} {zoneAbbr(tz, releaseUtc + duration * HOUR)}</span>
                </p>
                {otherZones.map((z) => (
                  <p key={z.tz} className="text-ink-3">
                    {z.label}: <span className="text-ink-2 tabular">{formatInZone(releaseUtc, z.tz, { weekday: true })} {zoneAbbr(z.tz, releaseUtc)}</span>
                  </p>
                ))}
              </div>
            ) : null}
          </Panel>

          <Panel title="Access and limits" description="Who can buy, how many each, and how many exist." action={locked ? <LockedNote /> : undefined}>
            <div className="grid gap-5">
              <ChoiceGroup id="drop-access" label="Access" value={values.access} onValueChange={(v) => set("access", v as DropAccess)} className="md:grid-cols-3">
                {ACCESS.map((a) => (
                  <ChoiceCard key={a.value} value={a.value} disabled={locked} className="p-3.5">
                    <a.icon className={cn("size-4", values.access === a.value ? "text-violet" : "text-ink-3")} />
                    <span className="mt-2 block text-sm font-medium text-ink">{a.title}</span>
                    <span className="mt-1 block text-xs leading-relaxed text-ink-2">{a.body}</span>
                  </ChoiceCard>
                ))}
              </ChoiceGroup>
              {!locked && demand > 5 && values.access === "first-come" ? (
                <p className="rounded-md border border-line-soft bg-surface/60 p-3 text-xs text-ink-2">
                  <span className="font-medium text-ink">Demand may outrun units.</span> With {formatNumber(followers)} followers, interest could reach about {formatNumber(Math.round(demand))} times the quantity. A draw keeps it fair and stops the drop selling out in seconds.
                </p>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="drop-quantity" label="Limited quantity" error={errors.quantity} hint={sold ? `${formatNumber(sold)} already sold.` : selectedStock && quantity > selectedStock ? `More than the ${formatNumber(selectedStock)} units in stock. Restock before release.` : "Total units across all sizes."}>
                  <NumberStepper id="drop-quantity" label="quantity" value={values.quantity} onChange={(v) => set("quantity", v)} min={1} max={10_000} step={10} invalid={!!errors.quantity} describedBy={errors.quantity ? "drop-quantity-error" : "drop-quantity-hint"} suffix="units" disabled={locked} />
                </Field>
                <Field id="drop-limit" label="Limit per customer" error={errors.limit} hint="Applies per account, across sizes.">
                  <NumberStepper id="drop-limit" label="limit per customer" value={values.limit} onChange={(v) => set("limit", v)} min={1} max={10} invalid={!!errors.limit} describedBy={errors.limit ? "drop-limit-error" : "drop-limit-hint"} suffix="each" disabled={locked} />
                </Field>
              </div>
            </div>
          </Panel>
        </div>

        <aside aria-label="Preview" className="grid min-w-0 content-start gap-3 xl:sticky xl:top-24 xl:self-start">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-medium text-ink">Preview</h2>
            <span className="text-xs text-ink-3">As shoppers see it on Drops</span>
          </div>
          <div inert className="pointer-events-none select-none">
            <DropCard drop={previewDrop} eager formatRelease={(ms) => `${formatInZone(ms, tz)} ${zoneAbbr(tz, ms)}`} />
          </div>
          <dl className="grid gap-2 rounded-lg border border-line-soft bg-card p-4 text-xs">
            <SummaryRow label="Release" value={releaseUtc ? `${formatInZone(releaseUtc, tz)} ${zoneAbbr(tz, releaseUtc)}` : "Not set"} />
            <SummaryRow label="Open for" value={DURATIONS.find((d) => d.value === values.durationHours)?.label ?? `${duration} hours`} />
            <SummaryRow label="Access" value={dropAccessLabel[values.access]} />
            <SummaryRow label="Units" value={Number.isFinite(quantity) && quantity > 0 ? `${formatNumber(quantity)}, up to ${Number.isFinite(limit) && limit > 0 ? limit : 1} each` : "Not set"} />
            <SummaryRow label="Products" value={values.productIds.length ? String(values.productIds.length) : "None yet"} />
          </dl>
          {releaseUtc ? <p className="text-xs text-ink-3">Shoppers see the countdown in their own time zone. Once the catalogue backend is connected, followers get an alert a day before, an hour before and at release.</p> : null}
        </aside>

        {/* Phones: a floating action bar, so Schedule is in reach anywhere on this long form. */}
        <div data-toast-avoid="" className="glass-strong sticky bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-20 col-span-full flex items-center gap-2 rounded-2xl p-2 sm:hidden">
          {locked ? (
            <Button type="submit" variant="primary" size="sm" className="h-10 flex-1" disabled={leaving}>Save changes</Button>
          ) : (
            <>
              <Button type="button" variant="ghost" size="sm" className="h-10" onClick={() => submit("draft")} disabled={leaving}>
                {status === "scheduled" ? "Unschedule" : "Save draft"}
              </Button>
              <Button type="button" variant="secondary" size="sm" className="h-10" onClick={() => submit("publish")} disabled={leaving}>
                <Rocket /> Go live
              </Button>
              <Button type="submit" variant="primary" size="sm" className="h-10 flex-1" disabled={leaving}>
                {status === "scheduled" ? "Save schedule" : "Schedule"}
              </Button>
            </>
          )}
        </div>

      </form>

      <Dialog open={confirmPublish} onOpenChange={setConfirmPublish}>
        <DialogContent className="sm:max-w-[440px]" {...publishFocus}>
          <DialogHeader>
            <DialogTitle>Publish {values.name.trim() || "this drop"} now?</DialogTitle>
            <DialogDescription className="text-ink-2">
              It goes live in Studio straight away instead of at the scheduled time, with no countdown, and stays open for {DURATIONS.find((d) => d.value === values.durationHours)?.label ?? `${duration} hours`}. Follower alerts go out once the catalogue backend is connected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmPublish(false)}>Not yet</Button>
            <Button variant="primary" onClick={() => save("publish")} disabled={leaving}><Rocket /> Publish now</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {guard.dialog}
    </div>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-3">{label}</dt>
      <dd className="text-right text-ink tabular">{value}</dd>
    </div>
  )
}

function LockedNote() {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-ink-3">
      <Lock className="size-3" /> Locked after release
    </span>
  )
}

