"use client"

import { MonitorIcon as Monitor, DeviceMobileIcon as Smartphone } from "@phosphor-icons/react"
import { Segmented } from "@/components/studio/catalog/fields"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import type { Device } from "./preview-frame"

/**
 * One group of controls inside the editor panel: Panel's title and sub-copy, as a divided
 * section of the one tabbed card instead of a card of its own.
 */
export function ControlGroup({ id, title, description, action, children, className }: { id: string; title: string; description?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section id={`${id}-group`} aria-labelledby={`${id}-title`} className={cn("scroll-mt-4 border-t border-line-soft p-4 first:border-t-0 md:p-5", className)}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={`${id}-title`} className="text-sm font-medium text-ink">{title}</h2>
          {description ? <p className="mt-0.5 text-xs text-ink-2">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

/** Desktop or phone-width preview: the shared Segmented control, its items trimmed to the header buttons' 32px. */
export function DeviceToggle({ value, onChange, className }: { value: Device; onChange: (v: Device) => void; className?: string }) {
  return (
    <Segmented
      id="sf-device"
      label="Preview size"
      value={value}
      onChange={onChange}
      className={cn("w-fit rounded-md bg-surface p-0.5 *:h-6.5!", className)}
      options={[
        {
          value: "desktop",
          label: (
            <>
              <Monitor className="size-3.5" aria-hidden />
              <span className="sr-only xl:not-sr-only">Desktop</span>
            </>
          ),
        },
        {
          value: "mobile",
          label: (
            <>
              <Smartphone className="size-3.5" aria-hidden />
              <span className="sr-only xl:not-sr-only">Mobile</span>
            </>
          ),
        },
      ]}
    />
  )
}

export type SaveState = "unsaved" | "unpublished" | "published"

/** Where the draft stands, in the Studio status badge's tones. */
export const storefrontStatusMeta: Record<SaveState, { label: string; tone: "attention" | "info" | "success" }> = {
  unsaved: { label: "Unsaved changes", tone: "attention" },
  unpublished: { label: "Saved, not published", tone: "info" },
  published: { label: "All changes published", tone: "success" },
}

/** Shown until this browser's saved draft has loaded, so sample data never flashes in first. */
export function EditorSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading" className="grid min-h-0 gap-6 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[340px_minmax(0,1fr)]">
      <div className="rounded-lg border border-line-soft bg-card">
        <div className="flex gap-1 border-b border-line-soft p-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-8 flex-1 bg-elevated" />
          ))}
        </div>
        <div className="grid gap-3 p-4 md:p-5">
          <Skeleton className="h-3.5 w-24 bg-elevated" />
          <Skeleton className="h-3 w-48 bg-elevated/70" />
          <div className="mt-2 grid grid-cols-2 gap-3">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="aspect-[4/3] bg-elevated" />
            ))}
          </div>
          <Skeleton className="mt-4 h-3.5 w-28 bg-elevated" />
          <div className="grid grid-cols-6 gap-1.5">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="aspect-square rounded-full bg-elevated" />
            ))}
          </div>
        </div>
      </div>
      <div className="hidden overflow-hidden rounded-lg border border-line-soft bg-surface lg:block">
        <Skeleton className="h-[420px] rounded-none bg-card" />
        <div className="grid grid-cols-4 gap-3 p-6">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="aspect-[4/5] bg-card" />
          ))}
        </div>
      </div>
    </div>
  )
}
