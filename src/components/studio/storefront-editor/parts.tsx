"use client"

import { MonitorIcon as Monitor, DeviceMobileIcon as Smartphone } from "@phosphor-icons/react"
import { PageHeader } from "@/components/dashboard/page-header"
import { Segmented } from "@/components/studio/catalog/fields"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import type { Device } from "./preview-frame"

export const EDITOR_TITLE = "Storefront"
export const EDITOR_DESCRIPTION = "Edit a private draft and watch it update. Shoppers see it when you publish."

/**
 * From lg the editor fills the window under the Studio shell. 8.5rem is the shell's chrome:
 * TopBar (pt-3 + h-16 = 4.75rem, dashboard/shell/top-bar.tsx) plus main's padding (pt-5 +
 * md:pb-10 = 3.75rem, dashboard/app-shell.tsx). Change it with those.
 */
export const editorFrame = "grid gap-6 pb-24 lg:h-[calc(100dvh-8.5rem)] lg:grid-rows-[auto_minmax(0,1fr)] lg:pb-0"

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

/**
 * Where the draft stands. "saving": an edit is waiting for the autosave a moment later.
 * "unsaved": that save failed (storage full), so the edit exists only on this page.
 */
export type SaveState = "saving" | "unsaved" | "unpublished" | "published"

/**
 * Where the draft stands, in the Studio status badge's tones. `short` is for the phone bar,
 * where it sits beside Preview and Publish (or View storefront) and must not be cut off.
 */
export const storefrontStatusMeta: Record<SaveState, { label: string; short: string; tone: "attention" | "info" | "success" | "muted" }> = {
  saving: { label: "Saving draft", short: "Saving", tone: "muted" },
  unsaved: { label: "Unsaved changes", short: "Not saved", tone: "attention" },
  unpublished: { label: "Draft saved, not published", short: "Draft saved", tone: "info" },
  published: { label: "All changes published", short: "Published", tone: "success" },
}

/** The route's loading state: the real header over the editor's skeleton, in the editor's frame. */
export function StorefrontEditorLoading() {
  return (
    <div className={editorFrame}>
      <PageHeader title={EDITOR_TITLE} description={EDITOR_DESCRIPTION} />
      <EditorSkeleton />
    </div>
  )
}

/** Shown until this browser's saved draft has loaded, so sample data never flashes in first. */
export function EditorSkeleton() {
  return (
    <div role="status" aria-label="Loading the storefront editor" className="grid min-h-0 gap-4 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[340px_minmax(0,1fr)] xl:gap-6">
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
