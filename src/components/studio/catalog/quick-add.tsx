"use client"

import { useEffect, useId, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AnimatePresence, motion } from "motion/react"
import {
  ArrowLeftIcon as ArrowLeft,
  ArrowRightIcon as ArrowRight,
  ArrowSquareOutIcon as External,
  CaretLeftIcon as ChevronLeft,
  CheckCircleIcon as CheckCircle,
  CheckIcon as Check,
  FrameCornersIcon as Frame,
  LinkSimpleIcon as LinkIcon,
  MinusIcon as Minus,
  PlusIcon as Plus,
  ShareNetworkIcon as Share,
  StorefrontIcon as Storefront,
  SunIcon as Sun,
  SquaresFourIcon as Squares,
} from "@phosphor-icons/react"
import { toast } from "sonner"
import { ProductCard } from "@/components/market/product-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Textarea } from "@/components/ui/textarea"
import { useSettingsReady } from "@/components/studio/business/settings-store"
import { useListingFacts } from "@/components/studio/setup/use-listing"
import { currencies } from "@/config/markets"
import { ApiError, api } from "@/lib/api/client"
import type { StudioProductDto, StudioProductResponse } from "@/lib/api/contracts/catalog"
import type { StudioShippingDto } from "@/lib/api/contracts/shipping"
import { getStudioShipping, STUDIO_SHIPPING_KEY } from "@/lib/api/shipping"
import { apiUpload } from "@/lib/api/upload"
import { revalidatePrefix, useApi } from "@/lib/api/use-api"
import { commissionLabel, commissionRateAt } from "@/lib/commission"
import { brandById, STUDIO_BRAND_ID } from "@/lib/data/brands"
import { categories, categoryBySlug } from "@/lib/data/catalog"
import type { Brand, CategorySlug, Product } from "@/lib/data/types"
import { brandHidden, FULL_EDITOR_HREF } from "@/lib/listing-guide"
import { formatMoney } from "@/lib/money"
import { useServerSession } from "@/lib/session/use-server-session"
import { useStudio } from "@/lib/stores/studio"
import { cn } from "@/lib/utils"
import { FieldMessage } from "./fields"
import { ImageManager, type FormImage, type UploadedImage } from "./image-manager"
import { announcePublished, publishSavedProduct } from "./listing-feedback"
import { fromStudioProduct, loadStudioProductDtos } from "./live"
import { liveBrand, useSettingsBrand } from "./product-editor"
import { emptyForm, validate, withVariants, type Errors, type ProductForm } from "./product-form-model"
import { liveProductBody, localProductFrom, publishLiveProduct } from "./product-save"
import { ProductEditorSkeleton } from "./skeletons"
import { useCatalogReady } from "./store"
import { autoSku, parseMoney, plural, slugify } from "./utils"

/* ---------- The steps ---------- */

const STEPS = [
  { key: "photos", label: "Photos" },
  { key: "name", label: "Name" },
  { key: "price", label: "Price" },
  { key: "sizes", label: "Sizes & stock" },
  { key: "review", label: "Review" },
] as const
type StepKey = (typeof STEPS)[number]["key"]

/** Which validation messages (product-form-model validate, the full editor's own rules) belong to which step. */
const owns: Record<Exclude<StepKey, "review">, (key: string) => boolean> = {
  photos: (k) => k === "photos",
  name: (k) => k === "name" || k === "description" || k === "category" || k === "subcategory",
  price: (k) => k === "price" || k === "compareAt",
  sizes: (k) => k === "sizes" || k === "colours" || k === "variants" || k.startsWith("colour-") || k.startsWith("stock-") || k.startsWith("sku-"),
}
const stepOf = (key: string): number => {
  const i = STEPS.findIndex((s) => s.key !== "review" && owns[s.key](key))
  return i < 0 ? STEPS.length - 1 : i
}

/** Sizes to tap, by category; anything else can be typed in. */
function sizeChoices(category: CategorySlug | "", subcategory: string) {
  if (category === "sneakers" || subcategory === "Footwear") return ["38", "39", "40", "41", "42", "43", "44", "45", "46"]
  if (category === "jewelry" && subcategory === "Rings") return ["5", "6", "7", "8", "9", "10", "11"]
  if (category === "fashion" || category === "streetwear") return ["XS", "S", "M", "L", "XL", "XXL"]
  return ["S", "M", "L"]
}

/* ---------- Saved progress (this device) ---------- */

const storeKey = (brandId: string) => `yard-quick-add:${brandId}`
type Saved = { v: 1; step: number; form: ProductForm; at: string }

function readSaved(brandId: string): Saved | null {
  try {
    const raw = window.localStorage.getItem(storeKey(brandId))
    if (!raw) return null
    const saved = JSON.parse(raw) as Saved
    if (saved?.v !== 1 || !saved.form || typeof saved.step !== "number") return null
    return saved
  } catch {
    return null
  }
}

/** Photos still uploading (object URLs) can't be kept; everything else is. */
function writeSaved(brandId: string, step: number, form: ProductForm) {
  try {
    const keep: ProductForm = { ...form, images: form.images.filter((im) => !im.processing) }
    window.localStorage.setItem(storeKey(brandId), JSON.stringify({ v: 1, step, form: keep, at: new Date().toISOString() } satisfies Saved))
    return true
  } catch {
    return false
  }
}

function clearSaved(brandId: string) {
  try {
    window.localStorage.removeItem(storeKey(brandId))
  } catch {
    // Nothing to clear.
  }
}

const hasProgress = (f: ProductForm) => !!(f.images.length || f.name.trim() || f.price.trim() || f.description.trim())

/* ---------- Routes ---------- */

