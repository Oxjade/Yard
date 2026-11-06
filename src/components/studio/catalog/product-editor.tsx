"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AnimatePresence, motion } from "motion/react"
import { AlertTriangle, Archive, ArchiveRestore, ChevronLeft, PackageX, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { EmptyState } from "@/components/dashboard/empty-state"
import { PageHeader } from "@/components/dashboard/page-header"
import { Bone } from "@/components/feedback/skeletons"
import { StatusBadge, productStatusMeta } from "@/components/dashboard/status-badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useNow } from "@/hooks/use-now"
import { currencies } from "@/config/markets"
import { site } from "@/config/site"
import { products as seedProducts } from "@/lib/data"
import { brandById } from "@/lib/data/brands"
import { categories, categoryBySlug } from "@/lib/data/catalog"
import type { Brand, CategorySlug, Product, Variant } from "@/lib/data/types"
import { formatMoney } from "@/lib/money"
import { useStudio } from "@/lib/stores/studio"
import { cn } from "@/lib/utils"
import { ConfirmDialog, control, Field, inputClass, Panel, Segmented, selectClass } from "./fields"
import { ImageManager, type FormImage } from "./image-manager"
import { OptionsBuilder } from "./options-builder"
import { Thumb } from "./parts"
import {
  buildImages,
  buildOptions,
  colourKey,
  emptyForm,
  errorTargets,
  fromProduct,
  snapshot,
  uniqueSlug,
  validate,
  withVariants,
  type Errors,
  type FormVariant,
  type ProductForm,
} from "./product-form-model"
import { SaveBar, useLeaveGuard } from "./save-bar"
import { useBrandCollections, useCatalog, useCatalogReady, type ProductMeta } from "./store"
import { ChipInput } from "./tag-input"
import { autoSku, brandPhotos, formatDate, formatDateTime, MAX_TAGS, parseMoney, plural, productIdFor, slugify, toLocalInput } from "./utils"

/** Products deleted from their own page, so the page doesn't flash "not found" while it navigates away. */
const deletedHere = new Set<string>()

/** Loads the product once saved data is in, then hands it to the editor. No id = a new product. */
export function ProductEditorRoute({ id }: { id?: string }) {
  const ready = useCatalogReady()
  const brandId = useStudio((s) => s.brandId)
  const product = useStudio((s) => (id ? s.products.find((p) => p.id === id) : undefined))
  const meta = useCatalog((s) => (id ? s.productMeta[id] : undefined))
  const brand = brandById.get(brandId)!

  if (!ready) return <EditorSkeleton />
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
  return <ProductEditor key={id ?? "new"} product={product} meta={meta} brand={brand} />
}

function BackLink() {
  return (
    <Link href="/studio/products" className="inline-flex w-fit items-center gap-1 text-xs text-ink-2 hover:text-ink">
      <ChevronLeft className="size-3.5" /> Products
    </Link>
  )
}

const statusCopy: Record<"draft" | "published" | "scheduled", string> = {
  draft: "Only you can see it. Publish when it's ready.",
  published: "Visible on your storefront and in the marketplace.",
  scheduled: "Set to go live at the time you pick. Until then only you can see it.",
}

function savedDescription(status: Product["status"], publishAt: string | null) {
  if (status === "published") return "Live on your storefront and in the marketplace."
  if (status === "scheduled" && publishAt) return `Set to go live ${formatDateTime(publishAt)}.`
  if (status === "archived") return "Archived, so it stays hidden from shoppers."
  return "Saved as a draft. Only you can see it."
}

function ProductEditor({ product, meta, brand }: { product?: Product; meta?: ProductMeta; brand: Brand }) {
  const router = useRouter()
  const allProducts = useStudio((s) => s.products)
  const orders = useStudio((s) => s.orders)
  const studioDrops = useStudio((s) => s.drops)
  const collections = useBrandCollections(brand.id)

  const [baseline, setBaseline] = useState<ProductForm>(() => (product ? fromProduct(product, meta, brand) : emptyForm(brand)))
  const [form, setForm] = useState<ProductForm>(baseline)
  const [checkedAt, setCheckedAt] = useState<number | null>(null)
  const [focusTick, setFocusTick] = useState(0)
  const [saving, setSaving] = useState(false)
  const [dialog, setDialog] = useState<null | "archive" | "delete" | "discard">(null)
  const now = useNow(60_000)

  const currency = brand.currency
  const symbol = currencies[currency].symbol
  const isNew = !product
  const dirty = useMemo(() => snapshot(form) !== snapshot(baseline), [form, baseline])
  const processing = form.images.some((im) => im.processing)
  const hasOrders = !!product && orders.some((o) => o.lines.some((l) => l.productId === product.id))

  /** Variants as the product had them when the form opened: restored if an option comes back. */
  const pool = useMemo(() => new Map(baseline.variants.filter((v) => v.id).map((v) => [v.key, v])), [baseline])
  const otherSkus = useMemo(() => new Set(allProducts.filter((p) => p.id !== product?.id).flatMap((p) => p.variants.map((v) => v.sku.toUpperCase()))), [allProducts, product?.id])
  const original: Variant[] = useMemo(() => product?.variants ?? [], [product])

  const errors: Errors = useMemo(() => (checkedAt === null ? {} : validate(form, { brand, otherSkus, original, now: checkedAt })), [checkedAt, form, brand, otherSkus, original])
  const errorList = useMemo(() => errorTargets(form).filter((t) => errors[t.key]), [errors, form])

  const library = useMemo(() => brandPhotos(brand, allProducts, collections, studioDrops), [brand, allProducts, collections, studioDrops])
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
  useEffect(() => {
    live.current = { dirty, saving, baseline }
  })
  useEffect(() => {
    if (!product || product === synced.current) return
    synced.current = product
    if (live.current.dirty || live.current.saving) return
    const fresh = fromProduct(product, meta, brand)
    setBaseline(fresh)
    setForm(fresh)
  }, [product, meta, brand])
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

  function save() {
    const now = Date.now()
    const errs = validate(form, { brand, otherSkus, original, now })
    setCheckedAt(now)
    if (Object.values(errs).some(Boolean)) {
      setFocusTick((t) => t + 1)
      toast.error("Check the highlighted fields", { description: "Nothing was saved yet." })
      return
    }
    if (processing) {
      toast("Photos are still being prepared", { description: "Try again in a moment." })
      return
    }
    setSaving(true)

    const store = useStudio.getState()
    const name = form.name.trim()
    const taken = new Set([...seedProducts, ...store.products].flatMap((p) => [p.slug, p.id]))
    const slug = product?.slug ?? uniqueSlug(name, taken)
    const id = product?.id ?? productIdFor(slug)
    const live = store.products.find((p) => p.id === id)

    let next = Math.max(-1, ...(product?.variants ?? []).map((v) => Number(/_v(\d+)$/.exec(v.id)?.[1] ?? -1))) + 1
    const adjustments: { variantId: string; delta: number }[] = []
    const variants: Variant[] = form.variants.map((v) => {
      const sku = v.sku.trim().toUpperCase()
      const qty = Number(v.stock)
      if (v.id) {
        const current = live?.variants.find((x) => x.id === v.id)
        const base = current?.stock ?? v.originalStock ?? qty
        const delta = qty - (v.originalStock ?? qty)
        if (delta !== 0) adjustments.push({ variantId: v.id, delta })
        return { id: v.id, sku, options: v.options, stock: base, reserved: current?.reserved ?? v.reserved }
      }
      return { id: `${id}_v${next++}`, sku, options: v.options, stock: qty, reserved: 0 }
    })

    const publishAt = form.status === "scheduled" ? new Date(form.publishAt).toISOString() : null
    const saved: Product = {
      ...(product ?? {}),
      id,
      slug,
      brandId: brand.id,
      name,
      description: form.description.trim(),
      details: product?.details ?? [],
      category: form.category as CategorySlug,
      subcategory: form.subcategory,
      tags: form.tags,
      price: parseMoney(form.price, currency)!,
      compareAt: form.compareAt.trim() ? parseMoney(form.compareAt, currency)! : undefined,
      currency,
      images: buildImages(form.images, name, brand),
      options: buildOptions(form),
      variants,
      badges: product?.badges ?? ["new"],
      status: form.status,
      createdAt: product?.createdAt ?? new Date(now).toISOString(),
      collectionIds: form.collectionIds.filter((cid) => collections.some((c) => c.id === cid)),
      dropId: product?.dropId,
      stats: product?.stats ?? { views7d: 0, wishlists: 0, sales30d: 0, trend: 0 },
    }

    store.upsertProduct(saved)
    for (const a of adjustments) store.adjustStock(id, a.variantId, a.delta, "adjustment", "Edited on the product page")
    const newMeta: ProductMeta = { processingDays: [Number(form.processingMin), Number(form.processingMax)], publishAt, updatedAt: new Date(now).toISOString() }
    useCatalog.getState().setProductMeta(id, newMeta)

    toast.success(isNew ? "Product created" : "Changes saved", { description: savedDescription(saved.status, publishAt) })

    if (isNew) {
      created.current = true
      router.replace(`/studio/products/${id}`)
      return
    }
    const fresh = useStudio.getState().products.find((p) => p.id === id) ?? saved
    synced.current = fresh
    const reset = fromProduct(fresh, useCatalog.getState().productMeta[id], brand)
    stash.current.clear()
    setBaseline(reset)
    setForm(reset)
    setCheckedAt(null)
    setSaving(false)
  }

  function discard() {
    stash.current.clear()
    setForm(baseline)
    setCheckedAt(null)
    toast("Changes discarded")
  }

  function setStoredStatus(status: Product["status"]) {
    if (!product) return
    useStudio.getState().setProductStatus(product.id, status)
    useCatalog.getState().touchProducts([product.id])
    setForm((f) => ({ ...f, status }))
    setBaseline((b) => ({ ...b, status }))
  }

  function archive() {
    if (!product) return
    const previous = baseline.status
    setStoredStatus("archived")
    toast.success("Product archived", {
      description: "Hidden from your storefront and the marketplace.",
      action: { label: "Undo", onClick: () => setStoredStatus(previous) },
    })
  }

  function restore() {
    setStoredStatus("draft")
    toast.success("Product restored as a draft", { description: "Publish it when you're ready to sell it again." })
  }

  function remove() {
    if (!product) return
    if (hasOrders) {
      archive()
      return
    }
    setSaving(true)
    deletedHere.add(product.id)
    window.setTimeout(() => deletedHere.delete(product.id), 3000)
    guard.go("/studio/products")
    useStudio.getState().removeProduct(product.id)
    useCatalog.getState().removeProductMeta(product.id)
    toast.success("Product deleted", { description: `${product.name} was removed from your catalogue.` })
  }

  const status = productStatusMeta[form.status]
  const price = parseMoney(form.price, currency)
  const compare = form.compareAt.trim() ? parseMoney(form.compareAt, currency) : null
  const off = price && compare && compare > price ? Math.round((1 - price / compare) * 100) : null
  const archived = form.status === "archived"
  /** Nothing publishes on a timer until the backend exists, so say plainly when a set time has passed. */
  const pastDue = !!now && product?.status === "scheduled" && !!meta?.publishAt && form.publishAt === baseline.publishAt && Date.parse(meta.publishAt) <= now

  return (
    <div className={cn("grid gap-6", dirty && "pb-24")}>
      <div className="grid gap-2">
        <BackLink />
        <PageHeader
          title={isNew ? "New product" : product.name}
          description={isNew ? "Add photos, a price and the sizes you stock. Save it as a draft until it's ready." : `Added ${formatDate(product.createdAt)}. ${plural(product.variants.length, "variant")}, ${plural(product.images.length, "photo")}.`}
          actions={
            <>
              <Button type="button" variant="secondary" size="sm" onClick={() => guard.leave("/studio/products")}>Cancel</Button>
              {/* One acid Save on screen: while the save bar shows, it carries the acid button. */}
              <Button type="submit" form="product-form" variant={dirty ? "secondary" : "primary"} size="sm" disabled={saving}>
                {isNew ? "Save product" : "Save"}
              </Button>
            </>
          }
        >
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
            {!isNew && product.status === "published" ? (
              <Link href={`/brands/${brand.handle}`} target="_blank" className="text-xs text-violet hover:underline">View storefront</Link>
            ) : null}
            {dirty ? <span className="text-xs text-ink-3">Unsaved changes</span> : null}
          </div>
        </PageHeader>
      </div>

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
          <Archive className="size-4 text-ink-2" />
          <p className="min-w-0 flex-1 text-sm text-ink-2">This product is archived. Shoppers can&apos;t see it, and its orders and stock history stay.</p>
          <Button type="button" size="sm" variant="secondary" onClick={restore}><ArchiveRestore /> Restore as draft</Button>
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
                <Input {...control("pf-name", errors.name)} value={form.name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Danfo heavyweight hoodie" className={inputClass} />
              </Field>
              <Field id="pf-description" label="Description" error={errors.description} aside={<span className="text-xs text-ink-3 tabular">{form.description.length}/2000</span>}>
                <Textarea {...control("pf-description", errors.description)} value={form.description} onChange={(e) => patch({ description: e.target.value })} rows={5} maxLength={2000} placeholder="480gsm loopback fleece with a puff-printed back graphic. Dropped shoulders, double-layer hood. Made in a run of 180." className="min-h-28" />
              </Field>
            </div>
          </Panel>

          <ImageManager images={form.images} onChange={setImages} error={errors.photos} productName={form.name} library={library} />

          <Panel title="Pricing" description={`In ${currency}. Shoppers see prices converted to their own currency.`}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id="pf-price"
                label="Price"
                error={errors.price}
                hint={price ? `You receive ${formatMoney(Math.round(price * (1 - site.commissionRate)), currency)} per sale after the ${Math.round(site.commissionRate * 100)}% commission.` : "What shoppers pay, before shipping."}
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
              {errors.processing ? <p id="pf-processing-min-error" className="text-xs text-danger">{errors.processing}</p> : <p id="pf-processing-min-hint" className="text-xs text-ink-3">How long you take to pack an order and hand it to the courier. Your default is {brand.processingDays[0]} to {brand.processingDays[1]} days.</p>}
            </fieldset>
          </Panel>
        </div>

        <div className="grid min-w-0 gap-6">
          <Panel title="Publishing" description={archived ? "Restore the product to change how it's published." : statusCopy[form.status as keyof typeof statusCopy]}>
            {archived ? null : (
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
                <AnimatePresence initial={false}>
                  {form.status === "scheduled" ? (
                    <motion.div key="when" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                      <Field id="pf-publish-at" label="Go-live time" error={errors.publishAt} hint={pastDue ? "This time has passed and the product isn't live. Publish it now or pick a new time." : "In your local time."} className="pt-1">
                        <Input {...control("pf-publish-at", errors.publishAt, true)} type="datetime-local" value={form.publishAt} onChange={(e) => patch({ publishAt: e.target.value })} className={cn(inputClass, "[color-scheme:dark]")} />
                      </Field>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </div>
            )}
          </Panel>

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

          <Panel title="Collections" description="Group it with related pieces on your storefront." action={<Link href="/studio/collections" className="text-xs whitespace-nowrap text-violet hover:underline">Manage</Link>}>
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
                No collections yet. <Link href="/studio/collections" className="text-violet hover:underline">Create one</Link> to group products on your storefront.
              </p>
            )}
          </Panel>

          {!isNew ? (
            <Panel title="Remove product" description={archived ? "Delete removes it for good." : "Archive to hide it and keep its history. Delete removes it for good."}>
              <div className="flex flex-wrap gap-2">
                {archived ? null : (
                  <Button type="button" size="sm" variant="secondary" onClick={() => setDialog("archive")}><Archive /> Archive</Button>
                )}
                <Button type="button" size="sm" variant="destructive" onClick={() => setDialog("delete")}><Trash2 /> Delete</Button>
              </div>
            </Panel>
          ) : null}
        </div>
      </form>

      <SaveBar visible={dirty} label={isNew ? "Unsaved product" : "Unsaved changes"} onSave={save} onDiscard={() => setDialog("discard")} saving={saving || processing} busyLabel={processing ? "Preparing photos" : "Saving"} />

      {guard.dialog}
      <ConfirmDialog
        open={dialog === "discard"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Discard unsaved changes?"
        body={isNew ? "Everything you've entered for this product will be cleared." : "The product goes back to how it was when you last saved."}
        confirmLabel="Discard changes"
        onConfirm={discard}
      />
      {product ? (
        <>
          <ConfirmDialog
            open={dialog === "archive"}
            onOpenChange={(o) => !o && setDialog(null)}
            title={`Archive ${product.name}?`}
            body="It's hidden from your storefront and the marketplace. Orders and stock history stay, and you can restore it at any time."
            confirmLabel="Archive product"
            onConfirm={archive}
          />
          <ConfirmDialog
            open={dialog === "delete"}
            onOpenChange={(o) => !o && setDialog(null)}
            title={hasOrders ? "This product has orders" : `Delete ${product.name}?`}
            body={hasOrders ? "Products that have been ordered can't be deleted, so order records stay complete. Archive it instead to hide it from shoppers." : "It's removed from your catalogue, collections and inventory for good. This can't be undone."}
            confirmLabel={hasOrders ? "Archive instead" : "Delete product"}
            onConfirm={remove}
          />
        </>
      ) : null}
    </div>
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

function EditorSkeleton() {
  return (
    <div role="status" aria-label="Loading product" className="grid gap-6">
      <div className="grid gap-3 border-b border-line-soft pb-5">
        <Bone className="h-3 w-20" />
        <Bone className="h-7 w-64" />
        <Bone className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid gap-6">
          <Bone className="h-56 rounded-lg" />
          <Bone className="h-80 rounded-lg" />
        </div>
        <div className="grid content-start gap-6">
          <Bone className="h-36 rounded-lg" />
          <Bone className="h-56 rounded-lg" />
        </div>
      </div>
    </div>
  )
}
