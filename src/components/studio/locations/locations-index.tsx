"use client"

import { useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowUpRightIcon, CopyIcon, DotsThreeVerticalIcon, EyeIcon, EyeSlashIcon, MapPinIcon, PencilSimpleIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react"
import { toast } from "sonner"
import { outcomeCopy, type StudioLocationDto, type StudioLocationsResult } from "@/lib/api/contracts/around"
import { deleteStudioLocation, duplicateStudioLocation, listStudioLocations, STUDIO_LOCATIONS_KEY, updateStudioLocation } from "@/lib/api/around"
import { errorMessage } from "@/lib/api/errors"
import { useApi } from "@/lib/api/use-api"
import { dateRange, dayTimeIn } from "@/lib/around/hours"
import { kindLabel, safePlaceSrc } from "@/lib/around/labels"
import { useNow } from "@/hooks/use-now"
import { EmptyState } from "@/components/dashboard/empty-state"
import { PageHeader } from "@/components/dashboard/page-header"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { SessionGate } from "@/components/session/session-gate"
import { ConfirmDialog } from "@/components/studio/catalog/fields"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { SampleChip } from "@/components/ui/sample-chip"
import { cn } from "@/lib/utils"
import { locationsDescription, placeStatusMeta } from "./status"

/**
 * Studio › Locations (§6.4): the brand's places as cards with their status, next event and
 * actions. Server data through /api/studio/locations; loading is card-shaped, a failure says so
 * with Retry, and an empty brand is told plainly it's online-only on Around.
 */
export function LocationsIndex() {
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Locations"
        description={locationsDescription}
        actions={
          <Button asChild variant="primary" size="sm">
            <Link href="/studio/locations/new">
              <PlusIcon /> Add location
            </Link>
          </Button>
        }
      />
      <SessionGate surface="studio" permission="locations.manage" feature="Locations">
        <LocationsList />
      </SessionGate>
    </div>
  )
}

function LocationsList() {
  const { data, error, isLoading, revalidate, mutate } = useApi<StudioLocationsResult>(STUDIO_LOCATIONS_KEY, () => listStudioLocations())
  const now = useNow(30_000)

  if (error && !data) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border border-line-soft bg-card p-5">
        <p className="text-sm text-ink">Couldn&apos;t load your locations.</p>
        <p className="text-xs text-ink-2">{errorMessage(error)}</p>
        <Button size="sm" variant="secondary" onClick={() => void revalidate()}>
          Retry
        </Button>
      </div>
    )
  }
  if (isLoading || !data || now === null) return <LocationsSkeleton />
  if (!data.locations.length) {
    return (
      <EmptyState
        icon={MapPinIcon}
        title="You're online-only on Around"
        body="Add a store, showroom or pop-up to appear on the map. Online-only brands never show as physical stores."
        action={
          <Button asChild size="sm" variant="secondary">
            <Link href="/studio/locations/new">
              <PlusIcon /> Add location
            </Link>
          </Button>
        }
      />
    )
  }
  const replace = (loc: StudioLocationDto) => mutate((cur) => (cur ? { ...cur, locations: cur.locations.map((l) => (l.id === loc.id ? loc : l)) } : cur))
  return (
    <div className="grid gap-3">
      {!data.brand.verified ? (
        <p className="rounded-lg border border-line-soft bg-card px-4 py-3 text-xs text-ink-2">
          {data.brand.name} isn&apos;t verified yet, so Yard reviews each place and event before it shows on Around.
        </p>
      ) : null}
      <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3" aria-label="Your places">
        {data.locations.map((l) => (
          <li key={l.id}>
            <LocationCard
              loc={l}
              now={now}
              onChanged={replace}
              onAdded={(loc) => mutate((cur) => (cur ? { ...cur, locations: [loc, ...cur.locations] } : cur))}
              onDeleted={(id) => mutate((cur) => (cur ? { ...cur, locations: cur.locations.filter((x) => x.id !== id) } : cur))}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}

export function LocationsSkeleton() {
  return (
    <div role="status" aria-label="Loading your locations" className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex gap-3 rounded-lg border border-line-soft bg-card p-3">
          <span className="skeleton block size-20 shrink-0 rounded-md" />
          <span className="grid flex-1 content-start gap-2 pt-1">
            <span className="skeleton block h-4 w-2/3 rounded" />
            <span className="skeleton block h-3 w-1/2 rounded" />
            <span className="skeleton block h-5 w-20 rounded" />
          </span>
        </div>
      ))}
    </div>
  )
}

function Thumb({ loc }: { loc: StudioLocationDto }) {
  const src = safePlaceSrc(loc.images[0]?.src)
  return (
    <span className="relative size-20 shrink-0 overflow-hidden rounded-md bg-surface">
      {src ? (
        src.startsWith("/api/media/") ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" className="absolute inset-0 size-full object-cover" loading="lazy" />
        ) : (
          <Image src={src} alt="" fill sizes="80px" className="object-cover" />
        )
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-ink-3">
          <MapPinIcon className="size-5" aria-hidden />
        </span>
      )}
    </span>
  )
}

