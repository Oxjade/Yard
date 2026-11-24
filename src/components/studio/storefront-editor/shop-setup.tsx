"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { AnimatePresence, motion } from "motion/react"
import {
  ArrowSquareOutIcon as External,
  CameraIcon as Camera,
  CaretLeftIcon as ChevronLeft,
  CheckIcon as Check,
  CropIcon as Crop,
  LightningIcon as Lightning,
  LinkSimpleIcon as LinkIcon,
  MapPinIcon as MapPin,
  ShareNetworkIcon as Share,
  SquaresFourIcon as Squares,
  StorefrontIcon as Storefront,
  UploadSimpleIcon as Upload,
} from "@phosphor-icons/react"
import { toast } from "sonner"
import { BrandMark } from "@/components/market/brand-mark"
import { FieldMessage } from "@/components/studio/catalog/fields"
import { useCatalogReady } from "@/components/studio/catalog/store"
import { BigHeading, Confetti, StepBar, StepProgress } from "@/components/studio/catalog/quick-add"
import { useListingFacts } from "@/components/studio/setup/use-listing"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { countries } from "@/config/markets"
import { ApiError } from "@/lib/api/client"
import type { BrandProfile } from "@/lib/api/contracts/session"
import { revalidatePrefix, useApi } from "@/lib/api/use-api"
import {
  editorConfigFromDto,
  editorConfigToDto,
  getStudioStorefront,
  loadStorefrontEditorContext,
  publishStudioStorefront,
  saveStudioStorefrontDraft,
  setStudioBrandLogo,
  storefrontBrandFromApi,
  type StorefrontEditorContext,
} from "@/lib/api/storefront"
import { QUICK_ADD_HREF } from "@/lib/listing-guide"
import { brandById } from "@/lib/data/brands"
import type { Brand, Collection, Drop, ImageAsset, Product } from "@/lib/data/types"
import { refreshServerSession, useServerSession } from "@/lib/session/use-server-session"
import { useStudio } from "@/lib/stores/studio"
import { cn } from "@/lib/utils"
import { useUpload } from "./content-controls"
import { ACCEPTED_TYPES } from "./image-tools"
import { brandForPreview, fingerprint, INTRO_MAX, normalize, type EditorConfig } from "./model"
import { DeviceToggle } from "./parts"
import { PreviewFrame, type Device } from "./preview-frame"

/* ---------- Steps ---------- */

const STEPS = [
  { key: "logo", label: "Logo", title: "Add your logo", body: "It sits in a circle at the top of your shop and next to everything you sell." },
  { key: "banner", label: "Banner", title: "Add a banner", body: "One wide photo across the top of your shop. Make it feel like you." },
  { key: "about", label: "About", title: "Tell people who you are", body: "A line under your name. What you sell, and the vibe." },
  { key: "review", label: "Review", title: "Looks fire?", body: "This is your shop's header, exactly as shoppers will see it." },
] as const
type StepKey = (typeof STEPS)[number]["key"]
const stepKey = (brandId: string) => `yard-shop-setup:${brandId}`

/**
 * Set up your shop (/studio/storefront/quick): logo, banner and a line about the brand, one
 * question per screen, then a big Publish my shop. Same APIs and media pipeline as the
 * storefront editor: uploads go through POST /api/uploads (storefront_cover) via the editor's
 * own useUpload, the banner and line autosave to the storefront draft (PUT
 * /api/studio/storefront/draft), the logo is the brand's own (PUT /api/studio/storefront/logo),
 * and publishing is POST /api/studio/storefront/publish (a founding brand launches).
 */
export function ShopSetupRoute() {
  const session = useServerSession()
  if (session.status !== "ready") return <Loading />
  const demo = !session.brand || (session.brand.demo && brandById.has(session.brand.brand.id))
  if (!demo && session.brand) return <ServerShopSetup profile={session.brand} />
  return <DemoShopSetup />
}

