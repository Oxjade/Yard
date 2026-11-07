"use client"

import { useState } from "react"
import { CalendarPlusIcon, DotsThreeVerticalIcon, PencilSimpleIcon, TrashIcon } from "@phosphor-icons/react"
import { toast } from "sonner"
import { dateRangeProblems, outcomeCopy, type LocationEventBody, type StudioEventDto, type StudioLocationDto } from "@/lib/api/contracts/around"
import { createStudioEvent, deleteStudioEvent, updateStudioEvent } from "@/lib/api/around"
import { errorMessage, fieldErrors } from "@/lib/api/errors"
import { dateRange, localParts, zonedTimeToUtc, zoneShort } from "@/lib/around/hours"
import { eventKindLabel, type LocationEventKind } from "@/lib/around/labels"
import { drops } from "@/lib/data/catalog"
import { products } from "@/lib/data/products"
import { MediaUploader } from "@/components/media/media-uploader"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { ConfirmDialog, Field, Panel, Segmented, control, inputClass, selectClass } from "@/components/studio/catalog/fields"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { PhotoList, ProductPicker, type PhotoItem } from "./pickers"
import { placeStatusMeta } from "./status"

type Draft = {
  kind: LocationEventKind
  title: string
  description: string
  startDate: string
  startTime: string
  endDate: string
  endTime: string
  dropId: string
  productIds: string[]
  promoText: string
  image: PhotoItem | null
  visibility: "draft" | "published" | "hidden"
}

const KINDS = Object.keys(eventKindLabel) as LocationEventKind[]

function blank(tz: string): Draft {
  const t = localParts(Date.now() + 86_400_000, tz)
  return { kind: "drop_launch", title: "", description: "", startDate: t.date, startTime: "18:00", endDate: t.date, endTime: "21:00", dropId: "", productIds: [], promoText: "", image: null, visibility: "draft" }
}

function fromEvent(e: StudioEventDto, tz: string): Draft {
  const s = localParts(e.startsAt, tz)
  const en = localParts(e.endsAt, tz)
  return {
    kind: e.kind,
    title: e.title,
    description: e.description ?? "",
    startDate: s.date,
    startTime: s.time,
    endDate: en.date,
    endTime: en.time,
    dropId: e.dropId ?? "",
    productIds: e.productIds,
    promoText: e.promoText ?? "",
    image: e.image?.mediaId ? { mediaId: e.image.mediaId, src: e.image.src, alt: e.image.alt } : null,
    visibility: e.visibility,
  }
}

/**
 * Events at a place (§6.4, after the first save): a list plus an "Add event" sheet. Events follow
 * the same review rules as places; rejected and removed events can only be deleted.
 */
