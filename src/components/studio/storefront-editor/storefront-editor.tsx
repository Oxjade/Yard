"use client"

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { motion } from "motion/react"
import { ArrowUpRightIcon as ArrowUpRight, ClockCounterClockwiseIcon as History, EyeIcon as Eye } from "@phosphor-icons/react"
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
import { ApiError } from "@/lib/api/client"
import { useApi } from "@/lib/api/use-api"
import { accountsKey, getAccounts, getStudioPosts, studioPostsKey } from "@/lib/api/social"
import {
  editorConfigFromDto,
  editorConfigToDto,
  getStudioStorefront,
  getStudioStorefrontVersion,
  loadStorefrontEditorContext,
  publishStudioStorefront,
  restoreStudioStorefrontVersion,
  saveStudioStorefrontDraft,
  storefrontBrandFromApi,
  type StorefrontDraftDto,
  type StorefrontEditorContext,
  type StorefrontVersionResponse,
} from "@/lib/api/storefront"
import { refreshServerSession, useServerSession } from "@/lib/session/use-server-session"
import type { BrandProfile } from "@/lib/api/contracts/session"
import { storiesOf } from "@/lib/data"
import { brandById } from "@/lib/data/brands"
import type { Brand, Collection, Drop, Product, Story, StorefrontConfig, StorefrontSection } from "@/lib/data/types"
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
  type FieldErrors,
  type FieldKey,
} from "./model"
import { DeviceToggle, EDITOR_DESCRIPTION, EDITOR_TITLE, EditorSkeleton, editorFrame, storefrontStatusMeta, type SaveState } from "./parts"
import { PreviewFrame, scrollPreviewTo, sectionDomId, type Device } from "./preview-frame"
import { SectionsControls, type SocialEditorData } from "./sections-controls"

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

function hasTemporaryUpload(config: EditorConfig) {
  return config.cover?.src.startsWith("blob:") || (config.logo?.kind === "image" && config.logo.image.src.startsWith("blob:"))
}

/** The server's field paths (config.announcement.href, …) as the editor's fields, so a rejected save highlights them. */
function serverFieldErrors(fields: Record<string, string> | undefined): FieldErrors {
  const out: FieldErrors = {}
  for (const [path, message] of Object.entries(fields ?? {})) {
    const key: FieldKey | undefined =
      path.startsWith("config.announcement.href") ? "announcement-href"
      : path.startsWith("config.announcement") ? "announcement-text"
      : path.startsWith("config.intro") ? "intro"
      : path.startsWith("config.coverAlt") ? "cover-alt"
      : path.startsWith("config.mark") ? "mark-text"
      : path.startsWith("config.social.instagram") ? "instagram"
      : path.startsWith("config.social.tiktok") ? "tiktok"
      : path.startsWith("config.social.x") ? "x"
      : path.startsWith("config.social.website") ? "website"
      : path.startsWith("config.sections") ? "sections"
      : undefined
    if (key && !out[key]) out[key] = message
  }
  return out
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
  const session = useServerSession()
  const demoBrand = session.status === "ready" && !!session.brand?.demo && brandById.has(session.brand.brand.id)
  return (
    // From lg the editor fills the window under the Studio shell (see editorFrame).
    <div className={editorFrame}>
      {session.status !== "ready" ? (
        session.status === "loading" ? (
          <>
            <PageHeader title={TITLE} description={DESCRIPTION} />
            <EditorSkeleton />
          </>
        ) : (
          <div className="grid gap-3 rounded-md border border-line-soft bg-card p-5" role="alert">
            <p className="text-sm text-ink">The storefront editor couldn&apos;t load your session.</p>
            <Button type="button" variant="secondary" size="sm" className="w-fit" onClick={() => void refreshServerSession()}>Try again</Button>
          </div>
        )
      ) : session.brand && !demoBrand ? (
        <ServerEditor profile={session.brand} />
      ) : (
        <DemoEditor />
      )}
    </div>
  )
}