function Loading() {
  return (
    <div role="status" aria-label="Loading" className="mx-auto grid w-full max-w-xl gap-4">
      <span className="skeleton h-4 w-40 rounded" />
      <span className="skeleton h-2 w-full rounded-full" />
      <span className="skeleton mt-4 h-9 w-3/4 rounded" />
      <span className="skeleton h-56 w-full rounded-2xl" />
    </div>
  )
}

/* ---------- The two backends ---------- */

type Backend = {
  live: boolean
  brand: Brand
  initial: EditorConfig
  products: Product[]
  collections: Collection[]
  drops: Drop[]
  /** Saves the draft; resolves false on failure (the caller keeps the edit). */
  save: (config: EditorConfig) => Promise<boolean>
  publish: (config: EditorConfig) => Promise<void>
  /** Sets the brand's logo from an upload (live: applies at once). */
  setLogo: (image: ImageAsset | null) => Promise<string | null>
  logoSrc: string | null
}

function ServerShopSetup({ profile }: { profile: BrandProfile }) {
  const context = useApi(`studio:storefront-editor:${profile.brand.id}`, () => loadStorefrontEditorContext(profile.brand.handle, profile.brand.id), { revalidateOnFocus: false })
  if (context.error) {
    return (
      <div className="mx-auto grid w-full max-w-xl gap-3 rounded-lg border border-line bg-surface p-5" role="alert">
        <p className="text-sm text-ink">{context.error instanceof ApiError ? context.error.message : "Your shop couldn't be loaded. Check your connection and try again."}</p>
        <Button type="button" variant="secondary" size="sm" className="w-fit" onClick={() => void context.revalidate()}>
          Try again
        </Button>
      </div>
    )
  }
  if (!context.data) return <Loading />
  return <ServerBackend key={profile.brand.id} context={context.data} canEdit={profile.permissions.includes("content.publish")} />
}

function ServerBackend({ context, canEdit }: { context: StorefrontEditorContext; canEdit: boolean }) {
  const brand = useMemo(() => storefrontBrandFromApi(context.published.brand, null, context.products, "brand"), [context])
  const revision = useRef(context.studio.draft.revision)
  const liveVersion = useRef(context.studio.live?.version ?? 0)
  const inFlight = useRef<Promise<boolean> | null>(null)
  const initial = useMemo(() => normalize(editorConfigFromDto(context.studio.draft.config, brand), brand), [context, brand])

  const save = useCallback(
    async (config: EditorConfig): Promise<boolean> => {
      while (inFlight.current) await inFlight.current
      const run = (async () => {
        try {
          const result = await saveStudioStorefrontDraft(editorConfigToDto(normalize(config, brand), brand), revision.current)
          revision.current = result.draft.revision
          return true
        } catch (error) {
          if (error instanceof ApiError && error.status === 409) {
            // Someone saved in the editor meanwhile: take their revision and save ours on top (only banner and line change here).
            try {
              const fresh = await getStudioStorefront()
              revision.current = fresh.draft.revision
              liveVersion.current = fresh.live?.version ?? 0
              const merged = { ...normalize(editorConfigFromDto(fresh.draft.config, brand), brand), cover: config.cover, intro: config.intro }
              const result = await saveStudioStorefrontDraft(editorConfigToDto(normalize(merged, brand), brand), revision.current)
              revision.current = result.draft.revision
              return true
            } catch {
              // Falls through to the toast.
            }
          }
          toast.error("Your progress couldn't be saved", { id: "shop-save", description: error instanceof ApiError ? error.message : "Check your connection. We'll try again on your next change." })
          return false
        } finally {
          inFlight.current = null
        }
      })()
      inFlight.current = run
      return run
    },
    [brand],
  )

  const backend: Backend = {
    live: true,
    brand,
    initial,
    products: context.products,
    collections: context.collections,
    drops: context.drops,
    save,
    publish: async (config) => {
      if (!(await save(config))) throw new Error("Your progress couldn't be saved, so nothing was published. Try again.")
      const result = await publishStudioStorefront(revision.current, liveVersion.current)
      liveVersion.current = result.version
      revalidatePrefix("studio:storefront-editor")
      revalidatePrefix("/api/studio/setup")
    },
    setLogo: async (image) => {
      const result = await setStudioBrandLogo(image?.mediaId ?? null)
      void refreshServerSession()
      revalidatePrefix("/api/studio/setup")
      return result.logoSrc
    },
    logoSrc: brand.logoSrc ?? null,
  }
  if (!canEdit) return <p className="mx-auto max-w-xl text-sm text-ink-2">Your role can view this shop but can&apos;t change or publish it. Ask the owner or an admin.</p>
  return <ShopSetup backend={backend} />
}