type Live = { upload: (file: File) => Promise<UploadedImage> }

/**
 * Quick add (/studio/products/quick): list a product in five small steps, one question per
 * screen. It makes exactly the product the full editor would (the same form model, validation
 * and request body, src/components/studio/catalog/product-save.ts), for a live brand on Yard's
 * server and for the sample store in the demo.
 */
export function QuickAddRoute() {
  const liveMember = useServerSession((s) => (s.brand && !s.brand.demo ? s.brand.brand : null))
  if (liveMember) return <LiveQuickAdd member={liveMember} />
  return <LocalQuickAdd />
}

function LocalQuickAdd() {
  const catalogReady = useCatalogReady()
  const settingsReady = useSettingsReady()
  const brandId = useStudio((s) => s.brandId)
  const products = useStudio((s) => s.products)
  const brand = brandById.get(brandId)!
  if (!catalogReady || !settingsReady) return <ProductEditorSkeleton />
  return <QuickAdd profile={brand} products={products} />
}

function LiveQuickAdd({ member }: { member: { id: string; handle: string; name: string } }) {
  const settingsReady = useSettingsReady()
  const productsQuery = useApi(`studio.catalog:${member.id}`, loadStudioProductDtos, { keepPrevious: false })
  const shippingQuery = useApi<StudioShippingDto>(`${STUDIO_SHIPPING_KEY}:${member.id}`, () => getStudioShipping(), { revalidateOnFocus: false })
  const base = brandById.get(STUDIO_BRAND_ID)!
  const brand = useMemo(() => liveBrand(base, member, shippingQuery.data), [base, member, shippingQuery.data])
  const products = useMemo(() => (productsQuery.data ?? []).map(fromStudioProduct), [productsQuery.data])
  const live = useMemo<Live>(
    () => ({
      upload: async (file) => {
        const media = await apiUpload(file, { purpose: "social_post", as: "brand" }).promise
        return { src: media.src, width: media.width ?? 1200, height: media.height ?? 1500, mediaId: media.id }
      },
    }),
    [],
  )
  if (!settingsReady || productsQuery.isLoading || shippingQuery.isLoading) return <ProductEditorSkeleton />
  if (productsQuery.error || shippingQuery.error) {
    const failure = productsQuery.error ?? shippingQuery.error
    return (
      <div className="mx-auto grid w-full max-w-xl gap-3 rounded-lg border border-line bg-surface p-5">
        <h1 className="text-lg text-ink">Quick add couldn&apos;t load</h1>
        <p className="text-sm text-ink-2">{failure instanceof ApiError ? failure.message : "Check your connection and try again."}</p>
        <div>
          <Button type="button" variant="secondary" size="sm" onClick={() => (void productsQuery.revalidate(), void shippingQuery.revalidate())}>
            Try again
          </Button>
        </div>
      </div>
    )
  }
  return <QuickAdd profile={brand} products={products} live={live} />
}

/* ---------- The flow ---------- */

type Result = { kind: "published" | "draft"; product: { id: string; name: string; slug: string; version?: number }; first: boolean }

