"use client"

import { useCallback, useLayoutEffect, useRef, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { AnimatePresence, motion } from "motion/react"
import { WarningIcon as AlertTriangle, ArrowLeftIcon as ArrowLeft, ArrowRightIcon as ArrowRight, CalendarDotsIcon as CalendarClock, CheckIcon as Check, CreditCardIcon as CreditCard, BankIcon as Landmark, LockIcon as Lock, MagnifyingGlassMinusIcon as SearchX, ShieldCheckIcon as ShieldCheck } from "@phosphor-icons/react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { EmptyState } from "@/components/dashboard/empty-state"
import { PageHeader } from "@/components/dashboard/page-header"
import { StatusBadge, campaignStatusMeta } from "@/components/dashboard/status-badge"
import { BrandMark } from "@/components/market/brand-mark"
import { BackLink } from "@/components/studio/business/shared"
import { useLeaveGuard } from "@/components/studio/catalog/save-bar"
import { countries, countryCodes } from "@/config/markets"
import { getDemoAnchor, useNow } from "@/hooks/use-now"
import { categories, collectionsOf, curatedCollections } from "@/lib/data"
import { brandById } from "@/lib/data/brands"
import { campaignTypes, type Campaign, type CampaignType, type Placement } from "@/lib/data/ads"
import { productStock } from "@/lib/data/products"
import { dropPhaseAt } from "@/lib/drops"
import { formatMoney, formatNumber, formatPercent } from "@/lib/money"
import { useAdmin } from "@/lib/stores/admin"
import { useStudio } from "@/lib/stores/studio"
import { cn } from "@/lib/utils"
import { ChipToggle, ChoiceCard, ChoiceGroup, ChoiceTick, control, Field, inputClass, NumberStepper, Panel, Segmented, WizardSkeleton } from "./form"
import { PlacementPreview, resolveTarget } from "./placement-preview"
import { sendCampaignToReview, useGrowth, useGrowthReady } from "./store"
import { addDays, adVatRate, brandZone, campaignCost, daysBetween, formatDate, impressionEstimate, needsCategory, placementMeta, studioDropStatus, targetKindLabel, localId, todayIn, typeTargets, usdAndLocal, usdAndLocalText, utcToZoned, type TargetKind } from "./utils"

const STEPS = [
  { key: "type", title: "Campaign type" },
  { key: "target", title: "What to promote" },
  { key: "audience", title: "Audience" },
  { key: "placements", title: "Placements" },
  { key: "budget", title: "Budget" },
  { key: "duration", title: "Duration" },
  { key: "preview", title: "Preview" },
  { key: "pay", title: "Payment" },
  { key: "submit", title: "Submit for review" },
  { key: "results", title: "Track results" },
] as const

const LAST_INTERACTIVE = 8
const MAX_DAYS = 30
const MAX_ADVANCE_DAYS = 60

type W = {
  type: CampaignType | null
  name: string
  nameTouched: boolean
  targetKind: TargetKind | null
  targetId: string | null
  categories: string[]
  countries: string[]
  placements: Placement[]
  days: string
  startDate: string
  /** Amount paid (USD cents, simulated). The payment only counts while it matches the current total. */
  paidAmount: number | null
  payRef: string | null
  payMethod: "card" | "balance"
  agreed: boolean
}

type StepErrors = Partial<Record<"type" | "target" | "name" | "categories" | "placements" | "days" | "startDate" | "pay" | "agreed", string>>

function kindOf(id: string): TargetKind {
  if (id.startsWith("b_")) return "brand"
  if (id.startsWith("p_")) return "products"
  if (id.startsWith("d_")) return "drop"
  if (id.startsWith("cc_")) return "curated"
  return "collection"
}

export function CampaignWizard({ campaignId }: { campaignId: string | null }) {
  const [generation, setGeneration] = useState(0)
  const reset = useCallback(() => setGeneration((g) => g + 1), [])
  const ready = useGrowthReady()
  const now = useNow(60_000)
  const campaigns = useStudio((s) => s.campaigns)
  if (!ready || now === null) return <WizardSkeleton />
  const existing = campaignId ? campaigns.find((c) => c.id === campaignId) : undefined
  if (campaignId && !existing) {
    return (
      <div className="grid gap-6">
        <BackLink href="/studio/advertising">Advertising</BackLink>
        <EmptyState icon={SearchX} title="This campaign isn't here" body="It may have been created in another browser. Campaigns are saved in this browser until the store is connected." action={<Button asChild size="sm" variant="secondary"><Link href="/studio/advertising">Back to advertising</Link></Button>} />
      </div>
    )
  }
  if (existing && existing.status !== "draft" && existing.status !== "rejected") {
    const meta = campaignStatusMeta[existing.status]
    return (
      <div className="grid gap-6">
        <BackLink href="/studio/advertising">Advertising</BackLink>
        <EmptyState
          icon={Lock}
          title={`This campaign is ${meta.label.toLowerCase()}`}
          body={
            existing.status === "in_review"
              ? "It's in review, so it can't be changed right now. Withdraw it from review on the results page to make changes; the payment is refunded in full."
              : "Only drafts and rejected campaigns can be edited. Approved campaigns keep running as booked."
          }
          action={<Button asChild size="sm" variant="secondary"><Link href={`/studio/advertising/${existing.id}`}>{existing.status === "in_review" ? "Go to results" : "View results"}</Link></Button>}
        />
      </div>
    )
  }
  return <Wizard key={`${campaignId ?? "new"}:${generation}`} existing={existing} now={now} onReset={reset} />
}

function Wizard({ existing, now, onReset }: { existing?: Campaign; now: number; onReset: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const savedRef = useRef(false)

  // Visited pages stay alive (hidden) for back/forward; after a save, start fresh next time.
  useLayoutEffect(() => {
    return () => {
      if (savedRef.current) {
        savedRef.current = false
        onReset()
      }
    }
  }, [onReset])
  const brandId = useStudio((s) => s.brandId)
  const products = useStudio((s) => s.products)
  const drops = useStudio((s) => s.drops)
  const upsertCampaign = useStudio((s) => s.upsertCampaign)
  const dropMeta = useGrowth((s) => s.dropMeta)
  // Prices are set in the Admin Control Center; they start from the rate card in @/lib/data/ads.
  const pricing = useAdmin((s) => s.pricing)
  const brand = brandById.get(brandId)!
  const tz = brandZone(brand).tz
  const today = todayIn(tz, now)
  const tomorrow = addDays(today, 1)
  const anchor = getDemoAnchor()

  const [w, setW] = useState<W>(() => {
    if (existing) {
      const start = addDays(today, existing.startDaysFromToday)
      const id = existing.targetIds[0] ?? null
      return {
        type: existing.type,
        name: existing.name,
        nameTouched: true,
        targetKind: id ? kindOf(id) : typeTargets[existing.type][0],
        targetId: id,
        categories: existing.audience.categories,
        countries: existing.audience.countries,
        placements: existing.placements,
        days: String(existing.days),
        startDate: start < tomorrow ? tomorrow : start,
        paidAmount: null,
        payRef: null,
        payMethod: "card",
        agreed: false,
      }
    }
    return { type: null, name: "", nameTouched: false, targetKind: null, targetId: null, categories: [], countries: [], placements: [], days: "7", startDate: addDays(today, 3), paidAmount: null, payRef: null, payMethod: "card", agreed: false }
  })
  const [step, setStep] = useState(existing ? 1 : 0)
  const [maxStep, setMaxStep] = useState(existing ? 6 : 0)
  const [dir, setDir] = useState(1)
  const [errors, setErrors] = useState<StepErrors>({})
  // One id per wizard, so a repeated click saves the same campaign instead of a second one.
  const idRef = useRef(existing?.id ?? localId("cmp_local_"))
  // Set once a save is leaving the page: blocks repeat submits while the route changes.
  const [leaving, setLeaving] = useState(false)

  /** Editing a field clears only that field's message; others stay until they're fixed. */
  const errorFor: Partial<Record<keyof W, keyof StepErrors>> = { type: "type", name: "name", targetId: "target", categories: "categories", placements: "placements", days: "days", startDate: "startDate", paidAmount: "pay", agreed: "agreed" }
  const clearError = (k: keyof StepErrors) => setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e))
  const set = <K extends keyof W>(k: K, v: W[K]) => {
    setW((x) => ({ ...x, [k]: v }))
    const ek = errorFor[k]
    if (ek) clearError(ek)
  }

  // Leaving with unsaved steps asks first (reload, close, the sidebar or the back link).
  const [initial] = useState(() => JSON.stringify(w))
  const dirty = JSON.stringify(w) !== initial
  const guard = useLeaveGuard(dirty, { body: existing ? "Your changes to this campaign will be lost." : "This campaign hasn't been saved. Save it as a draft to come back to it." })
  const price = w.type ? (pricing?.[w.type] ?? campaignTypes[w.type].priceUsd) : 0
  const days = Math.max(0, Math.floor(Number(w.days) || 0))
  const cost = w.type ? campaignCost(w.type, Math.max(1, days), price) : 0
  const vatRate = adVatRate[brand.country] ?? 0
  const vat = Math.round(cost * vatRate)
  const endDate = addDays(w.startDate, Math.max(1, days) - 1)
  const target = resolveTarget(w.targetId ?? undefined, brand, products, drops)
  const paid = w.paidAmount !== null && w.paidAmount === cost + vat

  /* Options for step 2 */
  const productOptions = products.filter((p) => p.status === "published")
  const dropOptions = drops.filter((d) => {
    const s = studioDropStatus(d, dropMeta[d.id], now, anchor)
    return s === "scheduled" || s === "live"
  })
  const collectionOptions = collectionsOf(brandId)
  const curatedOptions = curatedCollections.filter((c) => c.brandIds.includes(brandId) && (!c.sponsoredBy || c.sponsoredBy === brandId))

  function autoName(kind: TargetKind | null, id: string | null, type: CampaignType | null) {
    if (!type) return ""
    const month = new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: tz }).format(new Date(`${w.startDate}T12:00:00Z`))
    const t = resolveTarget(id ?? undefined, brand, products, drops)
    if (!t || kind === "brand") return `${brand.name}, ${campaignTypes[type].name.toLowerCase()} in ${month}`
    if (t.kind === "product") return `${t.name} in ${categories.find((c) => c.slug === t.product?.category)?.name ?? "its category"}`
    if (t.kind === "drop") return `${t.name} release`
    if (t.kind === "curated") return `${t.name} sponsorship`
    return `${t.name} ${type === "homepage-spotlight" ? "spotlight" : "promotion"}`
  }

  function chooseType(type: CampaignType) {
    const kind = typeTargets[type][0]
    const targetId = kind === "brand" ? brand.id : null
    setW((x) => ({
      ...x,
      type,
      targetKind: kind,
      targetId,
      placements: [...campaignTypes[type].placements],
      categories: type === "category-promotion" ? [brand.categories[0]] : needsCategory(type) ? [brand.categories[0]] : x.categories.length ? x.categories : [...brand.categories],
      days: campaignTypes[type].unit === "campaign" ? (type === "sponsored-drop" ? "3" : "14") : x.days,
      name: x.nameTouched ? x.name : autoName(kind, targetId, type),
      paidAmount: null,
      payRef: null,
    }))
    if (type !== w.type) setMaxStep(0)
    setErrors({})
  }

  function chooseTarget(kind: TargetKind, id: string | null) {
    setW((x) => {
      const t = resolveTarget(id ?? undefined, brand, products, drops)
      const cats = x.type === "sponsored-product" && t?.product ? [t.product.category] : x.categories
      return { ...x, targetKind: kind, targetId: id, categories: cats, name: x.nameTouched ? x.name : autoName(kind, id, x.type) }
    })
    setErrors((e) => ({ ...e, target: undefined }))
  }

  function validate(s: number): StepErrors {
    const e: StepErrors = {}
    if (s === 0 && !w.type) e.type = "Choose a campaign type."
    if (s === 1) {
      if (!w.targetId) e.target = w.targetKind === "products" ? "Choose the product to feature." : w.targetKind === "drop" ? "Choose the drop to feature." : w.targetKind === "curated" ? "Choose a curated collection." : "Choose what to promote."
      const name = w.name.trim()
      if (name.length < 3) e.name = "Name the campaign so you can find it later (at least 3 characters)."
      else if (name.length > 60) e.name = "Keep the name to 60 characters or fewer."
    }
    if (s === 2 && w.type) {
      if (w.type === "category-promotion" && w.categories.length !== 1) e.categories = "Choose the one category the banner runs in."
      else if (needsCategory(w.type) && w.categories.length === 0) e.categories = "Choose at least one category. Sponsored slots sit inside categories."
    }
    if (s === 3 && w.placements.length === 0) e.placements = "Choose at least one placement."
    if (s === 4 || s === 5) {
      if (!/^\d+$/.test(w.days) || days < 1) e.days = "Run the campaign for at least 1 day."
      else if (days > MAX_DAYS) e.days = `Campaigns run for up to ${MAX_DAYS} days.`
    }
    if (s === 5) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(w.startDate)) e.startDate = "Choose a start date."
      else if (w.startDate < tomorrow) e.startDate = "Start tomorrow or later. Review takes up to 1 business day."
      else if (daysBetween(today, w.startDate) > MAX_ADVANCE_DAYS) e.startDate = `Book up to ${MAX_ADVANCE_DAYS} days ahead.`
    }
    if (s === 7 && !paid) e.pay = "Complete the payment to continue."
    if (s === 8 && !w.agreed) e.agreed = "Confirm the campaign follows the advertising rules."
    return e
  }

  function go(to: number) {
    setDir(to > step ? 1 : -1)
    setStep(to)
    setMaxStep((m) => Math.max(m, to))
    setErrors({})
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  /** Stepper jumps forward only through steps that are complete. */
  function jump(to: number) {
    if (to < step) return go(to)
    for (let s = step; s < to; s++) {
      const e = validate(s)
      if (Object.keys(e).length) {
        if (s !== step) go(s)
        setErrors(e)
        return
      }
    }
    go(to)
  }

  function next() {
    const e = validate(step)
    setErrors(e)
    if (Object.keys(e).length) {
      const first = Object.keys(e)[0]
      const el = rootRef.current?.querySelector<HTMLElement>(`#cw-${first}`)
      // Card groups (type, target) are radiogroups, which can't take focus: focus the chosen card, or the first.
      const target = el?.getAttribute("role") === "radiogroup" ? (el.querySelector<HTMLElement>("[role=radio][data-state=checked]") ?? el.querySelector<HTMLElement>("[role=radio]:not([disabled])")) : el
      target?.focus()
      return
    }
    if (step === LAST_INTERACTIVE) return submit()
    go(step + 1)
  }

  function build(status: Campaign["status"]): Campaign {
    return {
      id: idRef.current,
      brandId,
      type: w.type!,
      name: w.name.trim() || autoName(w.targetKind, w.targetId, w.type),
      status,
      targetIds: w.targetId ? [w.targetId] : [],
      audience: { categories: w.categories, countries: w.countries },
      placements: w.placements,
      startDaysFromToday: daysBetween(today, w.startDate),
      days: Math.max(1, Math.min(MAX_DAYS, days || 1)),
      budget: cost,
      currency: "USD",
      results: { impressions: 0, reach: 0, clicks: 0, productViews: 0, addToCarts: 0, purchases: 0, revenue: 0 },
    }
  }

  function saveDraft() {
    if (leaving) return
    if (!w.type) {
      setErrors({ type: "Choose a campaign type before saving a draft." })
      return
    }
    const c = build("draft")
    upsertCampaign(c)
    savedRef.current = true
    setLeaving(true)
    toast.success("Draft saved", { description: `${c.name}. Nothing is booked until you pay and submit it.` })
    guard.go("/studio/advertising")
  }

  function pay() {
    const ref = `SIM-${localId("cmp_local_").slice(-6).toUpperCase()}`
    setW((x) => ({ ...x, paidAmount: cost + vat, payRef: ref }))
    clearError("pay")
    // The paid line appears in place; the reference is shown there.
  }

  function submit() {
    if (leaving) return
    const c = build("in_review")
    upsertCampaign(c)
    sendCampaignToReview(c)
    savedRef.current = true
    setLeaving(true)
    toast.success("Submitted for review", { description: "It's in the platform's review queue. Its status here changes when the team decides." })
    guard.go(`/studio/advertising/${c.id}`)
  }

  const money = (usd: number) => usdAndLocal(usd, brand.currency)
  const typeMeta = w.type ? campaignTypes[w.type] : null

  return (
    <div ref={rootRef} className="grid gap-6">
      <div className="grid gap-2">
        <BackLink href="/studio/advertising">Advertising</BackLink>
        <PageHeader
          title={existing ? (existing.status === "rejected" ? "Edit and resubmit" : "Continue campaign") : "Create a campaign"}
          description="Fixed-price sponsored placements, booked for set dates. Every placement is labelled Sponsored."
        >
          {existing ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <StatusBadge tone={campaignStatusMeta[existing.status].tone}>{campaignStatusMeta[existing.status].label}</StatusBadge>
              <span className="text-xs text-ink-3">{existing.name}</span>
            </div>
          ) : null}
        </PageHeader>
      </div>

      {existing?.status === "rejected" && existing.rejectionReason ? (
        <div role="note" className="flex gap-3 rounded-lg border border-danger/30 bg-danger/5 p-4">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
          <div className="text-sm">
            <p className="font-medium text-ink">Why it was rejected</p>
            <p className="mt-1 text-ink-2">{existing.rejectionReason}</p>
            <p className="mt-1 text-xs text-ink-3">Your earlier payment was refunded in full. Fix the issue, then pay and submit again.</p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        {/* Stepper: vertical on desktop, compact on phones */}
        <nav aria-label="Campaign steps" className="lg:sticky lg:top-24 lg:self-start">
          <div className="lg:hidden">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-medium text-ink">{STEPS[step].title}</p>
              <p className="text-xs text-ink-3 tabular">Step {step + 1} of {STEPS.length}</p>
            </div>
            <div className="mt-2 grid grid-cols-10 gap-1" aria-hidden>
              {STEPS.map((s, i) => (
                <span key={s.key} className={cn("h-1 rounded-full", i < step ? "bg-violet" : i === step ? "bg-ink" : "bg-line")} />
              ))}
            </div>
          </div>
          <ol className="hidden gap-0.5 lg:grid">
            {STEPS.map((s, i) => {
              const done = i !== step && (i < step || i < maxStep)
              const reachable = i <= maxStep && i <= LAST_INTERACTIVE
              const current = i === step
              return (
                <li key={s.key}>
                  <button
                    type="button"
                    disabled={!reachable || current}
                    onClick={() => jump(i)}
                    aria-current={current ? "step" : undefined}
                    className={cn("relative flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors", current ? "text-ink" : reachable ? "text-ink-2 hover:bg-white/4 hover:text-ink" : "cursor-default text-ink-3")}
                  >
                    {current ? <motion.span layoutId="cw-step" className="absolute inset-0 -z-10 rounded-md bg-elevated" transition={{ type: "spring", stiffness: 500, damping: 40 }} /> : null}
                    <span className={cn("inline-flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] tabular", current ? "border-purple bg-purple text-ink" : done ? "border-violet/60 text-violet" : "border-line text-ink-3")}>
                      {done && !current ? <Check className="size-3" /> : i + 1}
                    </span>
                    <span className="truncate">{s.title}</span>
                  </button>
                </li>
              )
            })}
          </ol>
          {typeMeta ? (
            <div className="mt-4 hidden rounded-lg border border-line-soft bg-card p-3 text-xs lg:block">
              <p className="text-ink-3">Total so far</p>
              <p className="mt-1 text-base font-medium text-ink tabular">{money(cost).usd}</p>
              {money(cost).local ? <p className="text-ink-2 tabular">{money(cost).local}</p> : null}
              <p className="mt-1 text-ink-3">{typeMeta.name}{typeMeta.unit === "day" ? `, ${Math.max(1, days)} days` : ""}</p>
            </div>
          ) : null}
        </nav>

        <div className="min-w-0">
          <AnimatePresence mode="wait" initial={false} custom={dir}>
            <motion.div
              key={step}
              custom={dir}
              initial={{ opacity: 0, x: dir * 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: dir * -24 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="grid gap-6"
            >
              {step === 0 ? (
                <Panel title="1. Campaign type" description="Prices are fixed and published before you book. There's no bidding.">
                  <ChoiceGroup id="cw-type" label="Campaign type" value={w.type} onValueChange={(v) => chooseType(v as CampaignType)} error={errors.type} className="md:grid-cols-2">
                    {(Object.keys(campaignTypes) as CampaignType[]).map((t) => {
                      const meta = campaignTypes[t]
                      const p = pricing?.[t] ?? meta.priceUsd
                      const m = money(p)
                      return (
                        <ChoiceCard key={t} value={t} className="p-4">
                          <span className="flex items-start justify-between gap-3">
                            <span className="text-sm font-medium text-ink">{meta.name}</span>
                            <ChoiceTick on={w.type === t} />
                          </span>
                          <span className="mt-1 block text-xs leading-relaxed text-ink-2">{meta.description}</span>
                          <span className="mt-3 flex flex-wrap items-baseline gap-x-2 text-sm">
                            <span className="font-medium text-ink tabular">{m.usd}</span>
                            <span className="text-xs text-ink-3">per {meta.unit}</span>
                            {m.local ? <span className="text-xs text-ink-3 tabular">({m.local})</span> : null}
                          </span>
                        </ChoiceCard>
                      )
                    })}
                  </ChoiceGroup>
                  {errors.type ? <p id="cw-type-error" className="mt-2 text-xs text-danger">{errors.type}</p> : null}
                </Panel>
              ) : null}

              {step === 1 && w.type ? (
                <Panel title="2. What to promote" description={campaignTypes[w.type].description}>
                  <div className="grid gap-5">
                    {typeTargets[w.type].length > 1 ? (
                      <Segmented<TargetKind>
                        id="cw-target-kind"
                        label="Promote"
                        value={w.targetKind}
                        onChange={(k) => chooseTarget(k, k === "brand" ? brand.id : null)}
                        options={typeTargets[w.type].map((k) => ({ value: k, label: targetKindLabel[k] }))}
                      />
                    ) : null}

                    {w.targetKind === "brand" ? (
                      <div className="flex items-center gap-3 rounded-lg border border-purple/60 bg-purple/10 p-3">
                        <BrandMark brand={brand} size="md" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-ink">{brand.name}</p>
                          <p className="truncate text-xs text-ink-2">{formatNumber(brand.followers)} followers, {brand.city}</p>
                        </div>
                        <ChoiceTick on />
                      </div>
                    ) : null}

                    {w.targetKind === "products" ? (
                      <TargetList id="cw-target" label="Product" error={errors.target} value={w.targetId} onChange={(id) => chooseTarget("products", id)} items={productOptions.map((p) => ({ id: p.id, title: p.name, meta: `${formatMoney(p.price, p.currency)}, ${productStock(p) ? `${formatNumber(productStock(p))} in stock` : "out of stock"}`, image: p.images[0].src, disabled: productStock(p) === 0 }))} empty="Publish a product with stock to promote it." />
                    ) : null}
                    {w.targetKind === "drop" ? (
                      dropOptions.length ? (
                        <TargetList id="cw-target" label="Drop" error={errors.target} value={w.targetId} onChange={(id) => chooseTarget("drop", id)} items={dropOptions.map((d) => ({ id: d.id, title: d.name, meta: dropPhaseAt(d, now, anchor) === "live" ? "Live now" : `Releases ${formatDate(utcToZoned(anchor + d.releaseOffsetHours * 3_600_000, tz).date)}`, image: d.image.src }))} />
                      ) : (
                        <EmptyState icon={CalendarClock} title="No upcoming drops" body="Schedule a drop first, then promote it here." action={<Button asChild variant="secondary" size="sm"><Link href="/studio/drops/new">Schedule a drop</Link></Button>} className="py-10" />
                      )
                    ) : null}
                    {w.targetKind === "collection" ? (
                      <TargetList id="cw-target" label="Collection" error={errors.target} value={w.targetId} onChange={(id) => chooseTarget("collection", id)} items={collectionOptions.map((c) => ({ id: c.id, title: c.name, meta: `${c.productIds.length} products`, image: c.image.src }))} />
                    ) : null}
                    {w.targetKind === "curated" ? (
                      <TargetList id="cw-target" label="Curated collection" error={errors.target} value={w.targetId} onChange={(id) => chooseTarget("curated", id)} items={curatedOptions.map((c) => ({ id: c.id, title: c.name, meta: `${c.brandIds.length} brands, curated by NOCTURNE`, image: c.image.src }))} empty="You can sponsor a curated collection once your brand is featured in one." />
                    ) : null}
                    {errors.target && w.targetKind !== "brand" ? <p id="cw-target-error" className="-mt-3 text-xs text-danger">{errors.target}</p> : null}

                    <Field id="cw-name" label="Campaign name" error={errors.name} hint="Only you see this.">
                      <Input {...control("cw-name", errors.name, true)} value={w.name} maxLength={70} onChange={(e) => { setW((x) => ({ ...x, name: e.target.value, nameTouched: true })); clearError("name") }} className={inputClass} />
                    </Field>
                  </div>
                </Panel>
              ) : null}

              {step === 2 && w.type ? (
                <Panel title="3. Audience" description="Sponsored placements are contextual: they appear in these categories and markets. Shoppers aren't targeted with personal data.">
                  <div className="grid gap-6">
                    <Field id="cw-categories" label={w.type === "category-promotion" ? "Category" : "Categories"} as="legend" error={errors.categories} hint={w.type === "category-promotion" ? "The banner runs at the top of one category." : needsCategory(w.type) ? "Your slot shows in the grid and search results of these categories." : "Optional. Leave all off to show everywhere the placement appears."}>
                      <div id="cw-categories" tabIndex={-1} className="flex flex-wrap gap-2 outline-none">
                        {categories.map((c) => {
                          const on = w.categories.includes(c.slug)
                          return (
                            <ChipToggle key={c.slug} on={on} onClick={() => set("categories", w.type === "category-promotion" ? [c.slug] : on ? w.categories.filter((x) => x !== c.slug) : [...w.categories, c.slug])}>
                              {c.name}
                            </ChipToggle>
                          )
                        })}
                      </div>
                    </Field>
                    <Field id="cw-countries" label="Markets" as="legend" hint={w.countries.length ? `${w.countries.length} selected. Shoppers browsing from these countries see it.` : "Shown in every market."}>
                      <div className="flex flex-wrap gap-2">
                        <ChipToggle on={w.countries.length === 0} onClick={() => set("countries", [])}>All markets</ChipToggle>
                        {countryCodes.map((code) => {
                          const on = w.countries.includes(code)
                          return (
                            <ChipToggle key={code} on={on} onClick={() => set("countries", on ? w.countries.filter((x) => x !== code) : [...w.countries, code])}>
                              {countries[code].name}
                            </ChipToggle>
                          )
                        })}
                      </div>
                    </Field>
                  </div>
                </Panel>
              ) : null}

              {step === 3 && w.type ? (
                <Panel title="4. Placements" description="Where the campaign appears. Sponsored slots are fixed positions; they never replace organic results.">
                  <Field id="cw-placements" label="Placements" as="legend" error={errors.placements}>
                    <ul id="cw-placements" tabIndex={-1} className="grid gap-2 outline-none">
                      {campaignTypes[w.type].placements.map((p) => {
                        const on = w.placements.includes(p)
                        const only = campaignTypes[w.type!].placements.length === 1
                        return (
                          <li key={p}>
                            <label className={cn("flex cursor-pointer items-start gap-3 rounded-lg border p-3.5 transition-colors", on ? "border-purple/60 bg-purple/10" : "border-line hover:bg-elevated/60", only && "cursor-default")}>
                              <Checkbox className="mt-0.5" checked={on} disabled={only} aria-invalid={errors.placements ? true : undefined} onCheckedChange={(c) => set("placements", c ? [...w.placements, p] : w.placements.filter((x) => x !== p))} />
                              <span className="min-w-0">
                                <span className="block text-sm font-medium text-ink">{placementMeta[p].label}</span>
                                <span className="mt-0.5 block text-xs text-ink-2">{placementMeta[p].where}</span>
                              </span>
                            </label>
                          </li>
                        )
                      })}
                    </ul>
                  </Field>
                  {campaignTypes[w.type].placements.length === 1 ? <p className="mt-3 text-xs text-ink-3">This campaign type has one placement.</p> : null}
                </Panel>
              ) : null}

              {step === 4 && w.type ? (
                <Panel title="5. Budget" description={typeMeta!.unit === "day" ? "A fixed price per day. Your budget is the day rate times the number of days." : "One fixed price for the whole campaign."}>
                  <div className="grid gap-5 md:grid-cols-2">
                    <div className="grid content-start gap-4">
                      <div className="rounded-md border border-line-soft bg-surface/60 p-3">
                        <p className="text-xs text-ink-3">Rate</p>
                        <p className="mt-1 text-sm text-ink tabular">
                          {money(price).usd} per {typeMeta!.unit}
                          {money(price).local ? <span className="text-ink-3"> ({money(price).local})</span> : null}
                        </p>
                      </div>
                      {typeMeta!.unit === "day" ? (
                        <Field id="cw-days" label="Number of days" error={errors.days} hint={`1 to ${MAX_DAYS} days.`}>
                          <NumberStepper id="cw-days" label="days" value={w.days} onChange={(v) => set("days", v)} min={1} max={MAX_DAYS} invalid={!!errors.days} describedBy={errors.days ? "cw-days-error" : "cw-days-hint"} suffix="days" />
                          <div className="mt-1 flex flex-wrap gap-2">
                            {[3, 7, 14, 30].map((n) => (
                              <ChipToggle key={n} on={days === n} onClick={() => set("days", String(n))}>{n} days</ChipToggle>
                            ))}
                          </div>
                        </Field>
                      ) : (
                        <p className="text-xs text-ink-2">Runs for up to {MAX_DAYS} days. You&apos;ll set the dates in the next step.</p>
                      )}
                    </div>
                    <div className="rounded-lg border border-line-soft bg-surface/40 p-4">
                      <p className="text-xs text-ink-3">Budget</p>
                      <p className="mt-1 text-2xl font-medium tracking-tight text-ink tabular">{money(cost).usd}</p>
                      {money(cost).local ? <p className="text-sm text-ink-2 tabular">{money(cost).local}</p> : null}
                      <p className="mt-1 text-xs text-ink-3 tabular">
                        {typeMeta!.unit === "day" ? `${money(price).usd} × ${Math.max(1, days)} days` : "Flat price"}
                        {vatRate ? `, plus ${formatPercent(vatRate, 1)} VAT at payment` : ""}
                      </p>
                      <div className="mt-4 border-t border-line-soft pt-3">
                        <p className="text-xs text-ink-3">Estimated impressions</p>
                        <p className="mt-0.5 text-sm text-ink tabular">
                          {(() => {
                            const e = impressionEstimate(w.type!, Math.max(1, days))
                            return `${formatNumber(e.low)} to ${formatNumber(e.high)}`
                          })()}
                        </p>
                        <p className="mt-0.5 text-xs text-ink-3">An estimate from recent traffic, not a guarantee.</p>
                      </div>
                    </div>
                  </div>
                  <p className="mt-4 text-xs text-ink-3">Your 5% commission doesn&apos;t change with advertising, whether a sale came from a campaign or not. Shown in USD, with {brand.currency} at today&apos;s rate.</p>
                </Panel>
              ) : null}

              {step === 5 && w.type ? (
                <Panel title="6. Duration" description={`Dates are in your brand's time zone. Book up to ${MAX_ADVANCE_DAYS} days ahead.`}>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field id="cw-startDate" label="Start date" error={errors.startDate} hint="Review takes up to 1 business day, so the earliest start is tomorrow.">
                      <Input {...control("cw-startDate", errors.startDate, true)} type="date" value={w.startDate} min={tomorrow} max={addDays(today, MAX_ADVANCE_DAYS)} onChange={(e) => set("startDate", e.target.value)} className={cn(inputClass, "[color-scheme:dark]")} />
                    </Field>
                    <Field id="cw-days" label="Days" error={errors.days} hint={typeMeta!.unit === "day" ? "Changing the days changes the budget." : "Included in the flat price."}>
                      <NumberStepper id="cw-days" label="days" value={w.days} onChange={(v) => set("days", v)} min={1} max={MAX_DAYS} invalid={!!errors.days} describedBy={errors.days ? "cw-days-error" : "cw-days-hint"} suffix="days" />
                    </Field>
                  </div>
                  {/^\d{4}-\d{2}-\d{2}$/.test(w.startDate) && days >= 1 ? (
                    <div className="mt-4 grid gap-1 rounded-md border border-line-soft bg-surface/60 p-3 text-xs">
                      <p className="text-ink-2">
                        Runs <span className="text-ink tabular">{formatDate(w.startDate, { weekday: true })}</span> to <span className="text-ink tabular">{formatDate(endDate, { weekday: true })}</span>, {days} {days === 1 ? "day" : "days"}
                      </p>
                      <p className="text-ink-3">Budget {money(cost).usd}{money(cost).local ? ` (${money(cost).local})` : ""}</p>
                    </div>
                  ) : null}
                </Panel>
              ) : null}

              {step === 6 && w.type ? (
                <Panel title="7. Preview" description={w.type === "sponsored-brand" || w.type === "sponsored-product" || w.type === "category-promotion" ? "How the placement will look to shoppers. Organic neighbours are dimmed so you can see your slot." : "How the placement will look to shoppers."}>
                  <PlacementPreview type={w.type} brand={brand} target={target} categories={w.categories} />
                </Panel>
              ) : null}

              {step === 7 && w.type ? (
                <Panel title="8. Payment" description="Pay for the booking, then submit it for review.">
                  <div role="note" className="mb-5 flex items-start gap-3 rounded-md border border-acid/30 bg-acid/[0.04] p-3 text-xs text-ink-2">
                    <ShieldCheck className="mt-0.5 size-4 shrink-0 text-acid" />
                    <p><span className="font-medium text-ink">Simulated payment.</span> No payment provider is connected in this development build: nothing is charged, no card details are collected and nothing is deducted from payouts.</p>
                  </div>
                  <div className="grid gap-5 md:grid-cols-2">
                    <dl className="grid content-start gap-2 rounded-lg border border-line-soft bg-surface/40 p-4 text-sm">
                      <SummaryRow label={`${typeMeta!.name}${typeMeta!.unit === "day" ? `, ${days} days` : ""}`} value={money(cost).usd} />
                      {vatRate ? <SummaryRow label={`VAT (${formatPercent(vatRate, 1)}, ${countries[brand.country].name})`} value={formatMoney(vat, "USD")} /> : null}
                      <div className="my-1 h-px bg-line-soft" />
                      <SummaryRow label="Total" value={formatMoney(cost + vat, "USD")} strong />
                      {brand.currency !== "USD" ? <p className="text-right text-xs text-ink-3 tabular">About {usdAndLocal(cost + vat, brand.currency).local}</p> : null}
                    </dl>
                    <div className="grid content-start gap-3">
                      <ChoiceGroup id="cw-method" label="Payment method" value={w.payMethod} onValueChange={(v) => set("payMethod", v as W["payMethod"])}>
                        <ChoiceCard value="card" disabled={paid} className="flex-row items-center gap-3 p-3">
                          <CreditCard className="size-4 text-ink-2" />
                          <span className="min-w-0 flex-1 text-sm text-ink">Sample card ending 4242</span>
                          <ChoiceTick on={w.payMethod === "card"} />
                        </ChoiceCard>
                        <ChoiceCard value="balance" disabled={paid} className="flex-row items-center gap-3 p-3">
                          <Landmark className="size-4 text-ink-2" />
                          <span className="min-w-0 flex-1 text-sm text-ink">Deduct from your next payout <span className="text-ink-3">(simulated)</span></span>
                          <ChoiceTick on={w.payMethod === "balance"} />
                        </ChoiceCard>
                      </ChoiceGroup>
                      {paid ? (
                        <p role="status" className="flex items-center gap-2 rounded-md border border-line bg-elevated p-3 text-sm text-ink">
                          <Check className="size-4 shrink-0 text-violet" /> <span>Marked as paid (simulated), reference <span className="whitespace-nowrap tabular">{w.payRef}</span></span>
                        </p>
                      ) : (
                        <Button id="cw-pay" type="button" variant="primary" onClick={pay} aria-describedby={errors.pay ? "cw-pay-error" : undefined}>
                          <Lock /> Simulate paying {formatMoney(cost + vat, "USD")}
                        </Button>
                      )}
                      {!paid && w.paidAmount !== null ? <p className="text-xs text-ink-2">The total changed after the simulated payment of {formatMoney(w.paidAmount, "USD")}. Simulate paying the new total to continue.</p> : null}
                      {errors.pay ? <p id="cw-pay-error" className="text-xs text-danger">{errors.pay}</p> : null}
                      <p className="text-xs text-ink-3">Once payments are connected: a full refund if the campaign is rejected, or if you cancel at least 72 hours before it starts.</p>
                    </div>
                  </div>
                </Panel>
              ) : null}

              {step === 8 && w.type ? (
                <>
                  <Panel title="9. Submit for review" description="Every campaign is checked by a person before it runs.">
                    <div className="grid gap-5 md:grid-cols-2">
                      <div className="grid content-start gap-3 text-sm">
                        <p className="text-ink">The platform team reviews it in the Admin Control Center, usually within 1 business day; campaigns that start within 48 hours go first. If it&apos;s rejected, you&apos;ll see the reason.</p>
                        <ul className="grid gap-2 text-ink-2">
                          {["No third-party logos or trademarks in your images or copy.", "Clear pricing: the price shown matches the product page, with no hidden costs.", "The Sponsored label is always shown and can't be hidden or restyled.", "Links stay on NOCTURNE, and promoted products are published and in stock."].map((r) => (
                            <li key={r} className="flex gap-2">
                              <Check className="mt-0.5 size-4 shrink-0 text-violet" />
                              <span>{r}</span>
                            </li>
                          ))}
                        </ul>
                        <label className="mt-1 flex items-start gap-3 rounded-md border border-line p-3">
                          <Checkbox id="cw-agreed" className="mt-0.5" checked={w.agreed} aria-invalid={errors.agreed ? true : undefined} aria-describedby={errors.agreed ? "cw-agreed-error" : undefined} onCheckedChange={(c) => set("agreed", !!c)} />
                          <span className="text-sm text-ink">I confirm this campaign follows the advertising rules.</span>
                        </label>
                        {errors.agreed ? <p id="cw-agreed-error" className="-mt-1 text-xs text-danger">{errors.agreed}</p> : null}
                      </div>
                      <dl className="grid content-start gap-2 rounded-lg border border-line-soft bg-surface/40 p-4 text-xs">
                        <SummaryRow label="Campaign" value={w.name.trim()} />
                        <SummaryRow label="Type" value={typeMeta!.name} />
                        <SummaryRow label="Promoting" value={target?.name ?? brand.name} />
                        <SummaryRow label="Placements" value={w.placements.map((p) => placementMeta[p].label).join(", ")} />
                        <SummaryRow label="Categories" value={w.categories.length ? w.categories.map((c) => categories.find((x) => x.slug === c)?.name ?? c).join(", ") : "All"} />
                        <SummaryRow label="Markets" value={w.countries.length ? w.countries.map((c) => countries[c as keyof typeof countries].name).join(", ") : "All markets"} />
                        <SummaryRow label="Dates" value={`${formatDate(w.startDate)} to ${formatDate(endDate)}`} />
                        <SummaryRow label="Paid" value={`${usdAndLocalText(cost + vat, brand.currency)}, simulated`} />
                      </dl>
                    </div>
                  </Panel>
                  <p className="text-xs text-ink-3">After you submit, step 10 is the campaign&apos;s results page, where you can follow the review and, once it runs, its numbers.</p>
                </>
              ) : null}
            </motion.div>
          </AnimatePresence>
          {/* Phones: a floating action bar, so Continue is always in reach. */}
          <div className="glass-strong sticky bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-20 mt-6 flex items-center gap-2 rounded-2xl p-2 lg:static lg:rounded-none lg:border-x-0 lg:border-b-0 lg:border-line-soft lg:bg-transparent lg:p-0 lg:pt-4 lg:shadow-none lg:backdrop-filter-none">
            <Button type="button" variant="secondary" size="sm" onClick={() => go(step - 1)} disabled={step === 0} aria-label="Previous step">
              <ArrowLeft /> <span className="hidden sm:inline">Back</span>
            </Button>
            <p className="hidden min-w-0 flex-1 truncate px-2 text-xs text-ink-3 sm:block">
              Step {step + 1} of {STEPS.length}
              {typeMeta ? <span className="tabular">, {money(cost).usd} so far</span> : null}
            </p>
            <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={saveDraft} disabled={leaving}>
              Save draft
            </Button>
            <Button type="button" variant={step === 7 && !paid ? "secondary" : "primary"} size="sm" className="flex-1 sm:flex-none" onClick={next} disabled={leaving}>
              {step === LAST_INTERACTIVE ? "Submit for review" : "Continue"}
              {step === LAST_INTERACTIVE ? null : <ArrowRight />}
            </Button>
          </div>
        </div>
      </div>
      {guard.dialog}
    </div>
  )
}

function SummaryRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-ink-3">{label}</dt>
      <dd className={cn("text-right tabular", strong ? "font-medium text-ink" : "text-ink")}>{value}</dd>
    </div>
  )
}

function TargetList({ id, label, value, onChange, items, error, empty }: { id: string; label: string; value: string | null; onChange: (id: string) => void; items: { id: string; title: string; meta: string; image: string; disabled?: boolean }[]; error?: string; empty?: string }) {
  if (!items.length) return <p className="rounded-md border border-dashed border-line p-6 text-center text-sm text-ink-2">{empty ?? "Nothing to choose yet."}</p>
  return (
    <ChoiceGroup id={id} label={label} value={value} onValueChange={onChange} error={error} className="grid-cols-1 sm:grid-cols-2">
      {items.map((it) => (
        <ChoiceCard key={it.id} value={it.id} disabled={it.disabled} className="flex-row items-center gap-3 p-2.5">
          <span className="relative size-12 shrink-0 overflow-hidden rounded-md bg-surface">
            <Image src={it.image} alt="" fill sizes="48px" className="object-cover" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm text-ink">{it.title}</span>
            <span className="block truncate text-xs text-ink-3">{it.meta}</span>
          </span>
          <ChoiceTick on={value === it.id} />
        </ChoiceCard>
      ))}
    </ChoiceGroup>
  )
}
