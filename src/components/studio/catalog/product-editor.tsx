"use client"

import { commissionLabel, commissionRateAt } from "@/lib/commission"
import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { ApiError, api } from "@/lib/api/client"
import type { StudioProductCreateBody, StudioProductDto, StudioProductResponse, StudioProductStatusAction } from "@/lib/api/contracts/catalog"
import type { ProposalProductInput } from "@/lib/api/contracts/proposals"
import type { StudioShippingDto } from "@/lib/api/contracts/shipping"
import { getStudioShipping, STUDIO_SHIPPING_KEY } from "@/lib/api/shipping"
import { apiUpload } from "@/lib/api/upload"
import { useApi } from "@/lib/api/use-api"
import { useServerSession } from "@/lib/session/use-server-session"
import { useRouter } from "next/navigation"
import { AnimatePresence, motion } from "motion/react"
import { WarningIcon as AlertTriangle, ArchiveIcon as Archive, ArrowCounterClockwiseIcon as ArchiveRestore, CaretLeftIcon as ChevronLeft, XCircleIcon as PackageX, TrashIcon as Trash2 } from "@phosphor-icons/react"
import { toast } from "sonner"
import { EmptyState } from "@/components/dashboard/empty-state"
import { PageHeader } from "@/components/dashboard/page-header"
import { productStatusMeta } from "@/components/dashboard/status-badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useAsyncAction } from "@/hooks/use-async-action"
import { useNow } from "@/hooks/use-now"
import { duration, ease } from "@/lib/motion"
import { currencies } from "@/config/markets"
import { brandById, STUDIO_BRAND_ID } from "@/lib/data/brands"
import { categories, categoryBySlug } from "@/lib/data/catalog"
import type { Brand, CategorySlug, Collection, Drop, Product, Variant } from "@/lib/data/types"
import { formatMoney } from "@/lib/money"
import { useStudio } from "@/lib/stores/studio"
import { cn } from "@/lib/utils"
import { useSettingsReady } from "@/components/studio/business/settings-store"
import { ConfirmDialog, control, Field, inputClass, Panel, Segmented, selectClass } from "./fields"
import { BRAND_MEDIA_COPY_FOR_YARD, ImageManager, type FormImage, type UploadedImage } from "./image-manager"
import { OptionsBuilder } from "./options-builder"
import { fromStudioCollection, fromStudioProduct, loadStudioCollections, loadStudioProductDtos, studioCollectionsKey } from "./live"
import { CatalogueNote, Thumb } from "./parts"
import {
  colourKey,
  emptyForm,
  errorTargets,
  fromProduct,
  snapshot,
  validate,
  withStockDelta,
  withVariants,
  type Errors,
  type FormVariant,
  type ProductForm,
} from "./product-form-model"
import { PublishBar, SaveBar, useLeaveGuard } from "./save-bar"
import { liveProductBody, localProductFrom } from "./product-save"
import { announceDraft, announcePublished, ListingPill, publishSavedProduct } from "./listing-feedback"
import { useListingFacts } from "@/components/studio/setup/use-listing"
import { brandHidden, QUICK_ADD_HREF } from "@/lib/listing-guide"
import { LightningIcon as Lightning, XIcon as XClose } from "@phosphor-icons/react"
import { ProductEditorSkeleton } from "./skeletons"
import { restoreProductStatuses, setProductStatuses, useBrandCollections, useCatalogReady } from "./store"
import { ChipInput } from "./tag-input"
import { autoSku, brandPhotos, formatDate, formatDateTime, MAX_TAGS, parseMoney, plural, slugify, toLocalInput } from "./utils"

/** Products deleted from their own page, so the page doesn't flash "not found" while it navigates away. */
const deletedHere = new Set<string>()
const NO_DROPS: Drop[] = []

/** Loads the product once saved data is in, then hands it to the editor. No id = a new product. */
export function ProductEditorRoute({ id }: { id?: string }) {
  const catalogReady = useCatalogReady()
  // The default processing time is the one saved in Settings: wait for it before the form is
  // seeded, so the default it names (and a new product's time) never flashes the profile's.
  const settingsReady = useSettingsReady()
  const ready = catalogReady && settingsReady
  const brandId = useStudio((s) => s.brandId)
  const product = useStudio((s) => (id ? s.products.find((p) => p.id === id) : undefined))
  const liveMember = useServerSession((s) => (s.brand && !s.brand.demo ? s.brand.brand : null))
  const brand = brandById.get(brandId)!

  if (liveMember) return <LiveProductEditorRoute id={id} member={liveMember} />

  if (!ready) return <ProductEditorSkeleton />
  if (id && !product) {
    // Just deleted from this page: render nothing while we navigate away.
    if (deletedHere.has(id)) return null
    return (
      <div className="grid gap-6">
        <BackLink />
        <EmptyState
          icon={PackageX}
          title="This product isn't in your catalogue"
          body="It may have been deleted, or it was created in another browser."
          action={
            <Button asChild variant="secondary" size="sm">
              <Link href="/studio/products">Back to products</Link>
            </Button>
          }
        />
      </div>
    )
  }
  return <ProductEditor key={id ?? "new"} product={product} brand={brand} />
}

type LiveMember = { id: string; handle: string; name: string }

/** A Brand for the form from the live session and shipping profile; sample copy only fills the rest. */
export function liveBrand(base: Brand, member: LiveMember, shipping?: StudioShippingDto): Brand {
  const text = member.name
    .split(/\s+/)
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 3)
    .toUpperCase()
  return {
    ...base,
    id: member.id,
    handle: member.handle,
    name: member.name,
    mark: { text: text || "ST", style: "grotesk" },
    cover: { src: "", alt: "", width: 1200, height: 1500 },
    country: (shipping?.brand.country ?? base.country) as Brand["country"],
    city: shipping?.profile.originCity ?? base.city,
    currency: (shipping?.brand.currency ?? base.currency) as Brand["currency"],
    processingDays: shipping ? [shipping.profile.handlingMin, shipping.profile.handlingMax] : base.processingDays,
    shipsFrom: (shipping?.brand.country ?? base.shipsFrom) as Brand["country"],
  }
}