function QuickAdd({ profile, products, live }: { profile: Brand; products: Product[]; live?: Live }) {
  const brand = useSettingsBrand(profile)
  const router = useRouter()
  const listing = useListingFacts()
  const hidden = brandHidden(listing)
  const [step, setStep] = useState(0)
  const [form, setForm] = useState<ProductForm>(() => ({ ...emptyForm(brand), category: "" }))
  const [attempted, setAttempted] = useState<Record<number, boolean>>({})
  const [resumed, setResumed] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState<null | "publish" | "draft">(null)
  const [result, setResult] = useState<Result | null>(null)
  const loaded = useRef(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const moved = useRef(false)

  const otherSkus = useMemo(() => new Set(products.flatMap((p) => p.variants.map((v) => v.sku.toUpperCase()))), [products])
  const first = !products.some((p) => p.status === "published" || p.status === "scheduled")

  // Pick up where this brand stopped on this device.
  useEffect(() => {
    const s = readSaved(brand.id)
    if (s && hasProgress(s.form)) {
      // Read after mount (storage isn't available on the server render).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm(s.form)
      setStep(Math.min(Math.max(0, s.step), STEPS.length - 1))
      setResumed(s.at)
    }
    loaded.current = true
  }, [brand.id])

  // Every change is kept on this device, so leaving and coming back resumes right here.
  useEffect(() => {
    if (!loaded.current || result) return
    if (!hasProgress(form)) return
    const t = window.setTimeout(() => setSaved(writeSaved(brand.id, step, form)), 400)
    return () => window.clearTimeout(t)
  }, [brand.id, step, form, result])

  // A new step: back to the top, and focus its heading so screen readers hear the question.
  useEffect(() => {
    if (!moved.current) return
    window.scrollTo({ top: 0, behavior: "auto" })
    heading.current?.focus({ preventScroll: true })
  }, [step, result])

  // `now` only matters for a scheduled go-live time, which Quick add never sets.
  const errors: Errors = useMemo(() => validate(form, { brand, otherSkus, original: [], now: 0 }), [form, brand, otherSkus])
  const current = STEPS[step].key
  const stepErrors = (i: number) => Object.keys(errors).filter((k) => errors[k] && STEPS[i].key !== "review" && owns[STEPS[i].key as Exclude<StepKey, "review">](k))
  const shown = (key: string) => (attempted[step] ? errors[key] : undefined)
  const uploading = form.images.some((im) => im.processing)

  const patch = (p: Partial<ProductForm>) => setForm((f) => ({ ...f, ...p }))
  /**
   * The variant rows for the chosen sizes (and the one optional colour). Naming or changing the
   * colour makes new rows (S becomes S / Washed black): they keep the count typed for that size.
   */
  const rebuild = (f: ProductForm) => {
    const prev = f.variants
    const next = withVariants(f, brand, slugify(f.name), new Map())
    const known = new Set(prev.map((v) => v.key))
    return { ...next, variants: next.variants.map((v) => (known.has(v.key) ? v : { ...v, stock: prev.find((p) => (p.options.Size ?? "") === (v.options.Size ?? ""))?.stock ?? v.stock })) }
  }

  function go(i: number) {
    moved.current = true
    setStep(i)
  }

  function next() {
    if (current === "photos" && uploading) {
      toast("Hang on, your photos are still uploading")
      return
    }
    if (stepErrors(step).length) {
      setAttempted((a) => ({ ...a, [step]: true }))
      const firstKey = stepErrors(step)[0]
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-field="${firstKey}"] input, [data-field="${firstKey}"] textarea, [data-field="${firstKey}"] button`)?.focus())
      return
    }
    go(Math.min(step + 1, STEPS.length - 1))
  }

  /** Auto SKUs follow the final name, and never collide with another of the brand's products. */
  function finalize(status: "published" | "draft"): ProductForm {
    const f = rebuild({ ...form, status })
    const taken = new Set(otherSkus)
    const variants = f.variants.map((v) => {
      let sku = v.skuAuto ? autoSku(brand, slugify(f.name), v.options) : v.sku
      for (let n = 2; taken.has(sku.toUpperCase()); n++) sku = `${sku.replace(/-\d+$/, "")}-${n}`.slice(0, 40)
      taken.add(sku.toUpperCase())
      return { ...v, sku }
    })
    return { ...f, variants }
  }

  async function submit(publish: boolean) {
    if (busy) return
    if (uploading) {
      toast("Hang on, your photos are still uploading")
      return
    }
    const f = finalize(publish ? "published" : "draft")
    const errs = validate(f, { brand, otherSkus, original: [], now: Date.now() })
    const bad = Object.keys(errs).find((k) => errs[k])
    if (bad) {
      const at = stepOf(bad)
      setAttempted((a) => ({ ...a, [at]: true }))
      go(at)
      toast("Almost: one thing needs a look", { description: errs[bad] })
      return
    }
    setBusy(publish ? "publish" : "draft")
    try {
      let out: Result["product"]
      let status = f.status
      if (live) {
        const body = liveProductBody(f, { brand, collections: [] })
        let dto: StudioProductDto = (await api<StudioProductResponse>("/api/studio/catalog/products", { body })).product
        if (publish && dto.status !== "published") {
          try {
            dto = await publishLiveProduct(dto.id, dto.version)
          } catch (cause) {
            toast.warning("Saved as a draft, but it didn't publish", { description: cause instanceof ApiError ? cause.message : "Publish it from the product page." })
          }
        }
        status = dto.status as ProductForm["status"]
        out = { id: dto.id, name: dto.title, slug: dto.slug, version: dto.version }
        revalidatePrefix("studio.catalog")
      } else {
        const now = Date.now()
        const { saved: product } = localProductFrom(f, { brand, profile, collections: [], now })
        useStudio.getState().upsertProduct(product)
        out = { id: product.id, name: product.name, slug: product.slug }
      }
      clearSaved(brand.id)
      revalidatePrefix("/api/studio/setup")
      moved.current = true
      setResult({ kind: status === "published" ? "published" : "draft", product: out, first })
    } catch (cause) {
      toast.error("That didn't save", { description: cause instanceof ApiError ? [cause.message, ...Object.values(cause.fields ?? {})].join(" ") : cause instanceof Error && !(cause instanceof TypeError) ? cause.message : "Check your connection and try again. Your progress is kept." })
    } finally {
      setBusy(null)
    }
  }

  function startOver() {
    clearSaved(brand.id)
    setForm({ ...emptyForm(brand), category: "" })
    setAttempted({})
    setResumed(null)
    setResult(null)
    setSaved(false)
    go(0)
  }

  if (result) {
    return (
      <Success
        result={result}
        hidden={hidden}
        viewable={!!live}
        headingRef={heading}
        onAnother={startOver}
        onPublished={(r) => setResult(r)}
        live={!!live}
        onOpen={(href) => router.push(href)}
      />
    )
  }

  const isReview = current === "review"

  return (
    <div className="mx-auto w-full max-w-xl pb-36">
      <div className="flex items-center justify-between gap-3">
        <Link href="/studio/products" className="inline-flex min-h-10 items-center gap-1 text-xs text-ink-2 hover:text-ink">
          <ChevronLeft className="size-3.5" aria-hidden /> Products
        </Link>
        <Link href={FULL_EDITOR_HREF} className="inline-flex min-h-10 items-center text-xs text-ink-2 underline-offset-4 hover:text-ink hover:underline">
          Use the full editor
        </Link>
      </div>

      <StepProgress steps={STEPS} step={step} saved={saved} onJump={(i) => (i < step ? go(i) : undefined)} />

      {resumed ? (
        <div className="rise-in mt-4 flex items-center gap-3 rounded-xl border border-line-soft bg-surface px-3.5 py-2.5 text-[13px] text-ink-2" role="status">
          <CheckCircle aria-hidden className="size-4 shrink-0 text-violet" />
          <p className="min-w-0 flex-1">Welcome back. We kept everything you&apos;d done.</p>
          <button type="button" onClick={startOver} className="inline-flex min-h-10 shrink-0 items-center rounded-md px-2 font-medium text-ink underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-violet">
            Start over
          </button>
        </div>
      ) : null}

      <form
        noValidate
        className="mt-6"
        onSubmit={(e) => {
          e.preventDefault()
          if (isReview) void submit(true)
          else next()
        }}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.section key={current} aria-labelledby="quick-step-title" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}>
            <StepHeading ref={heading} step={current} />
            <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6">
              {current === "photos" ? (
                <PhotosStep form={form} error={shown("photos")} onImages={(update) => setForm((f) => ({ ...f, images: update(f.images) }))} upload={live?.upload} />
              ) : current === "name" ? (
                <NameStep form={form} shown={shown} patch={patch} />
              ) : current === "price" ? (
                <PriceStep form={form} brand={brand} error={shown("price")} patch={patch} />
              ) : current === "sizes" ? (
                <SizesStep form={form} shown={shown} setForm={(fn) => setForm((f) => rebuild(fn(f)))} />
              ) : (
                <ReviewStep form={form} brand={brand} hidden={hidden} onEdit={go} />
              )}
            </div>
          </motion.section>
        </AnimatePresence>
        <StepBar
          isFirst={step === 0}
          isReview={isReview}
          busy={busy}
          blocked={uploading}
          onBack={() => go(Math.max(0, step - 1))}
          onDraft={() => void submit(false)}
          nextLabel={step === STEPS.length - 2 ? "Review" : "Next"}
        />
      </form>
    </div>
  )
}

/* ---------- Pieces ---------- */

/** "Step 2 of 5" and a bar of segments; done steps can be tapped to go back. Shared with Set up your shop. */
export function StepProgress({ steps, step, saved, onJump }: { steps: readonly { label: string }[]; step: number; saved: boolean; onJump: (i: number) => void }) {
  return (
    <div className="mt-2">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <p className="font-medium text-ink tabular">
          Step {step + 1} of {steps.length}
          <span className="font-normal text-ink-3">: {steps[step].label}</span>
        </p>
        <p className={cn("inline-flex items-center gap-1 text-ink-3 transition-opacity duration-300", saved ? "opacity-100" : "opacity-0")} aria-hidden={!saved}>
          <Check aria-hidden className="size-3" /> Progress saved
        </p>
      </div>
      <ol className="mt-2 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }} aria-label="Steps">
        {steps.map((s, i) => (
          <li key={s.label}>
            <button
              type="button"
              onClick={() => onJump(i)}
              disabled={i >= step}
              aria-label={`${s.label}${i < step ? ", done, go back to it" : i === step ? ", current step" : ""}`}
              aria-current={i === step ? "step" : undefined}
              className="group block w-full py-2 disabled:cursor-default"
            >
              <span className={cn("block h-1.5 rounded-full transition-colors duration-300", i < step ? "bg-violet group-hover:bg-ink" : i === step ? "bg-acid" : "bg-white/[0.08]")} />
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}

const headings: Record<StepKey, { title: string; body: string }> = {
  photos: { title: "Snap or upload photos", body: "At least one. The first is the cover shoppers see." },
  name: { title: "What's it called?", body: "Keep it short and real. Shoppers search by it." },
  price: { title: "How much?", body: "What shoppers pay, before shipping." },
  sizes: { title: "What sizes, and how many?", body: "Tap the sizes you have, then how many of each. No sizes? Pick One size." },
  review: { title: "Looks good?", body: "This is how shoppers will see it on Yard." },
}

function StepHeading({ step, ref }: { step: StepKey; ref: React.Ref<HTMLHeadingElement> }) {
  return <BigHeading ref={ref} title={headings[step].title} body={headings[step].body} />
}

/** One question per screen: the big friendly heading (focused on each step for screen readers). */
export function BigHeading({ title, body, ref }: { title: string; body: string; ref: React.Ref<HTMLHeadingElement> }) {
  return (
    <header>
      <h1 id="quick-step-title" ref={ref} tabIndex={-1} className="text-[1.75rem] leading-tight font-medium tracking-tight text-balance text-ink outline-none md:text-[2.25rem]">
        {title}
      </h1>
      <p className="mt-2 text-[15px] text-pretty text-ink-2">{body}</p>
    </header>
  )
}

/** Keeps the step bar above the phone keyboard (the visual viewport shrinks when it opens). */
export function useKeyboardInset() {
  const [inset, setInset] = useState(0)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const on = () => setInset(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)))
    vv.addEventListener("resize", on)
    vv.addEventListener("scroll", on)
    on()
    return () => {
      vv.removeEventListener("resize", on)
      vv.removeEventListener("scroll", on)
    }
  }, [])
  return inset
}

/** The sticky Back / Next bar (above the phone keyboard). On the last step: the quiet draft button (if any) and the big publish. */
export function StepBar({ isFirst, isReview, busy, blocked, onBack, onDraft, nextLabel, publishLabel = "Publish" }: { isFirst: boolean; isReview: boolean; busy: null | "publish" | "draft"; blocked: boolean; onBack: () => void; onDraft?: () => void; nextLabel: string; publishLabel?: string }) {
  const inset = useKeyboardInset()
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:left-[260px] sidebar-collapsed:left-[84px]" style={inset ? { bottom: inset } : undefined}>
      <div data-toast-avoid="" className="glass-strong glass-sheen pointer-events-auto mx-auto flex max-w-xl items-center gap-2 rounded-2xl p-2">
        <Button type="button" variant="secondary" className="h-12 rounded-xl px-4" onClick={onBack} disabled={isFirst || !!busy} aria-label="Back">
          <ArrowLeft aria-hidden /> <span className="max-sm:sr-only">Back</span>
        </Button>
        {isReview && onDraft ? (
          <Button type="button" variant="ghost" className="h-12 rounded-xl px-3 text-ink-2" onClick={onDraft} loading={busy === "draft"} disabled={!!busy || blocked}>
            Save as draft
          </Button>
        ) : null}
        <Button type="submit" variant="primary" className="h-12 flex-1 rounded-xl text-[15px]" loading={busy === "publish"} disabled={!!busy}>
          {isReview ? publishLabel : nextLabel}
          {isReview ? null : <ArrowRight aria-hidden />}
        </Button>
      </div>
    </div>
  )
}

/* ---------- Step 1: photos ---------- */

const photoTips = [
  { icon: Sun, text: "Daylight beats flash. Stand near a window." },
  { icon: Squares, text: "A plain wall or floor behind it." },
  { icon: Frame, text: "Front, back and one close-up. Portrait fills the card best." },
]

function PhotosStep({ form, error, onImages, upload }: { form: ProductForm; error?: string; onImages: (update: (prev: FormImage[]) => FormImage[]) => void; upload?: (file: File) => Promise<UploadedImage> }) {
  return (
    <>
      <div data-field="photos">
        <ImageManager quick images={form.images} onChange={onImages} error={error} productName={form.name} library={[]} upload={upload} />
      </div>
      <ul className="grid gap-2 rounded-xl border border-line-soft bg-surface/60 p-3.5" aria-label="Photo tips">
        {photoTips.map((t) => (
          <li key={t.text} className="flex items-start gap-2.5 text-[13px] text-ink-2">
            <t.icon aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-3" />
            {t.text}
          </li>
        ))}
      </ul>
    </>
  )
}

/* ---------- Step 2: name ---------- */

const bigInput = "h-14 rounded-xl px-4 text-lg md:text-lg"

function NameStep({ form, shown, patch }: { form: ProductForm; shown: (k: string) => string | undefined; patch: (p: Partial<ProductForm>) => void }) {
  const category = form.category ? categoryBySlug.get(form.category) : undefined
  const left = Math.max(0, 20 - form.description.trim().length)
  return (
    <>
      <div className="grid gap-1.5" data-field="name">
        <label htmlFor="qa-name" className="sr-only">
          Product name
        </label>
        <Input id="qa-name" autoFocus value={form.name} onChange={(e) => patch({ name: e.target.value })} maxLength={80} placeholder="e.g. Washed boxy tee" aria-invalid={shown("name") ? true : undefined} aria-describedby={shown("name") ? "qa-name-error" : undefined} className={bigInput} autoComplete="off" />
        <FieldMessage id="qa-name" error={shown("name")} />
      </div>

      <ChipGroup
        legend="What kind of piece?"
        name="qa-category"
        field="category"
        error={shown("category")}
        options={categories.map((c) => ({ value: c.slug, label: c.name }))}
        value={form.category}
        onChange={(v) => {
          const subs = categoryBySlug.get(v as CategorySlug)?.subcategories ?? []
          patch({ category: v as CategorySlug, subcategory: subs.includes(form.subcategory) ? form.subcategory : "" })
        }}
      />
      {category ? (
        <ChipGroup legend="More exactly?" name="qa-subcategory" field="subcategory" error={shown("subcategory")} options={category.subcategories.map((s) => ({ value: s, label: s }))} value={form.subcategory} onChange={(v) => patch({ subcategory: v })} />
      ) : null}

      <div className="grid gap-1.5" data-field="description">
        <label htmlFor="qa-description" className="text-[15px] font-medium text-ink">
          Describe it in a line or two
        </label>
        <Textarea
          id="qa-description"
          value={form.description}
          onChange={(e) => patch({ description: e.target.value })}
          rows={3}
          maxLength={2000}
          placeholder="e.g. Heavyweight cotton, boxy fit, screen-printed back. Runs true to size."
          aria-invalid={shown("description") ? true : undefined}
          aria-describedby={shown("description") ? "qa-description-error" : "qa-description-hint"}
          className="min-h-24 rounded-xl text-base md:text-[15px]"
        />
        <FieldMessage id="qa-description" error={shown("description")} hint={left ? `Fabric, fit, the vibe. ${plural(left, "more character")} to go.` : "Nice. That's plenty."} />
      </div>
    </>
  )
}

function ChipGroup({ legend, name, field, options, value, onChange, error }: { legend: string; name: string; field: string; options: { value: string; label: string }[]; value: string; onChange: (v: string) => void; error?: string }) {
  const id = useId()
  return (
    <fieldset className="grid gap-2" data-field={field} aria-describedby={error ? `${id}-error` : undefined}>
      <legend className="mb-2 text-[15px] font-medium text-ink">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label key={o.value} className={cn("relative inline-flex min-h-11 cursor-pointer items-center rounded-full border px-4 text-sm transition-colors has-focus-visible:ring-2 has-focus-visible:ring-violet", value === o.value ? "border-purple bg-purple/25 text-ink" : "border-line text-ink-2 hover:border-ink-2/50 hover:text-ink")}>
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="sr-only" />
            {value === o.value ? <Check aria-hidden weight="bold" className="mr-1.5 size-3.5" /> : null}
            {o.label}
          </label>
        ))}
      </div>
      {error ? (
        <p id={`${id}-error`} className="rise-in text-xs text-danger">
          {error}
        </p>
      ) : null}
    </fieldset>
  )
}

/* ---------- Step 3: price ---------- */

function PriceStep({ form, brand, error, patch }: { form: ProductForm; brand: Brand; error?: string; patch: (p: Partial<ProductForm>) => void }) {
  const currency = brand.currency
  const price = parseMoney(form.price, currency)
  return (
    <div className="grid gap-2" data-field="price">
      <label htmlFor="qa-price" className="sr-only">
        Price in {currency}
      </label>
      <InputGroup className="h-16 rounded-xl">
        <InputGroupAddon className="pl-4 text-2xl font-normal text-ink-3">{currencies[currency].symbol}</InputGroupAddon>
        <InputGroupInput id="qa-price" autoFocus inputMode="decimal" value={form.price} onChange={(e) => patch({ price: e.target.value })} placeholder="0" aria-invalid={error ? true : undefined} aria-describedby={error ? "qa-price-error" : "qa-price-hint"} className="text-3xl tabular md:text-3xl" autoComplete="off" />
        <InputGroupAddon align="inline-end" className="pr-4 font-normal text-ink-3">
          {currency}
        </InputGroupAddon>
      </InputGroup>
      <FieldMessage
        id="qa-price"
        error={error}
        hint={price ? `You receive ${formatMoney(Math.round(price * (1 - commissionRateAt())), currency)} per sale (Yard's commission: ${commissionLabel()}).` : `In ${currency}. Shoppers abroad see it in their own currency.`}
      />
    </div>
  )
}

/* ---------- Step 4: sizes and stock ---------- */

function SizesStep({ form, shown, setForm }: { form: ProductForm; shown: (k: string) => string | undefined; setForm: (fn: (f: ProductForm) => ProductForm) => void }) {
  const [custom, setCustom] = useState("")
  const choices = sizeChoices(form.category, form.subcategory)
  const extra = form.sizes.filter((s) => !choices.includes(s))
  const oneSize = !form.hasSizes
  const colour = form.hasColours ? form.colours[0] : undefined

  function toggle(size: string) {
    setForm((f) => {
      const has = f.sizes.includes(size)
      const sizes = has ? f.sizes.filter((s) => s !== size) : [...f.sizes, size]
      // Keep the tapped order sensible: the chips' order, then anything typed.
      const order = [...choices, ...sizes.filter((s) => !choices.includes(s))]
      const sorted = order.filter((s) => sizes.includes(s))
      return { ...f, hasSizes: sorted.length > 0, sizes: sorted }
    })
  }
  function addCustom() {
    const v = custom.trim().slice(0, 12)
    if (!v) return
    setForm((f) => (f.sizes.some((s) => s.toLowerCase() === v.toLowerCase()) ? f : { ...f, hasSizes: true, sizes: [...f.sizes, v] }))
    setCustom("")
  }
  function setStock(key: string, stock: string) {
    setForm((f) => ({ ...f, variants: f.variants.map((v) => (v.key === key ? { ...v, stock: stock.replace(/\D/g, "").slice(0, 5) } : v)) }))
  }

  return (
    <>
      <fieldset className="grid gap-2" data-field="sizes">
        <legend className="mb-2 text-[15px] font-medium text-ink">Sizes</legend>
        <div className="flex flex-wrap gap-2">
          <ToggleChip on={oneSize} onClick={() => setForm((f) => ({ ...f, hasSizes: false, sizes: [] }))}>
            One size
          </ToggleChip>
          {[...choices, ...extra].map((s) => (
            <ToggleChip key={s} on={form.sizes.includes(s)} onClick={() => toggle(s)}>
              {s}
            </ToggleChip>
          ))}
        </div>
        <div className="mt-1 flex gap-2">
          <label htmlFor="qa-size-custom" className="sr-only">
            Another size
          </label>
          <Input
            id="qa-size-custom"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                addCustom()
              }
            }}
            maxLength={12}
            placeholder="Another size, e.g. 28W"
            className="h-11 rounded-xl"
          />
          <Button type="button" variant="secondary" className="h-11 rounded-xl" onClick={addCustom} disabled={!custom.trim()}>
            Add
          </Button>
        </div>
        <FieldMessage id="qa-sizes" error={shown("sizes") ?? shown("variants")} />
      </fieldset>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-[15px] font-medium text-ink">How many do you have?</legend>
        <p className="-mt-1 mb-1 text-xs text-ink-3">Each size is a variant: shoppers pick one, and its count goes down when it sells.</p>
        <ul className="grid gap-2">
          {form.variants.map((v) => {
            const label = Object.values(v.options).join(" / ") || "One size"
            const err = shown(`stock-${v.key}`)
            const n = Number(v.stock) || 0
            return (
              <li key={v.key} data-field={`stock-${v.key}`} className="flex flex-wrap items-center gap-3 rounded-xl border border-line-soft bg-surface/60 p-2 pl-4">
                <label htmlFor={`qa-stock-${v.key}`} className="min-w-0 flex-1 truncate text-[15px] text-ink">
                  {label}
                </label>
                <div className="flex items-center gap-1">
                  <Button type="button" variant="secondary" size="icon" className="size-11 rounded-xl" aria-label={`One fewer ${label}`} onClick={() => setStock(v.key, String(Math.max(0, n - 1)))} disabled={n <= 0}>
                    <Minus aria-hidden />
                  </Button>
                  <Input id={`qa-stock-${v.key}`} inputMode="numeric" value={v.stock} onChange={(e) => setStock(v.key, e.target.value)} onFocus={(e) => e.currentTarget.select()} aria-invalid={err ? true : undefined} aria-describedby={err ? `qa-stock-${v.key}-error` : undefined} className="h-11 w-16 rounded-xl text-center text-lg tabular" />
                  <Button type="button" variant="secondary" size="icon" className="size-11 rounded-xl" aria-label={`One more ${label}`} onClick={() => setStock(v.key, String(Math.min(99_999, n + 1)))}>
                    <Plus aria-hidden />
                  </Button>
                </div>
                {err ? <FieldMessage id={`qa-stock-${v.key}`} error={err} /> : null}
              </li>
            )
          })}
        </ul>
        {form.variants.length && form.variants.every((v) => Number(v.stock) === 0) ? <p className="text-xs text-ink-3">At 0 it shows as sold out. That&apos;s fine for a pre-order tease, but most brands add stock now.</p> : null}
      </fieldset>

      <fieldset className="grid gap-2" data-field="colours">
        <legend className="mb-1 text-[15px] font-medium text-ink">
          Colour <span className="font-normal text-ink-3">(optional)</span>
        </legend>
        <div className="flex gap-2">
          <label className="relative inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-line" title="Pick a colour">
            <span className="size-6 rounded-full border border-white/20" style={{ background: colour?.hex ?? "#111111" }} aria-hidden />
            <input
              type="color"
              value={colour?.hex ?? "#111111"}
              onChange={(e) => setForm((f) => ({ ...f, hasColours: true, colours: [{ key: f.colours[0]?.key ?? "qa-colour", name: f.colours[0]?.name ?? "", hex: e.target.value }] }))}
              className="absolute inset-0 cursor-pointer opacity-0"
              aria-label="Colour swatch"
            />
          </label>
          <label htmlFor="qa-colour" className="sr-only">
            Colour name
          </label>
          <Input
            id="qa-colour"
            value={colour?.name ?? ""}
            onChange={(e) => {
              const name = e.target.value.slice(0, 24)
              setForm((f) => (name.trim() ? { ...f, hasColours: true, colours: [{ key: f.colours[0]?.key ?? "qa-colour", name, hex: f.colours[0]?.hex ?? "#111111" }] } : { ...f, hasColours: false, colours: [] }))
            }}
            placeholder="e.g. Washed black"
            className="h-11 rounded-xl"
          />
        </div>
        <p className="text-xs text-ink-3">Comes in several colours? Add each one as its own product, or use the full editor after publishing.</p>
      </fieldset>
    </>
  )
}

function ToggleChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={cn("inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border px-4 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-violet focus-visible:outline-none", on ? "border-purple bg-purple/25 text-ink" : "border-line text-ink-2 hover:border-ink-2/50 hover:text-ink")}>
      {on ? <Check aria-hidden weight="bold" className="mr-1.5 size-3.5" /> : null}
      {children}
    </button>
  )
}

/* ---------- Step 5: review ---------- */

function ReviewStep({ form, brand, hidden, onEdit }: { form: ProductForm; brand: Brand; hidden: boolean; onEdit: (step: number) => void }) {
  const price = parseMoney(form.price, brand.currency)
  const preview: Product | null = useMemo(() => {
    if (!form.images.length || !price) return null
    return {
      id: "p_preview",
      slug: "preview",
      brandId: brand.id,
      brandSummary: { id: brand.id, handle: brand.handle, name: brand.name, verified: false, city: brand.city, country: brand.country },
      name: form.name.trim() || "Your product",
      description: form.description,
      details: [],
      category: (form.category || "streetwear") as CategorySlug,
      subcategory: form.subcategory,
      tags: [],
      price,
      currency: brand.currency,
      images: form.images.map((im, i) => ({ src: im.src, alt: i === 0 ? `${form.name} by ${brand.name}` : "", width: im.width, height: im.height })),
      options: [],
      variants: form.variants.map((v, i) => ({ id: `pv_${i}`, sku: v.sku, options: v.options, stock: Number(v.stock) || 0, reserved: 0 })),
      badges: ["new"],
      status: "published",
      createdAt: new Date(0).toISOString(),
      collectionIds: [],
      stats: { views7d: 0, wishlists: 0, sales30d: 0, trend: 0 },
    } as Product
  }, [form, brand, price])
  const stock = form.variants.map((v) => `${Object.values(v.options).join(" / ") || "One size"}: ${Number(v.stock) || 0}`).join(", ")
  const cat = form.category ? categoryBySlug.get(form.category)?.name : null
  const rows: { label: string; value: string; step: number }[] = [
    { label: "Photos", value: plural(form.images.length, "photo"), step: 0 },
    { label: "Name", value: form.name.trim() || "Not yet", step: 1 },
    { label: "Category", value: cat ? `${cat}${form.subcategory ? `, ${form.subcategory}` : ""}` : "Not yet", step: 1 },
    { label: "Price", value: price ? formatMoney(price, brand.currency) : "Not yet", step: 2 },
    { label: "Sizes & stock", value: stock, step: 3 },
  ]
  return (
    <>
      {preview ? (
        <div className="mx-auto w-[min(100%,17rem)]">
          <p className="sr-only">Preview of the product card shoppers see.</p>
          <div inert aria-hidden className="select-none">
            <ProductCard product={preview} sizes="272px" addBlocked={false} />
          </div>
        </div>
      ) : null}
      <dl className="divide-y divide-line-soft rounded-xl border border-line-soft bg-surface/60">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-3 px-4 py-2.5">
            <dt className="w-28 shrink-0 text-xs text-ink-3">{r.label}</dt>
            <dd className="min-w-0 flex-1 text-sm text-ink [overflow-wrap:anywhere]">{r.value}</dd>
            <dd>
              <button type="button" onClick={() => onEdit(r.step)} className="inline-flex min-h-10 items-center rounded-md px-2 text-xs font-medium text-ink-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-violet" aria-label={`Edit ${r.label.toLowerCase()}`}>
                Edit
              </button>
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-[13px] text-pretty text-ink-2">
        <span className="text-ink">Publish</span> puts it on Yard right away. <span className="text-ink">Save as draft</span> keeps it hidden: only you can see drafts.
        {hidden ? " Your storefront isn't published yet, so it shows up once that's live too." : ""}
      </p>
    </>
  )
}