function LocationCard({ loc, now, onChanged, onAdded, onDeleted }: { loc: StudioLocationDto; now: number; onChanged: (l: StudioLocationDto) => void; onAdded: (l: StudioLocationDto) => void; onDeleted: (id: string) => void }) {
  const router = useRouter()
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState<"visibility" | "duplicate" | "delete" | null>(null)
  const meta = placeStatusMeta[loc.status]
  const nextEvent = loc.events.find((e) => Date.parse(e.endsAt) > now && (e.status === "published" || e.status === "in_review"))
  const where = [loc.neighbourhood, loc.city].filter(Boolean).join(", ")
  const ended = loc.status === "ended"

  async function setVisibility(v: "published" | "hidden") {
    setBusy("visibility")
    try {
      const r = await updateStudioLocation(loc.id, { visibility: v })
      onChanged(r.location)
      toast.success(r.outcome ? outcomeCopy[r.outcome] : "Saved.")
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }
  async function duplicate() {
    setBusy("duplicate")
    try {
      const r = await duplicateStudioLocation(loc.id)
      onAdded(r.location)
      toast.success("Draft copy created", { description: loc.kind === "popup" || loc.kind === "exhibition" ? "Check the new dates, then publish." : "Edit it, then publish." })
      router.push(`/studio/locations/edit?id=${encodeURIComponent(r.location.id)}`)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }
  async function remove() {
    setBusy("delete")
    try {
      await deleteStudioLocation(loc.id)
      onDeleted(loc.id)
      toast.success(`${loc.name} deleted`)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const editHref = `/studio/locations/edit?id=${encodeURIComponent(loc.id)}`
  return (
    <article className={cn("flex h-full gap-3 rounded-lg border border-line-soft bg-card p-3", loc.locked && "border-danger/25")} data-location={loc.id}>
      <Thumb loc={loc} />
      <div className="grid min-w-0 flex-1 content-start gap-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {loc.locked ? (
              <p className="truncate text-sm font-medium text-ink">{loc.name}</p>
            ) : (
              <Link href={editHref} className="block truncate text-sm font-medium text-ink hover:text-violet">
                {loc.name}
              </Link>
            )}
            <p className="truncate text-xs text-ink-2">
              {kindLabel[loc.kind]} in {where}
            </p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${loc.name}`} disabled={!!busy} className="-mt-1 -mr-1 shrink-0">
                <DotsThreeVerticalIcon weight="bold" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              {!loc.locked ? (
                <DropdownMenuItem onSelect={() => router.push(editHref)}>
                  <PencilSimpleIcon /> Edit
                </DropdownMenuItem>
              ) : null}
              {!loc.locked && !ended ? (
                loc.visibility === "published" ? (
                  <DropdownMenuItem onSelect={() => void setVisibility("hidden")}>
                    <EyeSlashIcon /> Hide from Around
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onSelect={() => void setVisibility("published")}>
                    <EyeIcon /> Publish
                  </DropdownMenuItem>
                )
              ) : null}
              {loc.canDuplicate ? (
                <DropdownMenuItem onSelect={() => void duplicate()}>
                  <CopyIcon /> Duplicate
                </DropdownMenuItem>
              ) : null}
              {loc.status === "published" ? (
                <DropdownMenuItem asChild>
                  <Link href={`/around?place=${encodeURIComponent(loc.id)}`}>
                    <ArrowUpRightIcon /> View on Around
                  </Link>
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirm(true)}>
                <TrashIcon /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <p className="truncate text-xs text-ink-3">{loc.addressLine}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
          {loc.sample ? <SampleChip label="Sample place" /> : null}
          {loc.pinPrecision === "area" && !loc.sample ? <span className="text-[11px] text-ink-3">Area pin</span> : null}
        </div>
        {loc.locked && loc.moderationReason ? <p className="text-xs text-danger">{loc.status === "removed" ? `Yard removed this place: ${loc.moderationReason}.` : `Yard rejected this place: ${loc.moderationReason}.`}</p> : null}
        {loc.status === "in_review" ? <p className="text-xs text-ink-2">Yard is reviewing it. It shows on Around once approved.</p> : null}
        {(loc.kind === "popup" || loc.kind === "exhibition") && loc.startsAt && loc.endsAt ? <p className="text-xs text-ink-2">{dateRange(loc.startsAt, loc.endsAt, loc.timeZone)}</p> : null}
        {nextEvent ? <p className="truncate text-xs text-violet">Next: {nextEvent.title}, {dayTimeIn(nextEvent.startsAt, loc.timeZone)}</p> : null}
        {ended || loc.status === "rejected" ? (
          <div className="mt-1 flex gap-2">
            {ended || loc.canDuplicate ? (
              <Button size="sm" variant="secondary" loading={busy === "duplicate"} onClick={() => void duplicate()}>
                <CopyIcon /> Duplicate
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Delete ${loc.name}?`}
        body={loc.status === "published" ? "It leaves Yard Around at once, with its events. This can't be undone." : "Its events are deleted too. This can't be undone."}
        confirmLabel="Delete"
        onConfirm={() => void remove()}
      />
    </article>
  )
}