function LiveProductEditorRoute({ id, member }: { id?: string; member: LiveMember }) {
  const settingsReady = useSettingsReady()
  const productsQuery = useApi(`studio.catalog:${member.id}`, loadStudioProductDtos, { keepPrevious: false })
  const collectionsQuery = useApi(studioCollectionsKey(member.id), loadStudioCollections, { keepPrevious: false })
  const shippingQuery = useApi<StudioShippingDto>(`${STUDIO_SHIPPING_KEY}:${member.id}`, () => getStudioShipping(), { revalidateOnFocus: false })
  const productQuery = useApi<StudioProductResponse>(
    id ? `studio.catalog.product:${member.id}:${id}` : null,
    () => api<StudioProductResponse>(`/api/studio/catalog/products/${encodeURIComponent(id!)}`),
    { keepPrevious: false },
  )
  const ready = settingsReady && !productsQuery.isLoading && !collectionsQuery.isLoading && !shippingQuery.isLoading && (!id || !productQuery.isLoading)
  const failure = productQuery.error ?? shippingQuery.error ?? productsQuery.error ?? collectionsQuery.error
  const base = brandById.get(STUDIO_BRAND_ID)!
  const brand = useMemo(() => liveBrand(base, member, shippingQuery.data), [base, member, shippingQuery.data])

  if (!ready) return <ProductEditorSkeleton />
  if (failure) {
    return (
      <div className="grid gap-6">
        <BackLink />
        <div className="grid max-w-xl gap-3 rounded-lg border border-line bg-surface p-5">
          <h1 className="text-lg text-ink">This product couldn&apos;t be loaded</h1>
          <p className="text-sm text-ink-2">{failure instanceof ApiError ? failure.message : "Check your connection and try again."}</p>
          <div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                void productQuery.revalidate()
                void productsQuery.revalidate()
                void collectionsQuery.revalidate()
                void shippingQuery.revalidate()
              }}
            >
              Try again
            </Button>
          </div>
        </div>
      </div>
    )
  }
  if (id && !productQuery.data) {
    return (
      <div className="grid gap-6">
        <BackLink />
        <EmptyState
          icon={PackageX}
          title="This product isn't in your catalogue"
          body="It may have been archived in another tab, or it belongs to another brand."
          action={
            <Button asChild variant="secondary" size="sm">
              <Link href="/studio/products">Back to products</Link>
            </Button>
          }
        />
      </div>
    )
  }

  const products = (productsQuery.data ?? []).map(fromStudioProduct)
  const collections = (collectionsQuery.data ?? []).map((dto) => fromStudioCollection(dto, member.id))
  return (
    <ProductEditor
      key={id ?? "new"}
      product={productQuery.data ? fromStudioProduct(productQuery.data.product) : undefined}
      brand={brand}
      server={{
        dto: productQuery.data?.product,
        allProducts: products,
        collections,
        onSaved: (dto) => {
          productQuery.mutate({ product: dto })
          void productsQuery.revalidate()
        },
        reload: () => {
          void productQuery.revalidate()
          void productsQuery.revalidate()
        },
        upload: async (file) => {
          const media = await apiUpload(file, { purpose: "social_post", as: "brand" }).promise
          return { src: media.src, width: media.width ?? 1200, height: media.height ?? 1500, mediaId: media.id }
        },
      }}
    />
  )
}

/**
 * The brand as the product form should see it: its default processing time is the handling time
 * in Shipping & fulfilment (Yard's server, §6.5) when Studio has a session for this brand, else the
 * brand profile's. The form names that default in its hint for every product; a new product, or
 * one without a time of its own, starts from it, and a product saved with its own time keeps that.
 */
export function useSettingsBrand(brand: Brand) {
  const ready = useSettingsReady()
  const sessionBrand = useServerSession((s) => s.brand?.brand.id ?? null)
  const server = useApi<StudioShippingDto>(ready && sessionBrand === brand.id ? `${STUDIO_SHIPPING_KEY}:${brand.id}` : null, () => getStudioShipping(), { revalidateOnFocus: false })
  const min = server.data?.profile.handlingMin
  const max = server.data?.profile.handlingMax
  return useMemo(() => (min !== undefined && max !== undefined ? { ...brand, processingDays: [min, max] as [number, number] } : brand), [brand, min, max])
}

function BackLink({ href = "/studio/products", label = "Products" }: { href?: string; label?: string }) {
  return (
    <Link href={href} className="inline-flex w-fit items-center gap-1 text-xs text-ink-2 hover:text-ink">
      <ChevronLeft className="size-3.5" /> {label}
    </Link>
  )
}

const statusCopy: Record<"draft" | "published" | "scheduled", string> = {
  draft: "Drafts are invisible to shoppers. Publish to put it on Yard.",
  published: "Marked ready to sell in your catalogue.",
  scheduled: "Pick a go-live time. Until then it stays unpublished.",
}

/** What creating the product did, in Studio terms. Where it reaches shoppers is the page's one note. */
function createdDescription(status: Product["status"], publishAt: string | null) {
  if (status === "published") return "Published in your catalogue."
  if (status === "scheduled" && publishAt) return `Scheduled for ${formatDateTime(publishAt)}.`
  return "Saved as a draft. Only you can see it."
}

/**
 * Suggestions from Yard: the same form, saved as a suggestion (admin) or as the brand's answer to
 * one ("Edit before accepting"). `submit` gets the body the editor would have sent to the catalogue
 * plus, for an existing product, `stockDelta` (the change per variant from the counts the form opened
 * with, so sales meanwhile are kept) and `expectedVersion` (the version it loaded); it owns what
 * happens next (it navigates).
 */
export type ProposalEditor = {
  title: string
  description: string
  backHref: string
  backLabel: string
  saveLabel: string
  /** Replaces the Publishing panel's controls: when it goes live. */
  publishNote: string
  /** A line under it (Yard's form: "Nothing reaches shoppers until the brand accepts."). */
  publishHint?: string
  /** Yard's team filling the form for the brand: copy names the brand, not "you", and Studio-only links are hidden. */
  byYard?: boolean
  /** A suggested stock change per variant, shown on top of the counts the form opens with. */
  stockDelta?: Record<string, number>
  /** A product to start a NEW product from (a suggested new product): its variants and photos are saved as new. */
  prefill?: Product
  /** Shown first in the right column (the note to the brand). */
  aside?: React.ReactNode
  submit: (body: ProposalSubmitBody) => Promise<void>
}
export type ProposalSubmitBody = ProposalProductInput

export type ServerEditor = {
  /** Set for Suggestions from Yard (see ProposalEditor). */
  proposal?: ProposalEditor
  dto?: StudioProductDto
  allProducts: Product[]
  collections: Collection[]
  onSaved: (dto: StudioProductDto) => void
  /** Refetches the product from the server (after a version conflict). */
  reload: () => void
  upload: (file: File) => Promise<UploadedImage>
}