/* ---------- Done ---------- */

function Success({
  result,
  hidden,
  viewable,
  live,
  headingRef,
  onAnother,
  onPublished,
  onOpen,
}: {
  result: Result
  hidden: boolean
  viewable: boolean
  live: boolean
  headingRef: React.Ref<HTMLHeadingElement>
  onAnother: () => void
  onPublished: (r: Result) => void
  onOpen: (href: string) => void
}) {
  const p = result.product
  const published = result.kind === "published"
  const url = typeof window === "undefined" ? `/products/${p.slug}` : `${window.location.origin}/products/${encodeURIComponent(p.slug)}`
  const [publishing, setPublishing] = useState(false)
  const announced = useRef(false)
  useEffect(() => {
    if (announced.current || !published) return
    announced.current = true
    // The success screen says it all; the toast only carries the hidden-storefront nudge.
    if (hidden) announcePublished(p, { first: result.first, hidden, viewable, onOpen })
  }, [published, hidden, p, result.first, viewable, onOpen])

  async function share() {
    try {
      if (navigator.share) {
        await navigator.share({ title: p.name, url })
        return
      }
      await navigator.clipboard.writeText(url)
      toast.success("Link copied", { description: "Paste it anywhere: your bio, your story, the group chat." })
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return
      toast.error("Couldn't share the link", { description: url })
    }
  }

  const title = published ? (hidden ? "Published! One last step 🎉" : "It's live on Yard 🎉") : "Saved as a draft"
  const body = published
    ? hidden
      ? `${p.name} is ready. Your storefront isn't published yet, so shoppers can't see it. Publish the storefront and everything goes live.`
      : `${p.name} is out in the world. Shoppers can find it, save it and buy it.`
    : `Only you can see ${p.name}. Publish it whenever you're ready and it goes live on Yard.`

  return (
    <div className="relative mx-auto w-full max-w-xl pt-6 pb-16 text-center">
      {published && !hidden ? <Confetti /> : null}
      <span className={cn("step-pop mx-auto inline-flex size-16 items-center justify-center rounded-full", published ? "bg-acid text-obsidian" : "border border-dashed border-ink/50 text-ink")} aria-hidden>
        {published ? <Check weight="bold" className="size-7" /> : <Storefront className="size-7" />}
      </span>
      <h1 ref={headingRef} tabIndex={-1} className="mt-6 text-[2rem] leading-tight font-medium tracking-tight text-balance text-ink outline-none md:text-[2.5rem]">
        {title}
      </h1>
      <p className="mx-auto mt-3 max-w-md text-[15px] text-pretty text-ink-2">{body}</p>

      <div className="mx-auto mt-8 grid max-w-sm gap-2">
        {published ? (
          hidden ? (
            <Button asChild variant="primary" className="h-12 rounded-xl text-[15px]">
              <Link href="/studio/storefront">
                <Storefront aria-hidden /> Publish my storefront
              </Link>
            </Button>
          ) : viewable ? (
            <>
              <Button asChild variant="primary" className="h-12 rounded-xl text-[15px]">
                <a href={`/products/${encodeURIComponent(p.slug)}`} target="_blank" rel="noopener">
                  View it on Yard <External aria-hidden className="size-4" />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              </Button>
              <Button type="button" variant="secondary" className="h-12 rounded-xl" onClick={() => void share()}>
                {typeof navigator !== "undefined" && "share" in navigator ? <Share aria-hidden /> : <LinkIcon aria-hidden />} Share link
              </Button>
            </>
          ) : (
            <Button asChild variant="primary" className="h-12 rounded-xl text-[15px]">
              <Link href="/studio/products">See it in Products</Link>
            </Button>
          )
        ) : (
          <Button
            type="button"
            variant="primary"
            className="h-12 rounded-xl text-[15px]"
            loading={publishing}
            onClick={async () => {
              setPublishing(true)
              const ok = await publishSavedProduct(p, { live, first: result.first, hidden, onOpen })
              setPublishing(false)
              if (ok) onPublished({ ...result, kind: "published" })
            }}
          >
            Publish now
          </Button>
        )}
        <Button type="button" variant="secondary" className="h-12 rounded-xl" onClick={onAnother}>
          <Plus aria-hidden /> Add another
        </Button>
        <Link href={`/studio/products/${encodeURIComponent(p.id)}`} className="mt-1 inline-flex min-h-10 items-center justify-center text-[13px] text-ink-2 underline-offset-4 hover:text-ink hover:underline">
          More options: collections, tags, compare-at price
        </Link>
      </div>
    </div>
  )
}

/** A light burst of acid and violet bits. Decorative; hidden entirely with reduced motion. */
export function Confetti() {
  const bits = useMemo(
    () =>
      Array.from({ length: 22 }, (_, i) => ({
        left: 8 + ((i * 37) % 84),
        delay: (i % 7) * 60,
        drift: ((i * 53) % 60) - 30,
        spin: ((i * 97) % 300) - 150,
        colour: ["var(--color-acid)", "var(--color-violet)", "var(--color-purple)", "var(--color-ink)"][i % 4],
        w: 6 + (i % 3) * 2,
      })),
    [],
  )
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-4 h-72 overflow-hidden motion-reduce:hidden">
      {bits.map((b, i) => (
        <span
          key={i}
          className="quick-confetti absolute top-0 block h-2.5 rounded-[2px]"
          style={{ left: `${b.left}%`, width: b.w, background: b.colour, animationDelay: `${b.delay}ms`, ["--drift" as string]: `${b.drift}px`, ["--spin" as string]: `${b.spin}deg` }}
        />
      ))}
    </div>
  )
}