export function EventsSection({ loc, brandId, onChanged, disabled }: { loc: StudioLocationDto; brandId: string; onChanged: (l: StudioLocationDto) => void; disabled?: boolean }) {
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null)
  const [confirm, setConfirm] = useState<StudioEventDto | null>(null)
  const tz = loc.timeZone

  async function remove(e: StudioEventDto) {
    try {
      const r = await deleteStudioEvent(loc.id, e.id)
      onChanged(r.location)
      toast.success(`${e.title} deleted`)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <Panel
      id="events"
      title="Events"
      description="Launches, talks and sales at this place. Published events show under Happening here on Around."
      action={
        <Button type="button" size="sm" variant="secondary" disabled={disabled || loc.locked} onClick={() => setEditing({ id: null, draft: blank(tz) })}>
          <CalendarPlusIcon /> Add event
        </Button>
      }
    >
      {loc.events.length ? (
        <ul className="grid gap-2">
          {loc.events.map((e) => (
            <li key={e.id} className="flex items-start gap-3 rounded-md border border-line-soft p-3">
              <div className="grid min-w-0 flex-1 gap-1">
                <p className="truncate text-sm text-ink">{e.title}</p>
                <p className="text-xs text-ink-2">
                  {eventKindLabel[e.kind]}, {dateRange(e.startsAt, e.endsAt, tz)}
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  <StatusBadge tone={placeStatusMeta[e.status].tone}>{placeStatusMeta[e.status].label}</StatusBadge>
                  {e.promoText ? <span className="text-xs text-ink-2">{e.promoText}</span> : null}
                </div>
                {e.locked && e.moderationReason ? <p className="text-xs text-danger">{e.moderationReason}</p> : null}
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`Actions for ${e.title}`}>
                    <DotsThreeVerticalIcon weight="bold" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {!e.locked ? (
                    <DropdownMenuItem onSelect={() => setEditing({ id: e.id, draft: fromEvent(e, tz) })}>
                      <PencilSimpleIcon /> Edit
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem variant="destructive" onSelect={() => setConfirm(e)}>
                    <TrashIcon /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-md border border-dashed border-line px-3 py-4 text-center text-xs text-ink-2">No events yet. Add a launch, a talk or a sale at this place.</p>
      )}
      <EventSheet
        open={!!editing}
        key={editing ? (editing.id ?? "new") : "closed"}
        initial={editing?.draft ?? blank(tz)}
        eventId={editing?.id ?? null}
        loc={loc}
        brandId={brandId}
        onClose={() => setEditing(null)}
        onSaved={(l) => {
          onChanged(l)
          setEditing(null)
        }}
      />
      <ConfirmDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)} title={`Delete ${confirm?.title ?? "this event"}?`} body="It leaves Yard Around at once. This can't be undone." confirmLabel="Delete" onConfirm={() => confirm && void remove(confirm)} />
    </Panel>
  )
}

function EventSheet({ open, initial, eventId, loc, brandId, onClose, onSaved }: { open: boolean; initial: Draft; eventId: string | null; loc: StudioLocationDto; brandId: string; onClose: () => void; onSaved: (l: StudioLocationDto) => void }) {
  const [d, setD] = useState<Draft>(initial)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [openedAt] = useState(() => Date.now())
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }))
  const tz = loc.timeZone
  const brandDrops = drops.filter((x) => x.brandId === brandId)
  const brandProducts = products.filter((p) => p.brandId === brandId && p.status === "published")

  async function save(e: React.FormEvent) {
    e.preventDefault()
    const errs: Record<string, string> = {}
    if (!d.title.trim()) errs.title = "Give the event a title."
    const startsAt = d.startDate && d.startTime ? zonedTimeToUtc(d.startDate, d.startTime, tz) : NaN
    const endsAt = d.endDate && d.endTime ? zonedTimeToUtc(d.endDate, d.endTime, tz) : NaN
    if (!Number.isFinite(startsAt)) errs.startsAt = "Choose when it starts."
    if (!Number.isFinite(endsAt)) errs.endsAt = "Choose when it ends."
    else if (endsAt <= startsAt) errs.endsAt = "The end has to come after the start."
    // The server's range rules, for dates that change (an old event keeps its saved dates).
    const saved = eventId ? loc.events.find((x) => x.id === eventId) : undefined
    if (Number.isFinite(startsAt) && Number.isFinite(endsAt) && (!saved || Date.parse(saved.startsAt) !== startsAt || Date.parse(saved.endsAt) !== endsAt))
      for (const [k, v] of Object.entries(dateRangeProblems(startsAt, endsAt, Date.now(), "Events"))) errs[k] ??= v
    if (d.image && !d.image.alt.trim()) errs["image.alt"] = "Describe the photo for people who can't see it."
    setErrors(errs)
    if (Object.keys(errs).length) {
      document.getElementById(`ev-${Object.keys(errs)[0].split(".")[0]}`)?.focus()
      return
    }
    const body: LocationEventBody = {
      kind: d.kind,
      title: d.title.trim(),
      description: d.description.trim() || null,
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(endsAt).toISOString(),
      dropId: d.dropId || null,
      productIds: d.productIds,
      promoText: d.promoText.trim() || null,
      image: d.image ? { mediaId: d.image.mediaId, alt: d.image.alt.trim() } : null,
      visibility: d.visibility,
    }
    setSaving(true)
    try {
      const r = eventId ? await updateStudioEvent(loc.id, eventId, body) : await createStudioEvent(loc.id, body)
      toast.success(r.outcome ? outcomeCopy[r.outcome].replace("this place", "this event").replace("new places", "new events") : "Saved.")
      onSaved(r.location)
    } catch (err) {
      const f = fieldErrors(err)
      setErrors(f)
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="gap-0 border-line-soft bg-surface p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[480px]">
        <form noValidate onSubmit={save} className="flex min-h-0 flex-1 flex-col">
          <SheetHeader className="border-b border-line-soft p-4 pr-12 md:p-5 md:pr-12">
            <SheetTitle className="text-[15px] text-ink">{eventId ? "Edit event" : "Add event"}</SheetTitle>
            <SheetDescription className="text-xs text-ink-2">At {loc.name}. Times are {loc.city} time ({zoneShort(tz, openedAt)}).</SheetDescription>
          </SheetHeader>
          <div className="grid flex-1 content-start gap-4 overflow-y-auto p-4 md:p-5">
            <Field id="ev-kind" label="Kind">
              <Select value={d.kind} onValueChange={(v) => set("kind", v as LocationEventKind)}>
                <SelectTrigger id="ev-kind" className={selectClass}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  {KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {eventKindLabel[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field id="ev-title" label="Title" error={errors.title}>
              <Input {...control("ev-title", errors.title)} value={d.title} maxLength={80} onChange={(e) => set("title", e.target.value)} className={inputClass} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field id="ev-startsAt" label="Starts" error={errors.startsAt}>
                <Input {...control("ev-startsAt", errors.startsAt)} type="date" value={d.startDate} onChange={(e) => set("startDate", e.target.value)} className={inputClass} />
              </Field>
              <Field id="ev-start-time" label="At">
                <Input id="ev-start-time" type="time" value={d.startTime} onChange={(e) => set("startTime", e.target.value)} className={inputClass} />
              </Field>
              <Field id="ev-endsAt" label="Ends" error={errors.endsAt}>
                <Input {...control("ev-endsAt", errors.endsAt)} type="date" value={d.endDate} onChange={(e) => set("endDate", e.target.value)} className={inputClass} />
              </Field>
              <Field id="ev-end-time" label="At">
                <Input id="ev-end-time" type="time" value={d.endTime} onChange={(e) => set("endTime", e.target.value)} className={inputClass} />
              </Field>
            </div>
            <Field id="ev-description" label="Description" optional error={errors.description}>
              <Textarea id="ev-description" value={d.description} maxLength={600} onChange={(e) => set("description", e.target.value)} rows={3} />
            </Field>
            <Field id="ev-dropId" label="Linked drop" optional error={errors.dropId}>
              <Select value={d.dropId || "none"} onValueChange={(v) => set("dropId", v === "none" ? "" : v)}>
                <SelectTrigger id="ev-dropId" className={selectClass}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="none">No drop</SelectItem>
                  {brandDrops.map((x) => (
                    <SelectItem key={x.id} value={x.id}>
                      {x.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field id="ev-promoText" label="Offer" optional hint="For example: 20% off samples. Shown with the event." error={errors.promoText}>
              <Input id="ev-promoText" value={d.promoText} maxLength={120} onChange={(e) => set("promoText", e.target.value)} className={inputClass} />
            </Field>
            <ProductPicker id="ev-products" legend="Pieces at this event" max={8} products={brandProducts} value={d.productIds} onChange={(v) => set("productIds", v)} error={errors["productIds.0"]} />
            <div className="grid gap-2">
              <p className="text-[13px] text-ink">Photo</p>
              {d.image ? (
                <PhotoList items={[d.image]} onChange={(items) => set("image", items[0] ?? null)} errors={{ "images.0.alt": errors["image.alt"] ?? errors["image.mediaId"] ?? "" }} />
              ) : (
                <MediaUploader purpose="location_image" as="brand" maxFiles={1} onUploaded={(m) => set("image", { mediaId: m.id, src: m.src, alt: "" })} />
              )}
            </div>
            <div className="grid gap-1.5">
              <p id="ev-visibility-label" className="text-[13px] text-ink">
                Visibility
              </p>
              <Segmented
                id="ev-visibility"
                label="Visibility"
                labelledBy="ev-visibility-label"
                value={d.visibility}
                onChange={(v) => set("visibility", v)}
                options={[
                  { value: "draft", label: "Draft" },
                  { value: "published", label: "Published" },
                  { value: "hidden", label: "Hidden" },
                ]}
              />
            </div>
          </div>
          <SheetFooter className="flex-row justify-end border-t border-line-soft p-4">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={saving}>
              {eventId ? "Save event" : "Add event"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