function DemoShopSetup() {
  const ready = useCatalogReady()
  const brandId = useStudio((s) => s.brandId)
  const storefront = useStudio((s) => s.storefront)
  const products = useStudio((s) => s.products)
  const drops = useStudio((s) => s.drops)
  const saveDraft = useStudio((s) => s.saveStorefrontDraft)
  const publish = useStudio((s) => s.publishStorefront)
  const brand = brandById.get(brandId)!
  if (!ready) return <Loading />
  const initial = normalize(storefront.draft as EditorConfig, brand)
  const backend: Backend = {
    live: false,
    brand,
    initial,
    products: products.filter((p) => p.status === "published"),
    collections: [],
    drops,
    save: async (config) => {
      try {
        saveDraft(normalize(config, brand))
        return true
      } catch {
        toast.error("Your progress couldn't be saved", { id: "shop-save", description: "This browser's storage is full. Try a smaller image." })
        return false
      }
    },
    publish: async (config) => {
      saveDraft(normalize(config, brand))
      publish()
    },
    // The sample store keeps an image logo in the draft, as the editor does.
    setLogo: async (image) => image?.src ?? null,
    logoSrc: initial.logo?.kind === "image" ? initial.logo.image.src : null,
  }
  return <ShopSetup backend={backend} />
}

/* ---------- The flow ---------- */

