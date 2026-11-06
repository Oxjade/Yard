"use client"

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { motion } from "motion/react"
import { ArrowUpRightIcon as ArrowUpRight, EyeIcon as Eye } from "@phosphor-icons/react"
import { Tabs as TabsPrimitive } from "radix-ui"
import { toast } from "sonner"
import { PageHeader } from "@/components/dashboard/page-header"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { ConfirmDialog, useReturnFocus } from "@/components/studio/catalog/fields"
import { useBrandCollections, useCatalogReady } from "@/components/studio/catalog/store"
import { formatDateTime } from "@/components/studio/catalog/utils"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useAsyncAction } from "@/hooks/use-async-action"
import { storiesOf } from "@/lib/data"
import { brandById } from "@/lib/data/brands"
import type { StorefrontSection } from "@/lib/data/types"
import { useStudio } from "@/lib/stores/studio"
import { cn } from "@/lib/utils"
import { ContentControls, type Update } from "./content-controls"
import { DesignControls } from "./design-controls"
import {
  brandForPreview,
  brandPhotos,
  changeSummary,
  fieldControlId,
  fieldTab,
  fingerprint,
  normalize,
  validate,
  type EditorConfig,
  type FieldKey,
} from "./model"
import { DeviceToggle, EDITOR_DESCRIPTION, EDITOR_TITLE, EditorSkeleton, editorFrame, storefrontStatusMeta, type SaveState } from "./parts"
import { PreviewFrame, scrollPreviewTo, sectionDomId, type Device } from "./preview-frame"
import { SectionsControls } from "./sections-controls"

const AUTOSAVE_MS = 900
const TITLE = EDITOR_TITLE
const DESCRIPTION = EDITOR_DESCRIPTION

type Tab = "design" | "content" | "sections"
const tabs: { value: Tab; label: string }[] = [
  { value: "design", label: "Design" },
  { value: "content", label: "Content" },
  { value: "sections", label: "Sections" },
]
/** The order errors are reported in, top of the panel first. */
const errorOrder: FieldKey[] = ["mark-text", "cover-alt", "intro", "announcement-text", "announcement-href", "instagram", "tiktok", "x", "website", "sections"]

/**
 * An upload previews from an object URL for a moment before its data URL is ready. If the
 * page closed in that moment, the saved URL no longer resolves: fall back to the brand's own.
 */
function withoutStaleUploads(config: EditorConfig): EditorConfig {
  const next = { ...config }
  if (next.cover?.src.startsWith("blob:")) delete next.cover
  if (next.logo?.kind === "image" && next.logo.image.src.startsWith("blob:")) delete next.logo
  return next
}