export function ProductEditor({ product, brand: profile, server }: { product?: Product; brand: Brand; server?: ServerEditor }) {
  const brand = useSettingsBrand(profile)
  const router = useRouter()
  const localProducts = useStudio((s) => s.products)
  const localOrders = useStudio((s) => s.orders)
  const localDrops = useStudio((s) => s.drops)
  const localCollections = useBrandCollections(brand.id)
  const allProducts = server?.allProducts ?? localProducts
  const orders = server ? [] : localOrders
  const studioDrops = server ? NO_DROPS : localDrops
  const collections = server?.collections ?? localCollections

  const proposal = server?.proposal
  // A suggested stock change shows as the count to save, while originalStock stays the count opened with.
  const stockDelta = proposal?.stockDelta
  const [baseline, setBaseline] = useState<ProductForm>(() => (product ? withStockDelta(fromProduct(product, brand), stockDelta) : proposal?.prefill ? fromProduct(proposal.prefill, brand) : emptyForm(brand)))
  const [form, setForm] = useState<ProductForm>(baseline)
  const [checkedAt, setCheckedAt] = useState<number | null>(null)
  const [focusTick, setFocusTick] = useState(0)
  /** True from a valid save until the page has moved on (a create navigates away). */
  const [saving, setSaving] = useState(false)
  const [dialog, setDialog] = useState<null | "archive" | "delete" | "discard">(null)
  /** Archived on this page: the banner's restore puts back the status it had before. */
  const [archivedFrom, setArchivedFrom] = useState<ReturnType<typeof setProductStatuses> | null>(null)
  const now = useNow(60_000)
  /** Live brands: whether the brand itself is visible yet (a founding brand before its storefront isn't). */
  const listing = useListingFacts()

  const currency = brand.currency
  const symbol = currencies[currency].symbol
  const isNew = !product
  const dirty = useMemo(() => snapshot(form) !== snapshot(baseline), [form, baseline])
  const processing = form.images.some((im) => im.processing)
  const hasOrders = !server && !!product && orders.some((o) => o.lines.some((l) => l.productId === product.id))

  /** Variants as the product had them when the form opened: restored if an option comes back. */
  const pool = useMemo(() => new Map(baseline.variants.filter((v) => v.id).map((v) => [v.key, v])), [baseline])
  const otherSkus = useMemo(() => new Set(allProducts.filter((p) => p.id !== product?.id).flatMap((p) => p.variants.map((v) => v.sku.toUpperCase()))), [allProducts, product?.id])
  const original: Variant[] = useMemo(() => product?.variants ?? [], [product])

  const errors: Errors = useMemo(() => (checkedAt === null ? {} : validate(form, { brand, otherSkus, original, now: checkedAt })), [checkedAt, form, brand, otherSkus, original])
  const errorList = useMemo(() => errorTargets(form).filter((t) => errors[t.key]), [errors, form])

  // Live, a photo can only be attached by its upload (mediaId): sample, seeded and placeholder images can't be saved.
  const library = useMemo(() => {
    const photos = brandPhotos(brand, allProducts, collections, studioDrops)
    return server ? photos.filter((im) => im.mediaId) : photos
  }, [brand, allProducts, collections, studioDrops, server])
  const tagSuggestions = useMemo(() => [...new Set(allProducts.flatMap((p) => p.tags))].sort(), [allProducts])
  const category = form.category ? categoryBySlug.get(form.category) : undefined

  const guard = useLeaveGuard(dirty && !saving, {
    title: "Leave without saving?",
    body: isNew ? "This product hasn't been saved yet. Leaving now discards it." : "Your changes to this product will be lost.",
    onLeave: () => {
      leaving.current = true
    },
  })

  /*
   * Next keeps visited pages alive (hidden) so back and forward restore them. Keep the form
   * in step with that: refresh it from the store when the product changes and nothing is being
   * edited, and start clean after a create or a confirmed "leave without saving".
   */
  const live = useRef({ dirty, saving, baseline })
  const leaving = useRef(false)
  const created = useRef(false)
  const synced = useRef(product)
  /*
   * The server version the form's baseline came from. A save sends this, not the latest fetched
   * version, so a refetch on focus while the form has edits can't silently overwrite someone else's change.
   */
  const serverVersion = server?.dto?.version
  const baseVersion = useRef(serverVersion)
  /** Set by "Reload" after a conflict: the next product from the server replaces the form, edits included. */
  const forceSync = useRef(false)
  useEffect(() => {
    live.current = { dirty, saving, baseline }
  })
  useEffect(() => {
    if (!product || product === synced.current) return
    synced.current = product
    if (!forceSync.current && (live.current.dirty || live.current.saving)) return
    forceSync.current = false
    baseVersion.current = serverVersion
    const fresh = withStockDelta(fromProduct(product, brand), stockDelta)
    stash.current.clear()
    setBaseline(fresh)
    setForm(fresh)
    setCheckedAt(null)
  }, [product, brand, serverVersion, stockDelta])
  useEffect(
    () => () => {
      if (!created.current && !leaving.current) return
      const fresh = created.current ? emptyForm(brand) : live.current.baseline
      created.current = false
      leaving.current = false
      setBaseline(fresh)
      setForm(fresh)
      setCheckedAt(null)
      setSaving(false)
    },
    [brand],
  )

  // A deep link from the Overview guide (#photos-panel, #pf-name, #variants-panel,
  // #publishing-panel) lands on that part of the form once it has rendered.
  useEffect(() => {
    const target = window.location.hash.slice(1)
    if (!target) return
    const frame = requestAnimationFrame(() => {
      const el = document.getElementById(target)
      if (!el) return
      el.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })
      if (el instanceof HTMLInputElement) el.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [])

  // Move focus to the first field that needs fixing after a failed save.
  useEffect(() => {
    if (!focusTick) return
    const first = errorTargets(form).find((t) => errors[t.key])
    if (!first) return
    const el = document.getElementById(first.target)
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "smooth" })
      el.focus({ preventScroll: true })
    }
    // Only when a save was attempted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTick])

  /* ---------- field updates ---------- */

  const patch = (p: Partial<ProductForm>) => setForm((f) => ({ ...f, ...p }))

  function setName(name: string) {
    setForm((f) => {
      if (!isNew) return { ...f, name }
      const slug = slugify(name)
      return { ...f, name, variants: f.variants.map((v) => (v.skuAuto ? { ...v, sku: autoSku(brand, slug, v.options) } : v)) }
    })
  }

  /** Rows dropped by an option change in this session, so turning the option back on restores what was typed. */
  const stash = useRef(new Map<string, FormVariant>())
  function rebuild(f: ProductForm) {
    for (const v of f.variants) stash.current.set(v.key, v)
    const known = new Map([...pool, ...stash.current])
    return withVariants(f, brand, product?.slug ?? slugify(f.name), known)
  }

  function setOptions(p: Partial<Pick<ProductForm, "hasSizes" | "sizes" | "hasColours" | "colours">>) {
    setForm((f) => rebuild({ ...f, ...p }))
  }

  function addColour() {
    setForm((f) => rebuild({ ...f, hasColours: true, colours: [...f.colours, { key: colourKey(), name: "", hex: "#111111" }] }))
    // Focus the new colour's name once it renders.
    requestAnimationFrame(() => {
      const inputs = document.querySelectorAll<HTMLInputElement>('input[id^="pf-colour-"][id$="-name"]')
      inputs[inputs.length - 1]?.focus()
    })
  }

  function setVariant(key: string, p: Partial<FormVariant>) {
    setForm((f) => ({ ...f, variants: f.variants.map((v) => (v.key === key ? { ...v, ...p } : v)) }))
  }

  function setImages(update: (prev: FormImage[]) => FormImage[]) {
    setForm((f) => ({ ...f, images: update(f.images) }))
  }

  function setStatus(status: ProductForm["status"]) {
    setForm((f) => {
      if (status === "scheduled" && !f.publishAt) {
        const d = new Date()
        d.setDate(d.getDate() + 1)
        d.setHours(11, 0, 0, 0)
        return { ...f, status, publishAt: toLocalInput(d.toISOString()) }
      }
      return { ...f, status }
    })
  }

  /* ---------- actions ---------- */

  /** The catalogue write, then stock counts, then the publication status (which needs a fresh version). */
  async function commitLive(form: ProductForm) {
    setSaving(true)
    const dto = server?.dto
    if (server && product && !dto && !server.proposal) throw new Error("This product needs to be reloaded before it can be saved.")
    const body: StudioProductCreateBody = liveProductBody(form, { brand, product, collections })
    const publishAt = form.status === "scheduled" ? new Date(form.publishAt).toISOString() : null

    if (proposal) {
      const { dropId: _drop, ...rest } = body
      void _drop
      // A change from the count the form opened with, like the save below: sales since then are kept.
      const stockDelta: Record<string, number> = {}
      for (const v of form.variants) if (v.id && v.originalStock !== undefined && Number(v.stock) !== v.originalStock) stockDelta[v.id] = Number(v.stock) - v.originalStock
      const expectedVersion = baseVersion.current ?? dto?.version
      await proposal.submit({ ...rest, ...(product ? { stockDelta, ...(expectedVersion ? { expectedVersion } : {}) } : {}) })
      setCheckedAt(null)
      return
    }

    const warnings: string[] = []
    let saved: StudioProductDto
    if (product && dto) {
      const result = await api<StudioProductResponse>(`/api/studio/catalog/products/${encodeURIComponent(product.id)}`, {
        method: "PATCH",
        body: { ...body, expectedVersion: baseVersion.current ?? dto.version },
      })
      saved = result.product
      let stockChanged = false
      for (const v of form.variants) {
        if (!v.id || v.originalStock === undefined) continue
        // A change from the count the form opened with: sales since then are kept.
        const delta = Number(v.stock) - v.originalStock
        if (delta === 0) continue
        try {
          await api(`/api/studio/catalog/variants/${encodeURIComponent(v.id)}/stock`, {
            body: { mode: "adjust", qty: delta, reason: "adjustment", note: "Edited on the product page" },
          })
          stockChanged = true
        } catch (cause) {
          warnings.push(cause instanceof ApiError ? cause.message : `Stock for ${v.sku} didn't update.`)
        }
      }
      // The PATCH snapshot predates the stock writes: read the product again so the form shows the new counts.
      if (stockChanged) {
        try {
          saved = (await api<StudioProductResponse>(`/api/studio/catalog/products/${encodeURIComponent(product.id)}`)).product
        } catch {
          // Keep the PATCH snapshot; the product refetches on the next focus.
        }
      }
    } else {
      const result = await api<StudioProductResponse>("/api/studio/catalog/products", { body })
      saved = result.product
    }

    // A new go-live time for a product that stays scheduled also goes through the status endpoint.
    const reschedule = form.status === "scheduled" && saved.status === "scheduled" && form.publishAt !== baseline.publishAt
    if (form.status !== "archived" && (form.status !== saved.status || reschedule)) {
      const action: StudioProductStatusAction = form.status === "published" ? "publish" : form.status === "scheduled" ? "schedule" : "unpublish"
      try {
        const result = await api<StudioProductResponse>(`/api/studio/catalog/products/${encodeURIComponent(saved.id)}/status`, {
          body: { action, ...(action === "schedule" && publishAt ? { publishAt } : {}), expectedVersion: saved.version },
        })
        saved = result.product
      } catch (cause) {
        warnings.push(cause instanceof ApiError ? cause.message : "The publication status didn't change.")
      }
    }

    server?.onSaved(saved)
    if (warnings.length) {
      toast.warning(warnings.length === 1 ? warnings[0] : "Product saved, but some changes didn't apply.", {
        description: warnings.length === 1 ? undefined : warnings.join(" "),
      })
    }

    announce({ id: saved.id, name: saved.title, slug: saved.slug, version: saved.version, status: saved.status as Product["status"], was: product?.status ?? "draft", publishAt: saved.publishAt })

    if (isNew) {
      setCheckedAt(null)
      created.current = true
      router.replace(`/studio/products/${saved.id}`)
      return
    }

    const freshProduct = fromStudioProduct(saved)
    const reset = fromProduct(freshProduct, brand)
    synced.current = freshProduct
    baseVersion.current = saved.version
    stash.current.clear()
    setBaseline(reset)
    setForm(reset)
    setCheckedAt(null)
    setSaving(false)
  }

  function commit(now: number, form: ProductForm) {
    if (server) return commitLive(form)
    setSaving(true)

    const store = useStudio.getState()
    const { saved, adjustments, publishAt } = localProductFrom(form, { brand, profile, product, collections, now })
    const id = saved.id

    store.upsertProduct(saved)
    for (const a of adjustments) store.adjustStock(id, a.variantId, a.delta, "adjustment", "Edited on the product page")

    announce({ id, name: saved.name, slug: saved.slug, status: saved.status, was: product?.status ?? "draft", publishAt })
    if (isNew) {
      // The page moves to the new product, so say what happened (announce, above). An edit to a
      // published product says it in place: the header button checks and rests as "Saved".
      // Stop checking while the page moves: the new product's own SKUs would now read as taken.
      setCheckedAt(null)
      created.current = true
      router.replace(`/studio/products/${id}`)
      return
    }
    const fresh = useStudio.getState().products.find((p) => p.id === id) ?? saved
    synced.current = fresh
    const reset = fromProduct(fresh, brand)
    stash.current.clear()
    setBaseline(reset)
    setForm(reset)
    setCheckedAt(null)
    setSaving(false)
  }

  /**
   * What a save means for shoppers, said once: a first publish is celebrated, any publish offers
   * "View it on Yard", a draft is reminded that nobody can see it (with "Publish now"), and a new
   * scheduled product says when it goes live. Suggestions from Yard never get here.
   */
  function announce(r: { id: string; name: string; slug: string; version?: number; status: Product["status"]; was: Product["status"]; publishAt: string | null | undefined }) {
    const first = !allProducts.some((p) => p.id !== r.id && (p.status === "published" || p.status === "scheduled"))
    const hidden = brandHidden(listing)
    if (r.status === "published" && r.was !== "published") {
      // No "View it on Yard" until the listing facts say whether the shop is live.
      announcePublished(r, { first, hidden, viewable: !!server && !!listing, onOpen: (href) => router.push(href) })
      return
    }
    if (r.status === "draft") {
      announceDraft(r, { isNew, onPublish: () => void publishSavedProduct(r, { live: !!server, first, hidden, onOpen: (href) => router.push(href) }) })
      return
    }
    if (isNew) toast.success("Product created", { description: createdDescription(r.status, r.publishAt ?? null) })
  }

  const saveAction = useAsyncAction((now: number, f: ProductForm) => commit(now, f), {
    error: server
      ? "Your product couldn't be saved. Check your connection and try again."
      : "Your product couldn't be saved. This browser's storage may be full: remove a large photo, then save again.",
    // Live, the toast carries the server's reason (onError), not the generic connection message.
    errorToast: !server,
    onError: (cause) => {
      setSaving(false)
      if (server) liveSaveFailed(cause)
    },
  })

  function liveSaveFailed(cause: unknown) {
    if (cause instanceof ApiError && cause.status === 409 && !proposal) {
      toast.error("Someone else changed this product", {
        description: "Reload to see their changes. Your unsaved edits on this page will be replaced.",
        duration: Infinity,
        action: {
          label: "Reload",
          onClick: () => {
            forceSync.current = true
            server?.reload()
          },
        },
      })
      return
    }
    if (cause instanceof ApiError) {
      const fields = cause.fields ? Object.values(cause.fields).filter(Boolean) : []
      toast.error(proposal ? "This couldn't be saved" : "Your product couldn't be saved", { description: [cause.message, ...fields].join(" ") })
      return
    }
    // The editor's own checks (photos still uploading, a stale product) throw plain Errors with user copy.
    const own = cause instanceof Error && !(cause instanceof TypeError) ? cause.message : null
    toast.error("Your product couldn't be saved", { description: own ?? "Check your connection and try again." })
  }

  /**
   * Validates first: a failed check keeps every value, lists what to fix and focuses the first
   * field. `override` saves with a change on top (Publish: the same save with status published).
   */
  function save(override?: Partial<ProductForm>) {
    if (saveAction.pending || saving) return
    const now = Date.now()
    const next = override ? { ...form, ...override } : form
    if (override) setForm(next)
    const errs = validate(next, { brand, otherSkus, original, now })
    setCheckedAt(now)
    if (Object.values(errs).some(Boolean)) {
      setFocusTick((t) => t + 1)
      return
    }
    // The save buttons already read "Preparing photos" and are disabled; this is a safety net.
    if (processing) return
    void saveAction.run(now, next)
  }

  /** Publish from the header, the save bar or the phone bar: the same save, as published. */
  const publishNow = () => save({ status: "published" })

  /** The form goes back to the last save in place: the change is visible, so no toast. */
  function discard() {
    stash.current.clear()
    setForm(baseline)
    setCheckedAt(null)
  }

  /*
   * Archive and restore change only the stored status. The form follows, keeping any edits in
   * progress; the store sync above leaves a dirty form alone, so set both here.
   */
  function setStoredStatus(status: Product["status"]) {
    if (!product) return []
    const previous = setProductStatuses([product.id], status)
    setForm((f) => ({ ...f, status }))
    setBaseline((b) => ({ ...b, status }))
    return previous
  }

  /** Archive/restore on the server: the rest of the form and any unsaved edits stay as they are. */
  async function liveStatus(action: "archive" | "restore") {
    if (!server?.dto || !product) return
    setSaving(true)
    try {
      const result = await api<StudioProductResponse>(`/api/studio/catalog/products/${encodeURIComponent(product.id)}/status`, {
        body: { action, expectedVersion: server.dto.version },
      })
      server.onSaved(result.product)
      const status = result.product.status as Product["status"]
      setForm((f) => ({ ...f, status }))
      setBaseline((b) => ({ ...b, status }))
      setArchivedFrom(null)
      toast.success(action === "archive" ? "Product archived" : "Product restored", {
        description: action === "archive" ? "Find it in the Archived tab." : "It's back as a draft.",
      })
    } catch (cause) {
      toast.error(action === "archive" ? "This product couldn't be archived" : "This product couldn't be restored", {
        description: cause instanceof ApiError ? cause.message : "Try again in a moment.",
      })
    } finally {
      setSaving(false)
    }
  }

  /** Shown in place: the badge turns Archived and the banner appears, with focus on its restore button. */
  function archive() {
    if (server) {
      void liveStatus("archive")
      return
    }
    const previous = setStoredStatus("archived")
    if (previous.length) setArchivedFrom(previous)
  }

  /** Back to the status it had, if it was archived on this page; otherwise to a draft. */
  function restore() {
    if (server) {
      void liveStatus("restore")
      return
    }
    if (archivedFrom?.length) {
      const was = archivedFrom[0].status
      restoreProductStatuses(archivedFrom)
      setForm((f) => ({ ...f, status: was }))
      setBaseline((b) => ({ ...b, status: was }))
    } else {
      setStoredStatus("draft")
    }
    setArchivedFrom(null)
  }

  function remove() {
    if (!product) return
    if (server) {
      void liveStatus("archive")
      return
    }
    if (hasOrders) {
      archive()
      return
    }
    setSaving(true)
    deletedHere.add(product.id)
    window.setTimeout(() => deletedHere.delete(product.id), 3000)
    guard.go("/studio/products")
    useStudio.getState().removeProduct(product.id)
    toast.success("Product deleted", { description: `${product.name} was removed from your catalogue.` })
  }

  const price = parseMoney(form.price, currency)
  const compare = form.compareAt.trim() ? parseMoney(form.compareAt, currency) : null
  const off = price && compare && compare > price ? Math.round((1 - price / compare) * 100) : null
  const archived = form.status === "archived"
  /** Nothing publishes on a timer until the backend exists, so say plainly when a set time has passed. */
  const pastDue = !!now && product?.status === "scheduled" && !!product.publishAt && form.publishAt === baseline.publishAt && Date.parse(product.publishAt) <= now
  const busy = saving || saveAction.pending
  const restoreTo = server ? "draft" : archivedFrom?.[0]?.status
  const restoreLabel = restoreTo && restoreTo !== "draft" && restoreTo !== "archived" ? `Restore as ${productStatusMeta[restoreTo].label.toLowerCase()}` : "Restore as draft"
  const toRestore = () => document.getElementById("pf-restore")
  /** A draft (new or saved) offers Publish beside Save; Save then reads "Save draft". */
  const draft = !proposal && form.status === "draft" && !archived
  const savedDraft = draft && !isNew && !dirty && baseline.status === "draft"

  return (
    <div className={cn("grid gap-6", (dirty || savedDraft) && "pb-24 md:pb-0", dirty && "md:pb-24")}>
      <div className="grid gap-2">
        <BackLink href={proposal?.backHref} label={proposal?.backLabel} />
        <PageHeader
          title={proposal ? proposal.title : isNew ? "New product" : product.name}
          description={proposal ? proposal.description : isNew ? "Add photos, a price and the sizes you stock, then publish. Drafts are invisible to shoppers." : `Added ${formatDate(product.createdAt)}. ${plural(product.variants.length, "variant")}, ${plural(product.images.length, "photo")}.`}
          actions={
            <>
              <Button id="pf-back" type="button" variant="secondary" size="sm" className="h-10 md:h-8" onClick={() => guard.leave(proposal?.backHref ?? "/studio/products")}>{isNew || dirty || proposal ? "Cancel" : "Back"}</Button>
              {/* One acid Save on screen: while the save bar shows, it carries the acid button. */}
              {/* With nothing to save, an existing product's button rests as "Saved" (after a save it shows the check first). */}
              <Button
                type="submit"
                form="product-form"
                variant={proposal ? (dirty ? "secondary" : "primary") : dirty || !isNew || draft ? "secondary" : "primary"}
                size="sm"
                className="h-10 md:h-8"
                loading={busy && !draft}
                success={!proposal && saveAction.succeeded && !dirty}
                disabled={processing || (draft && busy) || (!proposal && !dirty && !isNew && !saveAction.succeeded)}
              >
                {proposal ? proposal.saveLabel : draft && (isNew || dirty) ? "Save draft" : isNew ? "Save product" : dirty ? "Save" : "Saved"}
              </Button>
              {draft ? (
                // The one acid button while nothing else carries it; with the save bar up, the bar's Publish does.
                <Button type="button" variant={dirty ? "secondary" : "primary"} size="sm" className="h-10 md:h-8" loading={busy} disabled={processing} onClick={publishNow}>
                  Publish
                </Button>
              ) : null}
            </>
          }
        >
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {proposal ? null : <ListingPill status={isNew ? "draft" : baseline.status} hidden={brandHidden(listing)} size="lg" />}
            {/* The header button's check says it visually; this says it to screen readers. */}
            <span role="status" className="sr-only">{!isNew && saveAction.succeeded && !dirty ? "Changes saved" : ""}</span>
            <AnimatePresence initial={false}>
              {dirty ? (
                <motion.span key="dirty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="inline-flex items-center gap-1.5 text-xs text-ink-2">
                  <span className="size-1.5 rounded-full bg-acid" aria-hidden />
                  Unsaved changes
                </motion.span>
              ) : null}
            </AnimatePresence>
          </div>
        </PageHeader>
      </div>

      {isNew && !proposal ? <QuickAddTip /> : null}

      <AnimatePresence initial={false}>
        {errorList.length ? (
          <motion.div key="errors" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} role="alert" className="rounded-lg border border-danger/30 bg-danger/5 p-4">
            <p className="flex items-center gap-2 text-sm font-medium text-ink">
              <AlertTriangle className="size-4 text-danger" /> {errorList.length === 1 ? "Fix 1 field before saving" : `Fix ${errorList.length} fields before saving`}
            </p>
            <ul className="mt-2 grid gap-1 pl-6 text-xs text-ink-2">
              {errorList.slice(0, 6).map((t) => (
                <li key={t.key}>
                  <button
                    type="button"
                    className="text-left hover:text-ink hover:underline"
                    onClick={() => {
                      const el = document.getElementById(t.target)
                      el?.scrollIntoView({ block: "center", behavior: "smooth" })
                      el?.focus({ preventScroll: true })
                    }}
                  >
                    {t.label}: {errors[t.key]}
                  </button>
                </li>
              ))}
              {errorList.length > 6 ? <li>and {errorList.length - 6} more</li> : null}
            </ul>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {archived ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface p-4">
          <Archive className="size-4 text-ink-2" aria-hidden />
          <p id="pf-archived-note" className="min-w-0 flex-1 text-sm text-ink-2">This product is archived in Studio. Its orders and stock history stay.</p>
          <Button id="pf-restore" type="button" size="sm" variant="secondary" className="h-10 md:h-8" aria-describedby="pf-archived-note" onClick={restore}><ArchiveRestore /> {restoreLabel}</Button>
        </div>
      ) : null}

      <form
        id="product-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
        className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start"
      >
        <div className="grid min-w-0 gap-6">
          <Panel title="Details" description="Say what it is, what it's made of and how it fits.">
            <div className="grid gap-4">
              <Field id="pf-name" label="Name" error={errors.name} aside={<span className="text-xs text-ink-3 tabular">{form.name.length}/80</span>}>
                <Input {...control("pf-name", errors.name)} value={form.name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. Heavyweight hoodie" className={inputClass} />
              </Field>
              <Field
                id="pf-description"
                label="Description"
                error={errors.description}
                hint="For example: 480gsm loopback fleece with a puff-printed back graphic. Dropped shoulders, double-layer hood."
                aside={<span className="text-xs text-ink-3 tabular">{form.description.length}/2000</span>}
              >
                <Textarea {...control("pf-description", errors.description, true)} value={form.description} onChange={(e) => patch({ description: e.target.value })} rows={5} maxLength={2000} placeholder="e.g. Fabric, fit and care" className="min-h-28" />
              </Field>
            </div>
          </Panel>

          <ImageManager images={form.images} onChange={setImages} error={errors.photos} productName={form.name} library={library} upload={server?.upload} copy={proposal?.byYard ? BRAND_MEDIA_COPY_FOR_YARD : undefined} />

          <Panel title="Pricing" description={`In ${currency}. Shoppers see prices converted to their own currency.`}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id="pf-price"
                label="Price"
                error={errors.price}
                hint={price ? `You receive ${formatMoney(Math.round(price * (1 - commissionRateAt())), currency)} per sale (commission: ${commissionLabel()}).` : "What shoppers pay, before shipping."}
              >
                <InputGroup className={inputClass}>
                  <InputGroupAddon className="font-normal text-ink-3">{symbol}</InputGroupAddon>
                  <InputGroupInput {...control("pf-price", errors.price, true)} inputMode="decimal" value={form.price} onChange={(e) => patch({ price: e.target.value })} placeholder="0" className="tabular" />
                  <InputGroupAddon align="inline-end" className="font-normal text-ink-3">{currency}</InputGroupAddon>
                </InputGroup>
              </Field>
              <Field id="pf-compare" label="Compare-at price" optional error={errors.compareAt} hint={off ? `Shows as ${off}% off, with the higher price struck through.` : "The original price, shown struck through. Must be higher than the price."}>
                <InputGroup className={inputClass}>
                  <InputGroupAddon className="font-normal text-ink-3">{symbol}</InputGroupAddon>
                  <InputGroupInput {...control("pf-compare", errors.compareAt, true)} inputMode="decimal" value={form.compareAt} onChange={(e) => patch({ compareAt: e.target.value })} placeholder="0" className="tabular" />
                  <InputGroupAddon align="inline-end" className="font-normal text-ink-3">{currency}</InputGroupAddon>
                </InputGroup>
              </Field>
            </div>
          </Panel>

          <OptionsBuilder form={form} errors={errors} onOptions={setOptions} onVariant={setVariant} onAllStock={(stock) => setForm((f) => ({ ...f, variants: f.variants.map((v) => ({ ...v, stock })) }))} onAddColour={addColour} />

          <Panel title="Shipping" description={`Ships from ${brand.city}. Delivery times are added at checkout for each shopper's country.`}>
            <fieldset className="grid gap-1.5">
              <legend className="mb-1.5 text-[13px] text-ink">Processing time</legend>
              <div className="flex items-center gap-2">
                <Input {...control("pf-processing-min", errors.processing, true)} aria-label="Fewest days to ship" inputMode="numeric" value={form.processingMin} onChange={(e) => patch({ processingMin: e.target.value.replace(/\D/g, "").slice(0, 2) })} className={cn(inputClass, "w-20 tabular")} />
                <span className="text-sm text-ink-2">to</span>
                <Input {...control("pf-processing-max", errors.processing, true)} aria-label="Most days to ship" inputMode="numeric" value={form.processingMax} onChange={(e) => patch({ processingMax: e.target.value.replace(/\D/g, "").slice(0, 2) })} className={cn(inputClass, "w-20 tabular")} />
                <span className="text-sm text-ink-2">business days</span>
              </div>
              {errors.processing ? (
                <p id="pf-processing-min-error" className="text-xs text-danger">{errors.processing}</p>
              ) : (
                proposal?.byYard ? (
                  <p id="pf-processing-min-hint" className="text-xs leading-relaxed text-ink-3">
                    How long {brand.name} takes to pack an order and hand it to the courier ({brand.name}&apos;s default is {brand.processingDays[0]} to {brand.processingDays[1]} days).
                  </p>
                ) : proposal ? (
                  <p id="pf-processing-min-hint" className="text-xs leading-relaxed text-ink-3">
                    How long you take to pack an order and hand it to the courier (your default is {brand.processingDays[0]} to {brand.processingDays[1]} days). Change your default in{" "}
                    <Link href="/studio/shipping" className="font-medium text-ink underline-offset-4 hover:text-violet hover:underline">
                      Shipping &amp; fulfilment
                    </Link>
                    .
                  </p>
                ) : (
                <p id="pf-processing-min-hint" className="text-xs leading-relaxed text-ink-3">
                  How long you take to pack an order and hand it to the courier (your default is {brand.processingDays[0]} to {brand.processingDays[1]} days). Changes here stay in this browser for now, so shoppers&apos; delivery estimates don&apos;t use them yet. Estimates use your handling time in{" "}
                  <Link href="/studio/shipping" className="font-medium text-ink underline-offset-4 hover:text-violet hover:underline">
                    Shipping &amp; fulfilment
                  </Link>
                  .
                </p>
                )
              )}
            </fieldset>
          </Panel>
        </div>

        <div className="grid min-w-0 gap-6">
          {proposal?.aside}
          {proposal ? (
            <Panel title="Publishing" description={proposal.publishNote}>
              {proposal.publishHint ? <CatalogueNote>{proposal.publishHint}</CatalogueNote> : null}
            </Panel>
          ) : (
          <Panel id="publishing-panel" title="Publishing" description={archived ? "Restore the product to change how it's published." : statusCopy[form.status as keyof typeof statusCopy]}>
            {archived ? (
              server ? <CatalogueNote>Restore this product to make changes to how it&apos;s published.</CatalogueNote> : <CatalogueNote />
            ) : (
              <div className="grid gap-3">
                <Segmented
                  id="pf-status"
                  label="Publication status"
                  value={form.status}
                  onChange={setStatus}
                  options={[
                    { value: "draft", label: "Draft" },
                    { value: "published", label: "Published" },
                    { value: "scheduled", label: "Scheduled" },
                  ]}
                />
                {/* Appears in place with a fade (opacity only): nothing below re-lays out frame by frame. */}
                {form.status === "scheduled" ? (
                  <motion.div key="when" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: duration.dropdown, ease: ease.out }}>
                    <Field
                      id="pf-publish-at"
                      label="Go-live time"
                      error={errors.publishAt}
                      hint={pastDue ? "This time has passed and the product isn't live. Publish it now or pick a new time." : server ? "In your local time. The product goes live automatically at this time." : "In your local time. Nothing publishes automatically in this build yet: publish it yourself at that time."}
                      className="pt-1"
                    >
                      <Input {...control("pf-publish-at", errors.publishAt, true)} type="datetime-local" value={form.publishAt} onChange={(e) => patch({ publishAt: e.target.value })} className={cn(inputClass, "[color-scheme:dark]")} />
                    </Field>
                  </motion.div>
                ) : null}
                <CatalogueNote className="pt-1">{server ? "Published products reach shoppers in the marketplace." : undefined}</CatalogueNote>
              </div>
            )}
          </Panel>
          )}

          <Panel title="Organisation" description="Where shoppers find it when they browse and filter.">
            <div className="grid gap-4">
              <Field id="pf-category" label="Category" error={errors.category}>
                <Select
                  value={form.category}
                  onValueChange={(v) => {
                    const next = v as CategorySlug
                    const subs = categoryBySlug.get(next)?.subcategories ?? []
                    setForm((f) => ({ ...f, category: next, subcategory: subs.includes(f.subcategory) ? f.subcategory : "" }))
                  }}
                >
                  <SelectTrigger {...control("pf-category", errors.category)} className={selectClass}>
                    <SelectValue placeholder="Choose a category" />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    {categories.map((c) => (
                      <SelectItem key={c.slug} value={c.slug}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field id="pf-subcategory" label="Subcategory" error={errors.subcategory}>
                <Select value={form.subcategory} onValueChange={(v) => patch({ subcategory: v })} disabled={!category}>
                  <SelectTrigger {...control("pf-subcategory", errors.subcategory)} className={selectClass}>
                    <SelectValue placeholder={category ? "Choose a subcategory" : "Choose a category first"} />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    {(category?.subcategories ?? []).map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <TagsField tags={form.tags} onChange={(tags) => patch({ tags })} suggestions={tagSuggestions} />
            </div>
          </Panel>

          <Panel title="Collections" description="Group it with related pieces on your storefront." action={proposal ? undefined : <Link href="/studio/collections" className="text-xs whitespace-nowrap text-violet hover:underline">Manage</Link>}>
            {collections.length ? (
              <ul className="grid gap-1">
                {collections.map((c) => {
                  const on = form.collectionIds.includes(c.id)
                  return (
                    <li key={c.id}>
                      <label className={cn("flex cursor-pointer items-center gap-3 rounded-md p-1.5 transition-colors hover:bg-white/[0.03]", on && "bg-purple/[0.08]")}>
                        <Checkbox checked={on} onCheckedChange={(v) => patch({ collectionIds: v === true ? [...form.collectionIds, c.id] : form.collectionIds.filter((x) => x !== c.id) })} />
                        <Thumb image={c.image} size={32} loading="eager" />
                        <span className="min-w-0 flex-1 truncate text-sm text-ink">{c.name}</span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="text-sm text-ink-2">
                {proposal ? "No collections yet." : <>No collections yet. <Link href="/studio/collections" className="text-violet hover:underline">Create one</Link> to group products on your storefront.</>}
              </p>
            )}
          </Panel>

          {!isNew && !proposal ? (
            <Panel title="Remove product" description={server ? "Archive to set it aside. Orders and stock history stay, and you can restore it later." : archived ? "Delete removes it for good." : "Archive to set it aside and keep its history. Delete removes it for good."}>
              <div className="flex flex-wrap gap-2">
                {archived ? null : (
                  <Button type="button" size="sm" variant="secondary" className="h-10 md:h-8" onClick={() => setDialog("archive")}><Archive /> Archive</Button>
                )}
                {server ? null : <Button type="button" size="sm" variant="destructive" className="h-10 md:h-8" onClick={() => setDialog("delete")}><Trash2 /> Delete</Button>}
              </div>
            </Panel>
          ) : null}
        </div>
      </form>

      <SaveBar
        visible={dirty}
        label={processing ? "Preparing photos" : isNew ? "Unsaved product" : "Unsaved changes"}
        saveLabel={proposal ? proposal.saveLabel : draft ? "Save draft" : isNew ? "Save product" : "Save"}
        onSave={() => save()}
        publish={draft ? { label: "Publish", onClick: publishNow } : undefined}
        onDiscard={() => setDialog("discard")}
        saving={busy}
        blocked={processing}
      />

      <PublishBar visible={savedDraft} onPublish={publishNow} publishing={busy} label={listing && brandHidden(listing) ? "Draft: hidden until you publish" : "Draft: only you can see this"} />

      {guard.dialog}
      <ConfirmDialog
        open={dialog === "discard"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Discard unsaved changes?"
        body={isNew ? "Everything you've entered for this product will be cleared." : "The product goes back to how it was when you last saved."}
        confirmLabel="Discard changes"
        onConfirm={discard}
        returnFocus={() => document.getElementById("pf-back")}
      />
      {product ? (
        <>
          <ConfirmDialog
            open={dialog === "archive"}
            onOpenChange={(o) => !o && setDialog(null)}
            title={`Archive ${product.name}?`}
            body="It moves to the Archived tab and out of your inventory list. Orders and stock history stay, and you can restore it at any time."
            confirmLabel="Archive product"
            onConfirm={archive}
            returnFocus={toRestore}
          />
          <ConfirmDialog
            open={dialog === "delete"}
            onOpenChange={(o) => !o && setDialog(null)}
            title={hasOrders ? "This product has orders" : `Delete ${product.name}?`}
            body={hasOrders ? "Products that have been ordered can't be deleted, so order records stay complete. Archive it instead: it moves to the Archived tab and its history stays." : "It's removed from your Studio catalogue, collections and inventory for good. This can't be undone."}
            confirmLabel={hasOrders ? "Archive instead" : "Delete product"}
            onConfirm={remove}
            returnFocus={toRestore}
          />
        </>
      ) : null}
    </div>
  )
}

const QUICK_TIP_KEY = "yard-studio-quick-add-tip"

/**
 * The full editor's one tip for newcomers: Quick add does the same job in five small steps.
 * Dismissed for good on this browser (storage wrapped: blocked storage just shows it again).
 */
function QuickAddTip() {
  const [hidden, setHidden] = useState(true)
  useEffect(() => {
    let seen = false
    try {
      seen = window.localStorage.getItem(QUICK_TIP_KEY) === "dismissed"
    } catch {
      // Storage refused: show it.
    }
    // Read after mount (storage isn't available on the server render).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHidden(seen)
  }, [])
  if (hidden) return null
  function dismiss() {
    try {
      window.localStorage.setItem(QUICK_TIP_KEY, "dismissed")
    } catch {
      // Hidden for this visit only.
    }
    setHidden(true)
  }
  return (
    <aside aria-label="Tip" className="rise-in flex items-start gap-3 rounded-lg border border-line-soft bg-surface p-3 pr-2 sm:items-center">
      <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-acid/15 text-acid sm:mt-0" aria-hidden>
        <Lightning weight="fill" className="size-3.5" />
      </span>
      <p className="min-w-0 flex-1 text-[13px] text-ink-2">
        <span className="text-ink">First time here?</span> Quick add lists a product in 5 baby steps, one question at a time.{" "}
        <Link href={QUICK_ADD_HREF} className="font-medium whitespace-nowrap text-ink underline-offset-4 hover:text-violet hover:underline">
          Try Quick add
        </Link>
      </p>
      <Button type="button" variant="ghost" size="icon-sm" className="size-10 shrink-0 text-ink-3 md:size-8" aria-label="Dismiss tip" onClick={dismiss}>
        <XClose />
      </Button>
    </aside>
  )
}

function TagsField({ tags, onChange, suggestions }: { tags: string[]; onChange: (t: string[]) => void; suggestions: string[] }) {
  const [message, setMessage] = useState<string | null>(null)
  return (
    <Field
      id="pf-tags"
      label="Tags"
      aside={<span className="text-xs text-ink-3 tabular">{tags.length}/{MAX_TAGS}</span>}
      error={message ?? undefined}
      hint="Materials, fit or the drop it belongs to. Shoppers search by these."
    >
      <ChipInput
        id="pf-tags"
        values={tags}
        onChange={onChange}
        placeholder="Add a tag and press Enter"
        max={MAX_TAGS}
        normalise={(s) => s.trim().toLowerCase().replace(/\s+/g, " ")}
        suggestions={suggestions}
        invalid={!!message}
        describedBy={message ? "pf-tags-error" : "pf-tags-hint"}
        onMessage={setMessage}
      />
    </Field>
  )
}