function ShopSetup({ backend }: { backend: Backend }) {
  const { brand } = backend
  const listing = useListingFacts()
  const [step, setStep] = useState(0)
  const [config, setConfig] = useState<EditorConfig>(backend.initial)
  const [logo, setLogo] = useState<string | null>(backend.logoSrc)
  const [logoBusy, setLogoBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const moved = useRef(false)
  const latest = useRef(config)
  const savedFp = useRef(fingerprint(normalize(backend.initial, brand)))
  const timer = useRef<number | null>(null)

  // Resume at the step this brand reached (this device), or jump to Review from the Overview.
  useEffect(() => {
    let at = 0
    try {
      at = Number(window.localStorage.getItem(stepKey(brand.id)) ?? 0) || 0
    } catch {
      // Storage refused: start at the top.
    }
    if (new URLSearchParams(window.location.search).get("step") === "review") at = STEPS.length - 1
    // Read after mount (storage and the URL aren't available on the server render).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStep(Math.min(Math.max(0, at), STEPS.length - 1))
  }, [brand.id])

  useEffect(() => {
    try {
      window.localStorage.setItem(stepKey(brand.id), String(step))
    } catch {
      // Not kept: it starts at the top next time.
    }
  }, [brand.id, step])

  useEffect(() => {
    if (!moved.current) return
    window.scrollTo({ top: 0, behavior: "auto" })
    heading.current?.focus({ preventScroll: true })
  }, [step, done])

  /** Every change autosaves to the storefront draft a moment later (never an upload still in flight). */
  const flush = useCallback(async () => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = null
    const snap = latest.current
    if (snap.cover?.src.startsWith("blob:")) return true
    const fp = fingerprint(normalize(snap, brand))
    if (fp === savedFp.current) return true
    const ok = await backend.save(snap)
    if (ok) {
      savedFp.current = fp
      setSaved(true)
    }
    return ok
  }, [backend, brand])

  function update(patch: Partial<EditorConfig>) {
    const next = normalize({ ...latest.current, ...patch }, brand)
    latest.current = next
    setConfig(next)
    setSaved(false)
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void flush(), 900)
  }

  // Leaving mid-edit: save what's there.
  useEffect(() => () => void flush(), [flush])

  const cover = useUpload(
    "cover",
    (image, replacing) => {
      if (!image.src) {
        if (latest.current.cover?.src === replacing) update({ cover: undefined })
        return
      }
      if (replacing && latest.current.cover?.src !== replacing) return
      update({ cover: { ...image, alt: `${brand.name} banner` } })
    },
    backend.live,
  )

  const logoUpload = useUpload(
    "logo",
    (image, replacing) => {
      if (!replacing) {
        setLogo(image.src)
        setLogoBusy(true)
        return
      }
      if (!image.src) {
        setLogo(backend.logoSrc)
        setLogoBusy(false)
        return
      }
      setLogo(image.src)
      backend
        .setLogo(image)
        .then((src) => {
          setLogo(src)
          if (!backend.live) update({ logo: { kind: "image", image: { ...image, alt: `${brand.name} logo` } } })
          setSaved(true)
        })
        .catch((e: unknown) => {
          setLogo(backend.logoSrc)
          toast.error("Your logo couldn't be saved", { description: e instanceof ApiError ? e.message : "Check your connection and try again." })
        })
        .finally(() => setLogoBusy(false))
    },
    backend.live,
  )

  function go(i: number) {
    moved.current = true
    void flush()
    setStep(i)
  }

  async function publish() {
    if (busy) return
    if (cover.busy || logoBusy) {
      toast("Hang on, your photo is still uploading")
      return
    }
    setBusy(true)
    try {
      if (timer.current) window.clearTimeout(timer.current)
      await backend.publish(latest.current)
      try {
        window.localStorage.removeItem(stepKey(brand.id))
      } catch {
        // Nothing to clear.
      }
      moved.current = true
      setDone(true)
    } catch (e) {
      toast.error("Your shop couldn't be published", { description: e instanceof Error && !(e instanceof TypeError) ? e.message : "Check your connection and try again." })
    } finally {
      setBusy(false)
    }
  }

  const previewBrand = useMemo(() => ({ ...brandForPreview(brand, config), logoSrc: logo }), [brand, config, logo])

  if (done) return <ShopLive brand={brand} live={backend.live} headingRef={heading} noProducts={!!listing && listing.live === 0} />

  const current: StepKey = STEPS[step].key
  const isReview = current === "review"
  const hasCover = !!config.cover
  const nextLabel = current === "logo" && !logo ? "Skip for now" : current === "banner" && !hasCover ? "Skip for now" : step === STEPS.length - 2 ? "Review" : "Next"

  return (
    <div className="mx-auto w-full max-w-xl pb-36">
      <div className="flex items-center justify-between gap-3">
        <Link href="/studio/storefront" className="inline-flex min-h-10 items-center gap-1 text-xs text-ink-2 hover:text-ink">
          <ChevronLeft className="size-3.5" aria-hidden /> Storefront
        </Link>
        <Link href="/studio/storefront" className="inline-flex min-h-10 items-center text-xs text-ink-2 underline-offset-4 hover:text-ink hover:underline">
          Use the full editor
        </Link>
      </div>
      <StepProgress steps={STEPS} step={step} saved={saved} onJump={(i) => (i < step ? go(i) : undefined)} />

      <form
        noValidate
        className="mt-6"
        onSubmit={(e) => {
          e.preventDefault()
          if (isReview) void publish()
          else go(step + 1)
        }}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.section key={current} aria-labelledby="quick-step-title" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}>
            <BigHeading ref={heading} title={STEPS[step].title} body={STEPS[step].body} />
            <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6">
              {current === "logo" ? (
                <LogoStep brand={brand} logo={logo} busy={logoBusy || logoUpload.busy} onFile={(f) => void logoUpload.run(f)} />
              ) : current === "banner" ? (
                <BannerStep backend={backend} brand={previewBrand} config={config} busy={cover.busy} onFile={(f) => void cover.run(f)} />
              ) : current === "about" ? (
                <AboutStep brand={brand} intro={config.intro ?? ""} onIntro={(intro) => update({ intro })} />
              ) : (
                <ReviewStep backend={backend} brand={previewBrand} config={config} hidden={!!listing && listing.founding && !listing.launched} />
              )}
            </div>
          </motion.section>
        </AnimatePresence>
        <StepBar isFirst={step === 0} isReview={isReview} busy={busy ? "publish" : null} blocked={cover.busy || logoBusy} onBack={() => go(Math.max(0, step - 1))} nextLabel={nextLabel} publishLabel="Publish my shop" />
      </form>
    </div>
  )
}