function listJoin(items: string[]) {
  if (items.length <= 1) return items.join("")
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`
}

const WIDE = "(min-width: 1024px)"

/**
 * Whether the preview pane has room beside the controls (lg and up). Below that the preview
 * opens in a sheet instead, so only one storefront renders at a time (its section ids are
 * unique) and phones don't render a hidden copy. The editor mounts only on the client, after
 * the saved draft loads, so this never disagrees with server HTML.
 */
function useWide() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(WIDE)
      m.addEventListener("change", cb)
      return () => m.removeEventListener("change", cb)
    },
    () => window.matchMedia(WIDE).matches,
    () => false,
  )
}

/**
 * Brand Studio's storefront editor: controls on the left, the real storefront renderer on
 * the right, a toolbar on top. Edits land in a working copy at once (so the preview is live)
 * and autosave to the Studio draft; publishing copies the draft to the live storefront.
 */
export function StorefrontEditor() {
  const ready = useCatalogReady()
  return (
    // From lg the editor fills the window under the Studio shell (see editorFrame).
    <div className={editorFrame}>
      {ready ? (
        <Editor />
      ) : (
        <>
          <PageHeader title={TITLE} description={DESCRIPTION} />
          <EditorSkeleton />
        </>
      )}
    </div>
  )
}

function Editor() {
  const brandId = useStudio((s) => s.brandId)
  const brand = brandById.get(brandId)!
  const storefront = useStudio((s) => s.storefront)
  const saveDraft = useStudio((s) => s.saveStorefrontDraft)
  const publishStorefront = useStudio((s) => s.publishStorefront)
  const discardDraft = useStudio((s) => s.discardStorefrontDraft)
  const studioProducts = useStudio((s) => s.products)
  const drops = useStudio((s) => s.drops)
  const collections = useBrandCollections(brandId)

  const products = useMemo(() => studioProducts.filter((p) => p.status === "published"), [studioProducts])
  const stories = useMemo(() => storiesOf(brandId), [brandId])
  const photos = useMemo(() => brandPhotos(brand, studioProducts, collections, drops, stories), [brand, studioProducts, collections, drops, stories])

  /* ---------- Working copy and autosave ---------- */

  const [config, setConfig] = useState<EditorConfig>(() => withoutStaleUploads(normalize(storefront.draft as EditorConfig, brand)))
  const latest = useRef(config)
  const timer = useRef<number | null>(null)
  /** The last autosave failed: the edit exists only on this page until a save succeeds. */
  const [saveFailed, setSaveFailed] = useState(false)

  const flush = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = null
    try {
      saveDraft(latest.current)
      setSaveFailed(false)
      return true
    } catch {
      setSaveFailed(true)
      toast.error("Your draft couldn't be saved", { id: "sf-save-failed", description: "This browser's storage is full. Use a smaller image, or remove an upload, then save again." })
      return false
    }
  }, [saveDraft])

  const update: Update = useCallback(
    (patch) => {
      setConfig((prev) => {
        const p = typeof patch === "function" ? patch(prev) : patch
        if (!Object.keys(p).length) return prev
        const next = normalize({ ...prev, ...p }, brand)
        latest.current = next
        return next
      })
      if (timer.current) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(flush, AUTOSAVE_MS)
    },
    [brand, flush],
  )

  // Nothing typed is lost: save on the way out, whether by navigation, reload or closing the tab.
  useEffect(() => {
    const onHide = () => {
      if (timer.current) flush()
    }
    window.addEventListener("pagehide", onHide)
    window.addEventListener("beforeunload", onHide)
    return () => {
      window.removeEventListener("pagehide", onHide)
      window.removeEventListener("beforeunload", onHide)
      onHide()
    }
  }, [flush])

  /* ---------- Where the draft stands ---------- */

  const storedFp = useMemo(() => fingerprint(normalize(storefront.draft as EditorConfig, brand)), [storefront.draft, brand])
  const live = useMemo(() => normalize(storefront.published as EditorConfig, brand), [storefront.published, brand])
  const liveFp = useMemo(() => fingerprint(live), [live])
  const configFp = useMemo(() => fingerprint(config), [config])
  const state: SaveState = configFp !== storedFp ? (saveFailed ? "unsaved" : "saving") : configFp !== liveFp ? "unpublished" : "published"
  const hasDraftChanges = configFp !== liveFp

  /* ---------- Validation: on publish, then live while fixing ---------- */

  const [submitted, setSubmitted] = useState(false)
  const errors = useMemo(() => (submitted ? validate(config, brand) : {}), [submitted, config, brand])
  const tabErrors = useMemo(() => {
    const out: Partial<Record<Tab, number>> = {}
    for (const k of Object.keys(errors) as FieldKey[]) out[fieldTab[k]] = (out[fieldTab[k]] ?? 0) + 1
    return out
  }, [errors])

  /* ---------- Panel, preview ---------- */

  const [tab, setTab] = useState<Tab>("design")
  const [device, setDevice] = useState<Device>("desktop")
  const [highlight, setHighlight] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [resetKey, setResetKey] = useState(0)
  const previewRef = useRef<HTMLDivElement>(null)
  const wide = useWide()
  // The pane takes over at lg: close the phone sheet if the window grows past it.
  if (wide && sheetOpen) setSheetOpen(false)

  const previewConfig = useDeferredValue(config)
  const previewBrand = useMemo(() => brandForPreview(brand, previewConfig), [brand, previewConfig])

  const locate = useCallback((section: StorefrontSection) => {
    // Give the deferred preview a moment to render a section that was just switched on.
    window.setTimeout(() => scrollPreviewTo(previewRef.current, sectionDomId(section)), 80)
  }, [])

  function goToField(key: FieldKey) {
    setTab(fieldTab[key])
    window.setTimeout(() => {
      const el = document.getElementById(fieldControlId[key])
      el?.scrollIntoView({ block: "center", behavior: "smooth" })
      el?.focus({ preventScroll: true })
    }, 60)
  }

  /* ---------- Actions ---------- */

  // Autosave keeps the draft current; this saves now. The badge and the button's check say it worked.
  const saveNow = useAsyncAction(
    () => {
      if (timer.current) window.clearTimeout(timer.current)
      timer.current = null
      saveDraft(latest.current)
      setSaveFailed(false)
    },
    {
      error: "Your draft couldn't be saved. This browser's storage is full: use a smaller image, or remove an upload, then try again.",
      onError: () => setSaveFailed(true),
    },
  )

  function onSaveDraft() {
    if (state === "saving" || state === "unsaved") void saveNow.run()
  }

  // Publishing goes through the shared action pattern: one run at a time, then a brief check.
  const publish = useAsyncAction(() => {
    const changed = changeSummary(config, live)
    publishStorefront()
    setSubmitted(false)
    // Below lg the bottom bar says it in place (its badge, Publish's check, then View
    // storefront), and a toast there would sit over that bar. From lg, say what changed.
    if (!window.matchMedia(WIDE).matches) return
    toast.success("Storefront published", {
      description: changed.length ? `Your storefront in this browser shows the new ${listJoin(changed)}. Other shoppers see it once publishing is connected.` : "Your storefront is up to date.",
      action: { label: "View", onClick: () => window.open(`/brands/${brand.handle}`, "_blank", "noopener,noreferrer") },
    })
  })

  function onPublish() {
    if (!hasDraftChanges) return
    const found = validate(config, brand)
    const keys = errorOrder.filter((k) => found[k])
    if (keys.length) {
      setSubmitted(true)
      goToField(keys[0])
      // The field opens with its message beside it and each tab counts what's left to fix.
      // Below lg that's the whole story: a toast would cover the bottom bar.
      if (wide) toast.error(keys.length === 1 ? "Fix 1 field before publishing" : `Fix ${keys.length} fields before publishing`, { description: found[keys[0]] })
      return
    }
    if (!flush()) return
    void publish.run()
  }

  function onDiscard() {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = null
    discardDraft()
    latest.current = live
    setConfig(live)
    setSubmitted(false)
    setSaveFailed(false)
    setResetKey((k) => k + 1)
    // No toast: the controls and preview go back to the live storefront and the badge reads "All changes published".
  }

  // ⌘S / Ctrl+S saves the draft.
  const saveShortcut = useRef(onSaveDraft)
  useEffect(() => {
    saveShortcut.current = onSaveDraft
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault()
        saveShortcut.current()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const status = storefrontStatusMeta[state]
  /** Phones: once everything is live (and Publish has shown its check), the bar offers the storefront instead. */
  const nothingToPublish = !hasDraftChanges && !publish.pending && !publish.succeeded
  /** Where focus lands when the control that opened an overlay is gone or disabled: the open settings tab. */
  const toSelectedTab = () => document.querySelector<HTMLElement>('[aria-label="Settings"] [role="tab"][aria-selected="true"]')
  const onSheetCloseFocus = useReturnFocus(sheetOpen, toSelectedTab)
  const stamps = [
    state === "unpublished" && storefront.savedAt ? `Draft saved ${formatDateTime(storefront.savedAt)}` : null,
    storefront.publishedAt ? `Last published ${formatDateTime(storefront.publishedAt)}` : null,
  ].filter((t): t is string => !!t)

  const renderer = {
    brand: previewBrand,
    config: previewConfig,
    products,
    collections,
    drops,
    stories,
  }

  return (
    <>
      <PageHeader
        title={TITLE}
        description={DESCRIPTION}
        actions={
          <div className="flex items-center gap-2">
            {wide ? <DeviceToggle value={device} onChange={setDevice} /> : null}
            <Button type="button" variant="secondary" size="sm" className="h-10 md:h-8" disabled={!hasDraftChanges || publish.pending} onClick={() => setDiscardOpen(true)}>
              Discard
            </Button>
            {/* Enabled while an edit waits for autosave (or a save failed); afterwards it rests disabled. */}
            <Button type="button" variant="secondary" size="sm" className="h-10 md:h-8" disabled={state !== "saving" && state !== "unsaved" && !saveNow.succeeded} loading={saveNow.pending} success={saveNow.succeeded} onClick={onSaveDraft}>
              Save draft
            </Button>
            {/* Phones carry Publish in the bar at the bottom: one acid button on screen. */}
            <Button type="button" variant="primary" size="sm" className="max-lg:hidden" disabled={!hasDraftChanges && !publish.succeeded} loading={publish.pending} success={publish.succeeded} onClick={onPublish}>
              Publish changes
            </Button>
          </div>
        }
      >
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          {/* Announced when it settles, not on every keystroke's "Saving draft". */}
          <span role="status" aria-live="polite" aria-atomic>
            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          </span>
          {stamps.map((t) => (
            <span key={t} className="text-xs text-ink-3 tabular">
              {t}
            </span>
          ))}
          <Link href={`/brands/${brand.handle}`} target="_blank" className="inline-flex items-center gap-1 rounded-sm text-xs text-violet hover:underline">
            View storefront
            <ArrowUpRight className="size-3.5" aria-hidden />
            <span className="sr-only">(opens in a new tab)</span>
          </Link>
        </div>
      </PageHeader>

      <div className="grid min-h-0 gap-4 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[340px_minmax(0,1fr)] xl:gap-6">
        <TabsPrimitive.Root value={tab} onValueChange={(v) => setTab(v as Tab)} asChild>
          <aside aria-label="Storefront settings" className="flex min-h-0 flex-col rounded-lg border border-line-soft bg-card">
            {/* Below lg the tabs stick under the shell's TopBar (4.75rem) while the page scrolls. */}
            <TabsPrimitive.List aria-label="Settings" className="sticky top-19 z-10 flex gap-1 rounded-t-lg border-b border-line-soft bg-card p-1.5 lg:static">
              {tabs.map((t) => {
                const on = tab === t.value
                const n = tabErrors[t.value]
                return (
                  <TabsPrimitive.Trigger
                    key={t.value}
                    value={t.value}
                    className={cn(
                      "relative isolate inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-md px-3 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-violet md:h-8",
                      on ? "text-ink" : "text-ink-2 hover:text-ink",
                    )}
                  >
                    {on ? <motion.span layoutId="sf-panel-tab" aria-hidden className="absolute inset-0 -z-10 rounded-md bg-purple" transition={{ type: "spring", stiffness: 500, damping: 40 }} /> : null}
                    {t.label}
                    {n ? (
                      <>
                        <span aria-hidden className="inline-flex size-4 items-center justify-center rounded-full bg-danger text-[10px] font-semibold text-obsidian tabular">
                          {n}
                        </span>
                        <span className="sr-only">, {n} to fix</span>
                      </>
                    ) : null}
                  </TabsPrimitive.Trigger>
                )
              })}
            </TabsPrimitive.List>

            <motion.div layoutScroll className="min-h-0 flex-1 lg:overflow-y-auto lg:overscroll-contain">
              {/* Not tab stops themselves: every panel opens with its own controls. */}
              <TabsPrimitive.Content value="design" forceMount tabIndex={-1} className="outline-none data-[state=inactive]:hidden">
                <DesignControls config={config} brandName={brand.name} cover={config.cover ?? brand.cover} onChange={update} />
              </TabsPrimitive.Content>
              <TabsPrimitive.Content value="content" forceMount tabIndex={-1} className="outline-none data-[state=inactive]:hidden">
                <ContentControls key={resetKey} config={config} brand={brand} photos={photos} errors={errors} onChange={update} />
              </TabsPrimitive.Content>
              <TabsPrimitive.Content value="sections" forceMount tabIndex={-1} className="outline-none data-[state=inactive]:hidden">
                <SectionsControls
                  config={config}
                  products={products}
                  collections={collections}
                  currency={brand.currency}
                  errors={errors}
                  onChange={update}
                  onLocate={locate}
                  onHighlight={(s) => setHighlight(s ? sectionDomId(s) : null)}
                  onEditCover={() => {
                    setTab("content")
                    window.setTimeout(() => document.getElementById("sf-media-group")?.scrollIntoView({ block: "start", behavior: "smooth" }), 60)
                  }}
                />
              </TabsPrimitive.Content>
            </motion.div>
          </aside>
        </TabsPrimitive.Root>

        {wide ? (
          <section aria-label="Live preview" className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-line-soft bg-surface">
            <div className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-line-soft px-3 text-xs">
              <span className="inline-flex items-center gap-2 text-ink-2">
                <span className="size-1.5 rounded-full bg-violet" aria-hidden />
                Draft preview
              </span>
              <span className="truncate text-ink-3 tabular">
                /brands/{brand.handle}
                <span className="ml-2 hidden xl:inline">{device === "mobile" ? "390 px" : "Full width"}</span>
              </span>
            </div>
            <div className="min-h-0 flex-1">
              <PreviewFrame ref={previewRef} device={device} highlight={highlight} {...renderer} />
            </div>
          </section>
        ) : null}
      </div>

      {/* Phones and tablets: the preview opens over the controls, and Publish stays in reach. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden">
        <div data-toast-avoid="" className="glass-strong glass-sheen pointer-events-auto mx-auto flex max-w-xl items-center gap-2 rounded-2xl py-2 pr-2 pl-3">
          {/* A short copy of the header's status: not a live region, so it isn't announced twice. */}
          <span className="min-w-0 flex-1 truncate">
            <StatusBadge tone={status.tone} className="max-w-full">{status.short}</StatusBadge>
          </span>
          <Button type="button" variant="secondary" size="sm" className="h-10" onClick={() => setSheetOpen(true)}>
            <Eye />
            {/* The narrowest phones keep the eye and say the word to screen readers. */}
            <span className="max-[379px]:sr-only">Preview</span>
          </Button>
          {nothingToPublish ? (
            <Button asChild variant="secondary" size="sm" className="h-10">
              <Link href={`/brands/${brand.handle}`} target="_blank">
                View storefront
                <ArrowUpRight aria-hidden />
                <span className="sr-only">(opens in a new tab)</span>
              </Link>
            </Button>
          ) : (
            <Button type="button" variant="primary" size="sm" className="h-10" loading={publish.pending} success={publish.succeeded} onClick={onPublish}>
              Publish
            </Button>
          )}
        </div>
      </div>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="gap-0 overflow-hidden rounded-t-2xl p-0 data-[side=bottom]:h-[calc(100dvh-0.5rem)] lg:hidden" onCloseAutoFocus={onSheetCloseFocus}>
          <SheetHeader className="shrink-0 border-b border-line-soft py-3 pr-12">
            <SheetTitle>Preview</SheetTitle>
            <SheetDescription className="text-xs text-ink-2">Your draft. Publishing makes its template, colour, type, words and sections live.</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1">
            {sheetOpen ? <PreviewFrame device="desktop" {...renderer} /> : null}
          </div>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title="Discard your draft?"
        body="Your draft goes back to what's live on your storefront now. Everything you've changed since you last published is lost."
        confirmLabel="Discard draft"
        onConfirm={onDiscard}
        returnFocus={toSelectedTab}
      />
    </>
  )
}