function DemoEditor() {
  const ready = useCatalogReady()
  const brandId = useStudio((state) => state.brandId)
  const brand = brandById.get(brandId)!
  const storefront = useStudio((state) => state.storefront)
  const products = useStudio((state) => state.products)
  const drops = useStudio((state) => state.drops)
  const saveDraft = useStudio((state) => state.saveStorefrontDraft)
  const publishStorefront = useStudio((state) => state.publishStorefront)
  const discardDraft = useStudio((state) => state.discardStorefrontDraft)
  const collections = useBrandCollections(brandId)
  if (!ready) {
    return (
      <>
        <PageHeader title={TITLE} description={DESCRIPTION} />
        <EditorSkeleton />
      </>
    )
  }
  return (
    <Editor
      mode="demo"
      brandId={brandId}
      brand={brand}
      storefront={storefront}
      products={products.filter((product) => product.status === "published")}
      drops={drops}
      collections={collections}
      stories={storiesOf(brandId)}
      saveLocalDraft={saveDraft}
      publishLocalStorefront={publishStorefront}
      discardLocalDraft={discardDraft}
    />
  )
}

function ServerEditor({ profile }: { profile: BrandProfile }) {
  const context = useApi(`studio:storefront-editor:${profile.brand.id}`, () => loadStorefrontEditorContext(profile.brand.handle, profile.brand.id), { revalidateOnFocus: false })
  if (context.error) {
    const message = context.error instanceof ApiError ? context.error.message : "Your storefront data couldn't be loaded. Check your connection and try again."
    return (
      <div className="grid gap-3 rounded-md border border-line-soft bg-card p-5" role="alert">
        <p className="text-sm text-ink">{message}</p>
        <Button type="button" variant="secondary" size="sm" className="w-fit" onClick={() => void context.revalidate()}>Try again</Button>
      </div>
    )
  }
  if (!context.data) return <EditorSkeleton />
  const brand = storefrontBrandFromApi(context.data.published.brand, null, context.data.products, "brand")
  return (
    <Editor
      key={profile.brand.id}
      mode="server"
      serverContext={context.data}
      canEdit={profile.permissions.includes("content.publish")}
      brandId={profile.brand.id}
      brand={brand}
      products={context.data.products}
      drops={context.data.drops}
      collections={context.data.collections}
      stories={[]}
    />
  )
}

type EditorMode = "demo" | "server"