/* ---------- Pieces ---------- */

/** Upload (library on desktop, the picker on phones) plus, on touch screens, straight to the camera. */
function UploadButtons({ label, busy, onFile, capture = "environment" }: { label: string; busy: boolean; onFile: (file: File) => void; capture?: "user" | "environment" }) {
  const file = useRef<HTMLInputElement>(null)
  const camera = useRef<HTMLInputElement>(null)
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ""
    if (f) onFile(f)
  }
  return (
    <div className="grid gap-2 sm:grid-cols-2 pointer-fine:sm:grid-cols-1">
      <Button type="button" variant="secondary" className="h-12 rounded-xl" loading={busy} onClick={() => file.current?.click()}>
        <Upload aria-hidden /> {label}
      </Button>
      <Button type="button" variant="secondary" className="h-12 rounded-xl pointer-fine:hidden" disabled={busy} onClick={() => camera.current?.click()}>
        <Camera aria-hidden /> Take a photo
      </Button>
      <input ref={file} type="file" accept={ACCEPTED_TYPES} className="sr-only" tabIndex={-1} aria-hidden onChange={pick} />
      <input ref={camera} type="file" accept="image/*" capture={capture} className="sr-only" tabIndex={-1} aria-hidden onChange={pick} />
    </div>
  )
}

function Tip({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2.5 rounded-xl border border-line-soft bg-surface/60 p-3.5 text-[13px] text-pretty text-ink-2">
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-3" />
      <span>{children}</span>
    </p>
  )
}

function LogoStep({ brand, logo, busy, onFile }: { brand: Brand; logo: string | null; busy: boolean; onFile: (file: File) => void }) {
  return (
    <>
      <div className="flex items-end justify-center gap-6 rounded-2xl border border-line-soft bg-card p-6" aria-label={logo ? "Your logo, cropped square and round" : "No logo yet: your initials show"}>
        <figure className="grid justify-items-center gap-2">
          <span className="relative block size-32 overflow-hidden rounded-2xl border border-line bg-obsidian sm:size-40">
            {logo ? <Image src={logo} alt="" fill sizes="160px" unoptimized className="object-cover" /> : <BrandMark brand={{ mark: brand.mark, name: brand.name }} size="xl" className="size-full" />}
            {busy ? <span className="absolute inset-0 animate-pulse bg-obsidian/40" aria-hidden /> : null}
          </span>
          <figcaption className="text-[11px] text-ink-3">Square crop</figcaption>
        </figure>
        <figure className="grid justify-items-center gap-2">
          <span className="relative block size-20 overflow-hidden rounded-full bg-card ring-4 ring-obsidian">
            {logo ? <Image src={logo} alt="" fill sizes="80px" unoptimized className="object-cover" /> : <BrandMark brand={{ mark: brand.mark, name: brand.name }} size="lg" className="size-full rounded-full" />}
          </span>
          <figcaption className="text-[11px] text-ink-3">On your shop</figcaption>
        </figure>
      </div>
      <UploadButtons label={logo ? "Change logo" : "Upload logo"} busy={busy} onFile={onFile} />
      <Tip icon={Crop}>
        Square works best, at least <span className="text-ink">400 × 400 px</span>. Keep the logo centred with a little space around it, on a solid background: we crop it to a circle. {logo ? "It saves straight away." : `No logo yet? Skip it and your initials (${brand.mark.text}) show instead.`}
      </Tip>
    </>
  )
}