function Editor({ mode, serverContext, canEdit = true, brandId, brand, storefront: localStorefront, products, drops, collections, stories: providedStories, saveLocalDraft, publishLocalStorefront, discardLocalDraft }: {
  mode: EditorMode
  serverContext?: StorefrontEditorContext
  canEdit?: boolean
  brandId: string
  brand: Brand
  storefront?: { draft: StorefrontConfig; published: StorefrontConfig; publishedAt: string | null; savedAt: string | null }
  products: Product[]
  drops: Drop[]
  collections: Collection[]
  stories?: Story[]
  saveLocalDraft?: (draft: StorefrontConfig) => void
  publishLocalStorefront?: () => void
  discardLocalDraft?: () => void
}) {
  const [reloadPending, setReloadPending] = useState(false)
  const initialConfig = mode === "server"
    ? normalize(editorConfigFromDto(serverContext!.studio.draft.config, brand), brand)
    : withoutStaleUploads(normalize(localStorefront!.draft as EditorConfig, brand))
  const [serverDraft, setServerDraft] = useState<StorefrontDraftDto | null>(serverContext?.studio.draft ?? null)
  const [liveDocument, setLiveDocument] = useState(serverContext?.studio.live ?? null)
  const [versions, setVersions] = useState(serverContext?.studio.versions ?? [])
  const [savedConfig, setSavedConfig] = useState<EditorConfig>(initialConfig)
  const revision = useRef(serverContext?.studio.draft.revision ?? 0)
  const liveVersion = useRef(serverContext?.studio.live?.version ?? 0)

  /* ---------- Social feed preview data (§6.1): the session brand's published posts ---------- */

  const session = useServerSession()
  const sessionBrand = session.brand?.brand.id ?? null
  // Yard setup (founding brands) can't read the brand's social posts or accounts: the server refuses them.
  const ownSession = session.status === "ready" && sessionBrand === brandId && session.brand?.role !== "yard_setup"
  const socialPostsApi = useApi(ownSession ? studioPostsKey("all", "published") : null, getStudioPosts, { revalidateOnFocus: true })
  const socialAccountsApi = useApi(ownSession ? accountsKey : null, getAccounts)
  const social = useMemo<SocialEditorData>(() => {
    if (session.status === "loading") return { status: "loading", posts: null, accounts: null }
    if (!session.brand) return { status: "signed_out", posts: null, accounts: null }
    // Yard setup: an unclaimed brand has no social accounts yet (its owner connects them after claiming).
    if (session.brand.role === "yard_setup" && session.brand.brand.id === brandId) return { status: "ready", posts: [], accounts: [] }
    if (!ownSession) return { status: "other_brand", posts: null, accounts: null }
    if (socialPostsApi.error) return { status: "error", posts: null, accounts: socialAccountsApi.data?.accounts ?? null }
    if (!socialPostsApi.data) return { status: "loading", posts: null, accounts: socialAccountsApi.data?.accounts ?? null }
    return { status: "ready", posts: socialPostsApi.data.posts, accounts: socialAccountsApi.data?.accounts ?? null }
  }, [session.status, session.brand, brandId, ownSession, socialPostsApi.data, socialPostsApi.error, socialAccountsApi.data])
  // Not ready: the preview's Social feed says why (it never claims the live section is hidden).
  const socialPreviewState = social.status === "ready" ? undefined : social.status
  const stories = providedStories ?? []
  const photos = useMemo(() => brandPhotos(brand, products, collections, drops, stories), [brand, products, collections, drops, stories])

  /* ---------- Working copy and autosave ---------- */

  const [config, setConfig] = useState<EditorConfig>(initialConfig)
  const latest = useRef(config)
  const timer = useRef<number | null>(null)
  const inFlightSave = useRef<Promise<boolean> | null>(null)
  /** The exact working copy the server's draft (at revision.current) holds. */
  const savedSnapshot = useRef<EditorConfig>(initialConfig)
  const conflictRef = useRef(false)
  /** The last autosave failed: the edit exists only on this page until a save succeeds. */
  const [saveFailed, setSaveFailed] = useState(false)
  const [conflictMessage, setConflictMessage] = useState<string | null>(null)
  /** Fields the server rejected on the last save; cleared by the next successful one. */
  const [serverErrors, setServerErrors] = useState<FieldErrors>({})

  const flush = useCallback((keepalive = false): Promise<boolean> => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = null
    if (mode === "demo") {
      try {
        saveLocalDraft!(withoutStaleUploads(latest.current))
        setSaveFailed(false)
        return Promise.resolve(true)
      } catch {
        setSaveFailed(true)
        toast.error("Your draft couldn't be saved", { id: "sf-save-failed", description: "This browser's storage is full. Use a smaller image, or remove an upload, then save again." })
        return Promise.resolve(false)
      }
    }
    if (conflictRef.current || hasTemporaryUpload(latest.current)) return Promise.resolve(false)
    if (inFlightSave.current) return inFlightSave.current
    const snapshot = normalize(withoutStaleUploads(latest.current), brand)
    const pending = (async () => {
      try {
        const result = await saveStudioStorefrontDraft(editorConfigToDto(snapshot, brand), revision.current, { keepalive })
        revision.current = result.draft.revision
        savedSnapshot.current = snapshot
        setServerDraft(result.draft)
        setSavedConfig(snapshot)
        setSaveFailed(false)
        setServerErrors({})
        return true
      } catch (error) {
        setSaveFailed(true)
        if (error instanceof ApiError && error.status === 409) {
          conflictRef.current = true
          setConflictMessage(error.message)
        } else {
          const fieldErrors = error instanceof ApiError ? serverFieldErrors(error.fields) : {}
          setServerErrors(fieldErrors)
          const first = errorOrder.find((key) => fieldErrors[key])
          toast.error("Your draft couldn't be saved", {
            id: "sf-save-failed",
            description: first ? fieldErrors[first] : error instanceof ApiError ? error.message : "Check your connection and try again.",
          })
        }
        return false
      } finally {
        inFlightSave.current = null
        if (!conflictRef.current && !hasTemporaryUpload(latest.current) && fingerprint(latest.current) !== fingerprint(snapshot)) {
          timer.current = window.setTimeout(() => void flush(), AUTOSAVE_MS)
        }
      }
    })()
    inFlightSave.current = pending
    return pending
  }, [mode, saveLocalDraft, brand])

  const update: Update = useCallback(
    (patch) => {
      const current = latest.current
      const p = typeof patch === "function" ? patch(current) : patch
      if (!Object.keys(p).length) return
      const next = normalize({ ...current, ...p }, brand)
      latest.current = next
      setConfig(next)
      if (timer.current) window.clearTimeout(timer.current)
      if (mode === "server" && (conflictRef.current || hasTemporaryUpload(next))) return
      timer.current = window.setTimeout(() => void flush(), AUTOSAVE_MS)
    },
    [brand, flush, mode],
  )

  // Nothing typed is lost: server saves use keepalive on the way out; demos persist synchronously.
  useEffect(() => {
    const onHide = () => {
      if (timer.current) void flush(true)
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

  const storedFp = useMemo(() => fingerprint(mode === "server" ? normalize(savedConfig, brand) : normalize(localStorefront!.draft as EditorConfig, brand)), [mode, savedConfig, localStorefront, brand])
  const live = useMemo(() => {
    if (mode === "demo") return normalize(localStorefront!.published as EditorConfig, brand)
    const liveConfig = liveDocument?.config ?? serverContext!.studio.draft.config
    return normalize(editorConfigFromDto(liveConfig, brand), brand)
  }, [mode, localStorefront, liveDocument, serverContext, brand])
  const liveFp = useMemo(() => fingerprint(live), [live])
  const configFp = useMemo(() => fingerprint(config), [config])
  const state: SaveState = configFp !== storedFp ? (saveFailed ? "unsaved" : "saving") : (mode === "server" && !liveDocument) || configFp !== liveFp ? "unpublished" : "published"
  const hasDraftChanges = (mode === "server" && !liveDocument) || configFp !== liveFp

  /* ---------- Validation: on publish, then live while fixing ---------- */

  const [submitted, setSubmitted] = useState(false)
  const errors = useMemo<FieldErrors>(() => ({ ...serverErrors, ...(submitted ? validate(config, brand) : {}) }), [serverErrors, submitted, config, brand])
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
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historySelection, setHistorySelection] = useState<StorefrontVersionResponse | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
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

  const saveNow = useAsyncAction(
    async () => {
      const saved = await flush()
      if (!saved) throw new Error("Draft save failed")
    },
    { errorToast: false },
  )

  function onSaveDraft() {
    if (state === "saving" || state === "unsaved") void saveNow.run()
  }

  /** Stops the autosave timer and waits out a save already on its way, so the next request has the current revision. */
  async function settleSaves() {
    for (;;) {
      if (timer.current) window.clearTimeout(timer.current)
      timer.current = null
      if (!inFlightSave.current) return
      await inFlightSave.current
    }
  }

  const publish = useAsyncAction(async () => {
    const changed = changeSummary(config, live)
    if (mode === "demo") {
      if (!(await flush())) throw new Error("Draft save failed")
      publishLocalStorefront!()
    } else {
      // flush() may hand back a save of an older copy that was already on its way: keep saving
      // until the stored draft is the working copy, then publish exactly that revision.
      for (let attempt = 0; ; attempt++) {
        if (!(await flush())) throw new Error("Draft save failed")
        if (fingerprint(normalize(withoutStaleUploads(latest.current), brand)) === fingerprint(savedSnapshot.current)) break
        if (attempt >= 4) throw new Error("Draft save failed")
      }
      const published = savedSnapshot.current
      const result = await publishStudioStorefront(revision.current, liveVersion.current)
      liveVersion.current = result.version
      setLiveDocument({ version: result.version, config: editorConfigToDto(published, brand), publishedAt: result.publishedAt })
      setServerDraft((current) => current ? { ...current, baseVersion: result.version, behindLive: false } : current)
      setSavedConfig(published)
      setVersions((current) => [{ version: result.version, publishedAt: result.publishedAt, note: null }, ...current.filter((v) => v.version !== result.version)].slice(0, 30))
    }
    setSubmitted(false)
    if (!window.matchMedia(WIDE).matches) return
    toast.success("Storefront published", {
      description: mode === "server"
        ? changed.length ? `Your storefront is live with the new ${listJoin(changed)}.` : "Your storefront is up to date."
        : changed.length ? `Your demo storefront was published with the new ${listJoin(changed)}.` : "Your demo storefront is up to date.",
      action: { label: "View", onClick: () => window.open(`/brands/${brand.handle}`, "_blank", "noopener,noreferrer") },
    })
  }, {
    errorToast: false,
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        conflictRef.current = true
        setConflictMessage(error.message)
      }
      toast.error("Your storefront couldn't be published", { description: error instanceof ApiError ? error.message : "Check your connection and try again." })
    },
  })

  function onPublish() {
    if (!hasDraftChanges || !canEdit || conflictRef.current) return
    const found = validate(config, brand)
    const keys = errorOrder.filter((k) => found[k])
    if (keys.length) {
      setSubmitted(true)
      goToField(keys[0])
      if (wide) toast.error(keys.length === 1 ? "Fix 1 field before publishing" : `Fix ${keys.length} fields before publishing`, { description: found[keys[0]] })
      return
    }
    void publish.run()
  }

  function applyServerDraft(next: StorefrontDraftDto) {
    const nextConfig = normalize(editorConfigFromDto(next.config, brand), brand)
    revision.current = next.revision
    savedSnapshot.current = nextConfig
    setServerErrors({})
    setServerDraft(next)
    setSavedConfig(nextConfig)
    latest.current = nextConfig
    setConfig(nextConfig)
    setConflictMessage(null)
    conflictRef.current = false
    setSaveFailed(false)
    setSubmitted(false)
    setResetKey((key) => key + 1)
  }

  async function restoreVersion(version: number) {
    if (!canEdit || conflictRef.current) return
    try {
      // The restore replaces the draft: let this tab's own save finish first, or its new revision reads as someone else's edit.
      await settleSaves()
      if (conflictRef.current) return
      const result = await restoreStudioStorefrontVersion(version, revision.current)
      applyServerDraft(result.draft)
      setHistoryOpen(false)
      setHistorySelection(null)
      toast.success(`Version ${version} copied to your draft`, { description: "Publish the draft when you're ready to make it live." })
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        conflictRef.current = true
        setConflictMessage(error.message)
      }
      toast.error("That version couldn't be restored", { description: error instanceof ApiError ? error.message : "Check your connection and try again." })
    }
  }

  async function selectVersion(version: number) {
    setHistoryLoading(true)
    setHistorySelection(null)
    try {
      setHistorySelection(await getStudioStorefrontVersion(version))
    } catch (error) {
      toast.error("That version couldn't be loaded", { description: error instanceof ApiError ? error.message : "Check your connection and try again." })
    } finally {
      setHistoryLoading(false)
    }
  }

  async function reloadServerDraft() {
    setReloadPending(true)
    try {
      const current = await getStudioStorefront()
      setLiveDocument(current.live)
      liveVersion.current = current.live?.version ?? 0
      setVersions(current.versions)
      applyServerDraft(current.draft)
    } catch (error) {
      toast.error("The latest storefront couldn't be loaded", { description: error instanceof ApiError ? error.message : "Check your connection and try again." })
    } finally {
      setReloadPending(false)
    }
  }

  function onDiscard() {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = null
    if (mode === "demo") {
      discardLocalDraft!()
      latest.current = live
      setConfig(live)
      setSubmitted(false)
      setSaveFailed(false)
      setResetKey((key) => key + 1)
      return
    }
    if (liveDocument) {
      void restoreVersion(liveDocument.version)
    } else {
      const defaultConfig: EditorConfig = {
        template: "editorial",
        accent: "violet",
        typePreset: "condensed",
        intro: "",
        announcement: null,
        sections: [
          { id: "hero", type: "hero", enabled: true },
          { id: "featured", type: "featured-products", enabled: true, productIds: [] },
          { id: "collections", type: "collections", enabled: true, collectionIds: [] },
          { id: "all", type: "all-products", enabled: true },
        ],
      }
      void settleSaves()
        .then(() => saveStudioStorefrontDraft(editorConfigToDto(defaultConfig, brand), revision.current))
        .then((result) => applyServerDraft(result.draft))
        .catch((error: unknown) => {
          if (error instanceof ApiError && error.status === 409) {
            conflictRef.current = true
            setConflictMessage(error.message)
          }
          toast.error("Your draft couldn't be discarded", { description: error instanceof ApiError ? error.message : "Check your connection and try again." })
        })
    }
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
  const nothingToPublish = !hasDraftChanges && !publish.pending && !publish.succeeded
  const toSelectedTab = () => document.querySelector<HTMLElement>('[aria-label="Settings"] [role="tab"][aria-selected="true"]')
  const onSheetCloseFocus = useReturnFocus(sheetOpen, toSelectedTab)
  const savedAt = mode === "server" ? serverDraft?.updatedAt ?? null : localStorefront?.savedAt ?? null
  const publishedAt = mode === "server" ? liveDocument?.publishedAt ?? null : localStorefront?.publishedAt ?? null
  const stamps = [
    state === "unpublished" && savedAt ? `Draft saved ${formatDateTime(savedAt)}` : null,
    publishedAt ? `Last published ${formatDateTime(publishedAt)}` : null,
  ].filter((t): t is string => !!t)

  const renderer = {
    brand: previewBrand,
    config: previewConfig,
    products,
    collections,
    drops,
    stories,
    socialPosts: social.posts ?? undefined,
    socialPreviewState,
  }

  return (
    <>
      <PageHeader
        title={TITLE}
        description={DESCRIPTION}
        actions={
          <div className="flex items-center gap-2">
            {wide ? <DeviceToggle value={device} onChange={setDevice} /> : null}
            {mode === "server" ? (
              <Button type="button" variant="secondary" size="sm" className="h-10 md:h-8" onClick={() => setHistoryOpen(true)}>
                <History aria-hidden />
                <span className="sr-only">Version history</span>
              </Button>
            ) : null}
            <Button type="button" variant="secondary" size="sm" className="h-10 md:h-8" disabled={!hasDraftChanges || publish.pending || !canEdit} onClick={() => setDiscardOpen(true)}>
              Discard
            </Button>
            {/* Enabled while an edit waits for autosave (or a save failed); afterwards it rests disabled. */}
            <Button type="button" variant="secondary" size="sm" className="h-10 md:h-8" disabled={!canEdit || conflictRef.current || (state !== "saving" && state !== "unsaved" && !saveNow.succeeded)} loading={saveNow.pending} success={saveNow.succeeded} onClick={onSaveDraft}>
              Save draft
            </Button>
            {/* Phones carry Publish in the bar at the bottom: one acid button on screen. */}
            <Button type="button" variant="primary" size="sm" className="max-lg:hidden" disabled={!canEdit || conflictRef.current || (!hasDraftChanges && !publish.succeeded)} loading={publish.pending} success={publish.succeeded} onClick={onPublish}>
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

      {conflictMessage ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-danger/40 bg-danger/10 px-4 py-3">
          <p className="min-w-0 flex-1 text-sm text-ink">{conflictMessage}</p>
          <Button type="button" variant="secondary" size="sm" loading={reloadPending} onClick={() => void reloadServerDraft()}>Reload</Button>
        </div>
      ) : null}
      {!canEdit ? <p className="text-sm text-ink-2">Your role can view this storefront but can&apos;t edit or publish it.</p> : null}

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

            <fieldset disabled={!canEdit || publish.pending} className="min-h-0 min-w-0 flex-1 border-0 p-0">
            <motion.div layoutScroll className="min-h-0 lg:overflow-y-auto lg:overscroll-contain">
              {/* Not tab stops themselves: every panel opens with its own controls. */}
              <TabsPrimitive.Content value="design" forceMount tabIndex={-1} className="outline-none data-[state=inactive]:hidden">
                <DesignControls config={config} brandName={brand.name} cover={config.cover ?? brand.cover} onChange={update} />
              </TabsPrimitive.Content>
              <TabsPrimitive.Content value="content" forceMount tabIndex={-1} className="outline-none data-[state=inactive]:hidden">
                <ContentControls key={resetKey} config={config} brand={brand} photos={photos} errors={errors} onChange={update} socialAccounts={social.accounts} serverMode={mode === "server"} />
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
                  social={social}
                  onHighlight={(s) => setHighlight(s ? sectionDomId(s) : null)}
                  onEditCover={() => {
                    setTab("content")
                    window.setTimeout(() => document.getElementById("sf-media-group")?.scrollIntoView({ block: "start", behavior: "smooth" }), 60)
                  }}
                />
              </TabsPrimitive.Content>
            </motion.div>
            </fieldset>
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
            <Button type="button" variant="primary" size="sm" className="h-10" disabled={!canEdit || conflictRef.current} loading={publish.pending} success={publish.succeeded} onClick={onPublish}>
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
        body={mode === "server" ? "Your saved draft will be replaced by the current live version. Any unpublished edits will be lost." : "Your draft goes back to what's live on your storefront now. Everything you've changed since you last published is lost."}
        confirmLabel="Discard draft"
        onConfirm={onDiscard}
        returnFocus={toSelectedTab}
      />

      {mode === "server" ? (
        <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
          <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-lg">
            <SheetHeader className="border-b border-line-soft pb-4">
              <SheetTitle>Version history</SheetTitle>
              <SheetDescription>Review a published version, or copy it into your draft. Restoring never publishes by itself.</SheetDescription>
            </SheetHeader>
            <div className="grid gap-3 py-5">
              {versions.map((version) => (
                <div key={version.version} className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft pb-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">Version {version.version}{version.version === liveVersion.current ? " · Live" : ""}</p>
                    <p className="text-xs text-ink-2">{formatDateTime(version.publishedAt)}{version.note ? ` · ${version.note}` : ""}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="secondary" size="sm" loading={historyLoading && historySelection?.version === version.version} onClick={() => void selectVersion(version.version)}>Review</Button>
                    {canEdit ? <Button type="button" variant="secondary" size="sm" disabled={!!conflictMessage} onClick={() => void restoreVersion(version.version)}>Restore</Button> : null}
                  </div>
                </div>
              ))}
              {!versions.length ? <p className="text-sm text-ink-2">No published versions yet.</p> : null}
              {historySelection ? (
                <section aria-label={`Version ${historySelection.version} preview`} className="mt-3 grid gap-2 border-t border-line-soft pt-4">
                  <h3 className="text-sm font-medium text-ink">Version {historySelection.version} preview</h3>
                  <p className="text-xs text-ink-2">Published {formatDateTime(historySelection.publishedAt)}{historySelection.note ? ` · ${historySelection.note}` : ""}</p>
                  <p className="text-sm text-ink-2">{historySelection.config.intro || "No introduction"}</p>
                  <p className="text-xs text-ink-3">{historySelection.config.sections.filter((section) => section.enabled).map((section) => section.title ?? section.type).join(" · ") || "No visible sections"}</p>
                  {canEdit ? <Button type="button" variant="primary" size="sm" className="mt-2 w-fit" disabled={!!conflictMessage} onClick={() => void restoreVersion(historySelection.version)}>Restore this version</Button> : null}
                </section>
              ) : null}
            </div>
          </SheetContent>
        </Sheet>
      ) : null}
    </>
  )
}