/**
 * The top of the real storefront renderer (the hero only), drawn at its true width and scaled
 * to fit: 1280px for desktop, 390px for a phone. Inert: it's a picture of the shop.
 */
function HeroPreview({ backend, brand, config, device, height }: { backend: Backend; brand: Brand; config: EditorConfig; device: Device; height: number }) {
  const box = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    setW(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  const width = device === "desktop" ? 1280 : 390
  const scale = w ? Math.min(1, w / width) : 0
  const heroOnly = useMemo(() => ({ ...config, announcement: null, sections: config.sections.map((s) => ({ ...s, enabled: s.type === "hero" })) }), [config])
  return (
    <div ref={box} className="relative w-full overflow-hidden rounded-xl border border-line-soft bg-obsidian" style={{ height: scale ? height * scale : height * 0.4 }}>
      {scale ? (
        <div inert aria-hidden className="absolute top-0 left-0 origin-top-left" style={{ width, transform: `scale(${scale})` }}>
          <PreviewFrame device={device} contained={false} brand={brand} config={heroOnly} products={backend.products} collections={backend.collections} drops={backend.drops} stories={[]} />
        </div>
      ) : null}
    </div>
  )
}

function BannerStep({ backend, brand, config, busy, onFile }: { backend: Backend; brand: Brand; config: EditorConfig; busy: boolean; onFile: (file: File) => void }) {
  return (
    <>
      <div className="grid gap-3">
        <p className="text-xs font-medium text-ink-2">On a computer</p>
        <HeroPreview backend={backend} brand={brand} config={config} device="desktop" height={720} />
        <div className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] items-start gap-4">
          <div className="grid gap-2">
            <p className="text-xs font-medium text-ink-2">On a phone</p>
            <HeroPreview backend={backend} brand={brand} config={config} device="mobile" height={640} />
          </div>
          <div className="grid gap-3 pt-6">
            <UploadButtons label={config.cover ? "Change banner" : "Upload banner"} busy={busy} onFile={onFile} />
          </div>
        </div>
      </div>
      <Tip icon={Squares}>
        Landscape, at least <span className="text-ink">1600 × 700 px</span>. Keep faces and words in the middle: phones crop the sides, and your logo sits over the bottom left corner.
      </Tip>
    </>
  )
}

function AboutStep({ brand, intro, onIntro }: { brand: Brand; intro: string; onIntro: (v: string) => void }) {
  const country = countries[brand.country as keyof typeof countries]?.name ?? brand.country
  return (
    <>
      <div className="grid gap-1.5">
        <label htmlFor="shop-intro" className="text-[15px] font-medium text-ink">
          Your line
        </label>
        <Textarea
          id="shop-intro"
          autoFocus
          value={intro}
          maxLength={INTRO_MAX}
          rows={4}
          onChange={(e) => onIntro(e.target.value)}
          placeholder="e.g. Small runs, made by hand in our own studio. For the ones who stay out late."
          aria-describedby="shop-intro-hint"
          className="min-h-28 rounded-xl text-base md:text-[15px]"
        />
        <FieldMessage id="shop-intro" hint={`One line is plenty; a short story works too. ${intro.length}/${INTRO_MAX}`} />
      </div>
      <div className="flex items-start gap-3 rounded-xl border border-line-soft bg-surface/60 p-3.5">
        <MapPin aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-3" />
        <p className="min-w-0 text-[13px] text-ink-2">
          <span className="text-ink">
            Based in {brand.city}, {country}
          </span>
          . Shown under your name. Moved?{" "}
          <Link href="/studio/support" className="font-medium text-ink underline underline-offset-4 hover:text-violet">
            Tell Yard Support
          </Link>{" "}
          and we&apos;ll update it.
        </p>
      </div>
    </>
  )
}

function ReviewStep({ backend, brand, config, hidden }: { backend: Backend; brand: Brand; config: EditorConfig; hidden: boolean }) {
  const [device, setDevice] = useState<Device>("mobile")
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-ink-2">{device === "desktop" ? "On a computer" : "On a phone"}</p>
        <DeviceToggle value={device} onChange={setDevice} />
      </div>
      <div className={cn("mx-auto w-full", device === "mobile" && "max-w-[20rem]")}>
        <HeroPreview key={device} backend={backend} brand={brand} config={config} device={device} height={device === "desktop" ? 620 : 700} />
      </div>
      <ul className="grid gap-1.5 text-[13px] text-ink-2">
        <Check1 ok={!!brand.logoSrc}>{brand.logoSrc ? "Logo added" : "No logo yet: your initials show (fine for now)"}</Check1>
        <Check1 ok={!!config.cover}>{config.cover ? "Banner added" : "No banner yet: we use your first product photo"}</Check1>
        <Check1 ok={!!config.intro?.trim()}>{config.intro?.trim() ? "Your line is in" : "No line yet: add one any time"}</Check1>
      </ul>
      <p className="text-[13px] text-pretty text-ink-2">
        <span className="text-ink">Publish my shop</span> makes all of this public{hidden ? ", and opens your shop on Yard for the first time" : ""}. You can change anything later in the storefront editor.
      </p>
    </>
  )
}

function Check1({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2">
      <span className={cn("inline-flex size-4 shrink-0 items-center justify-center rounded-full", ok ? "bg-purple text-ink" : "border border-white/20")} aria-hidden>
        {ok ? <Check weight="bold" className="size-2.5" /> : null}
      </span>
      {children}
    </li>
  )
}

function ShopLive({ brand, live, headingRef, noProducts }: { brand: Brand; live: boolean; headingRef: React.Ref<HTMLHeadingElement>; noProducts: boolean }) {
  const path = `/brands/${encodeURIComponent(brand.handle)}`
  async function share() {
    const url = `${window.location.origin}${path}`
    try {
      if (navigator.share) {
        await navigator.share({ title: brand.name, url })
        return
      }
      await navigator.clipboard.writeText(url)
      toast.success("Link copied", { description: "Drop it in your bio, your story, the group chat." })
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return
      toast.error("Couldn't share the link", { description: url })
    }
  }
  return (
    <div className="relative mx-auto w-full max-w-xl pt-6 pb-16 text-center">
      <Confetti />
      <span className="step-pop mx-auto inline-flex size-16 items-center justify-center rounded-full bg-acid text-obsidian" aria-hidden>
        <Storefront weight="fill" className="size-7" />
      </span>
      <h1 ref={headingRef} tabIndex={-1} className="mt-6 text-[2rem] leading-tight font-medium tracking-tight text-balance text-ink outline-none md:text-[2.5rem]">
        Your shop is live 🎉
      </h1>
      <p className="mx-auto mt-3 max-w-md text-[15px] text-pretty text-ink-2">
        {noProducts ? `${brand.name} is open on Yard. Next up: your first product, so there's something to cop.` : `${brand.name} is open on Yard with your new look. Go show it off.`}
      </p>
      <div className="mx-auto mt-8 grid max-w-sm gap-2">
        {noProducts ? (
          <Button asChild variant="primary" className="h-12 rounded-xl text-[15px]">
            <Link href={QUICK_ADD_HREF}>
              <Lightning weight="fill" aria-hidden /> Add a product
            </Link>
          </Button>
        ) : null}
        <Button asChild variant={noProducts ? "secondary" : "primary"} className="h-12 rounded-xl text-[15px]">
          <a href={path} target="_blank" rel="noopener">
            View my shop <External aria-hidden className="size-4" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </Button>
        {live ? (
          <Button type="button" variant="secondary" className="h-12 rounded-xl" onClick={() => void share()}>
            {typeof navigator !== "undefined" && "share" in navigator ? <Share aria-hidden /> : <LinkIcon aria-hidden />} Share link
          </Button>
        ) : null}
        {noProducts ? null : (
          <Button asChild variant="secondary" className="h-12 rounded-xl">
            <Link href={QUICK_ADD_HREF}>
              <Lightning aria-hidden /> Add a product
            </Link>
          </Button>
        )}
      </div>
    </div>
  )
}
