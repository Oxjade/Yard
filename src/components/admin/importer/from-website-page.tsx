"use client"

import { useEffect, useId, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { ArrowSquareOutIcon, CaretLeftIcon, CheckCircleIcon, CircleNotchIcon, GlobeIcon, ImageSquareIcon, StorefrontIcon, WarningIcon, WhatsappLogoIcon, XCircleIcon } from "@phosphor-icons/react"
import { AdminImg, LoadError, TrustGate, useAdminSession } from "@/components/admin/trust/shared"
import { ActionErrorNote, actionError, type ActionError } from "@/components/admin/finance/reauth"
import { ClaimSection, Field, describedBy, useHandleCheck } from "@/components/admin/marketplace/founding-detail"
import { useSearchParam, writeParams } from "@/components/admin/marketplace/url-state"
import { PageHeader } from "@/components/dashboard/page-header"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { ListSkeleton } from "@/components/feedback/skeletons"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { countries, countryCodes, currencies, currencyCodes, type CountryCode, type CurrencyCode } from "@/config/markets"
import type { FoundingBrandRow } from "@/lib/api/contracts/founding"
import { foundingCreateBody } from "@/lib/api/contracts/founding"
import { DUPLICATE_LABELS } from "@/lib/from-website"
import type { WebsiteCreateBody, WebsiteDuplicateDto, WebsiteScanDto, WebsiteSuggestionDto } from "@/lib/api/contracts/from-website"
import { IMPORT_PLATFORM_LABELS } from "@/lib/api/contracts/imports"
import { fieldErrors } from "@/lib/api/errors"
import { actionKey, createStoreFromWebsite, foundingKeys, getWebsiteScan, startWebsiteScan, websiteScanKey } from "@/lib/api/founding"
import { revalidatePrefix, useApi } from "@/lib/api/use-api"
import { choiceOf, draftOf, draftProblems, withCurrency, type ImportDraft } from "@/lib/importer"
import { formatMoney } from "@/lib/money"
import { cn } from "@/lib/utils"
import { ProductRow, ResultRow, ScanProgress, Steps, hostOf } from "./import-page"

/*
 * Admin › Brands › Founding › Create brand from website (docs/IMPORTER.md › Create brand from
 * website). "Paste, check, send" on one page: 1 paste the brand's site and confirm they agreed,
 * Scan (the importer's own background scan); 2 one review screen: the brand card with Yard's best
 * guesses, the products, three switches; 3 Create store (the founding brand, the import as
 * Suggestions from Yard, the storefront draft, watching), with progress; 4 the summary with the
 * claim link (the tray's own claim composer and its re-auth). ?import=<id> keeps the job in the
 * URL, so a reload resumes it.
 */

const STEPS = ["Scan", "Review", "Create", "Send"] as const
const fieldClass = "h-10 rounded-md border-white/10 bg-white/[0.02] text-[13px]"
const selectClass = "h-10 w-full rounded-md border-white/10 bg-white/[0.02] text-[13px] data-[size=default]:h-10"
const panel = "rounded-lg border border-white/[0.07] bg-white/[0.015]"
const FOUNDING_LIST = "/admin/brands?tab=founding"

export function FromWebsiteRoute() {
  return (
    <TrustGate feature="Create brand from website" anyOf={["brands.founding"]}>
      <FromWebsite />
    </TrustGate>
  )
}

function FromWebsite() {
  const importId = useSearchParam("import")
  const session = useAdminSession()
  return (
    <div className="grid gap-6 pb-6">
      <div className="grid gap-2">
        <Link href={FOUNDING_LIST} className="inline-flex w-fit items-center gap-1 text-xs text-ink-2 hover:text-ink">
          <CaretLeftIcon className="size-3.5" aria-hidden /> Founding brands
        </Link>
        <PageHeader title="Create brand from website" description="Paste their site, check what Yard found, then send the claim link. Yard builds the store from their own shop: products, logo, banner and intro." />
      </div>
      {!session.can("catalog.propose") ? (
        <p role="alert" className={cn("max-w-2xl px-4 py-3 text-[13px] text-ink-2", panel)}>
          Creating a store from a website also needs permission to suggest products to brands.
        </p>
      ) : importId ? (
        <WebsiteJob key={importId} id={importId} />
      ) : (
        <ScanStep />
      )}
    </div>
  )
}

/* ---------- 1. paste and scan ---------- */

function ScanStep() {
  const id = useId()
  const [url, setUrl] = useState("")
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<ActionError | null>(null)
  const [errors, setErrors] = useState<{ url?: string; consent?: string }>({})

  async function scan(e: React.FormEvent) {
    e.preventDefault()
    const next: typeof errors = {}
    if (url.trim().length < 4) next.url = "Paste the brand's website address."
    if (!consent) next.consent = "Confirm the brand agreed before Yard builds their store from their website."
    setErrors(next)
    if (Object.keys(next).length) {
      document.getElementById(next.url ? `${id}-url` : `${id}-consent`)?.focus()
      return
    }
    setBusy(true)
    setFailure(null)
    try {
      const r = await startWebsiteScan({ url: url.trim(), consent: true })
      writeParams({ import: r.import.id })
    } catch (cause) {
      const fields = fieldErrors(cause)
      if (fields.url) setErrors({ url: fields.url })
      else setFailure(actionError(cause, "The scan couldn't start. Try again."))
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-6">
      <Steps at={0} steps={STEPS} />
      <form onSubmit={(e) => void scan(e)} className={cn("grid max-w-2xl gap-4 p-4 sm:p-5", panel)} noValidate>
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-url`} className="text-[12px] text-ink-2">
            The brand&apos;s website
          </Label>
          <Input id={`${id}-url`} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://kachistudio.labeld.app" inputMode="url" autoComplete="off" spellCheck={false} maxLength={2000} aria-invalid={!!errors.url} aria-describedby={`${id}-url-hint${errors.url ? ` ${id}-url-error` : ""}`} className={fieldClass} />
          <p id={`${id}-url-hint`} className="text-[11.5px] text-ink-3">
            Their shop&apos;s home page. Shopify, WooCommerce and Labeld shops are read directly; other sites through their product pages.
          </p>
          {errors.url ? (
            <p id={`${id}-url-error`} role="alert" className="text-xs text-danger">
              {errors.url}
            </p>
          ) : null}
        </div>
        <div className="grid gap-1.5">
          <label htmlFor={`${id}-consent`} className="flex cursor-pointer items-start gap-2.5 text-[13px] text-ink">
            <Checkbox id={`${id}-consent`} checked={consent} onCheckedChange={(v) => setConsent(v === true)} aria-invalid={!!errors.consent} aria-describedby={errors.consent ? `${id}-consent-error` : undefined} className="mt-0.5" />
            <span>This brand agreed to us building their Yard store from their website</span>
          </label>
          {errors.consent ? (
            <p id={`${id}-consent-error`} role="alert" className="text-xs text-danger">
              {errors.consent}
            </p>
          ) : null}
        </div>
        <ActionErrorNote error={failure} onReload={() => window.location.reload()} />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" className="h-11 w-full sm:h-10 sm:w-fit" loading={busy} disabled={busy}>
            <GlobeIcon aria-hidden /> Scan website
          </Button>
          <span className="text-[12px] text-ink-3">Nothing is created until you press Create store.</span>
        </div>
      </form>
    </div>
  )
}

/* ---------- the job: progress, review, create, summary ---------- */

function WebsiteJob({ id }: { id: string }) {
  const q = useApi(websiteScanKey(id), () => getWebsiteScan(id), { revalidateOnFocus: true, keepPrevious: false })
  const dto = q.data
  const imp = dto?.import
  const live = imp?.status === "scanning" || imp?.status === "importing" || !!dto?.created?.watch?.checking
  const revalidate = q.revalidate
  useEffect(() => {
    if (!live) return
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") void revalidate()
    }, 1500)
    return () => window.clearInterval(t)
  }, [live, revalidate])

  if (q.error && !dto) return <LoadError error={q.error} onRetry={() => void q.revalidate()} what="this scan" />
  if (!dto || !imp) return <ListSkeleton rows={5} />
  const newScan = () => writeParams({ import: null })
  if (dto.created) return <Created dto={dto} created={dto.created} onChange={(next) => q.mutate(next)} />
  if (imp.status === "scanning") return <ScanProgress imp={imp} steps={STEPS} />
  if (imp.status === "failed" || !dto.suggestion)
    return (
      <div className="grid gap-5">
        <Steps at={0} steps={STEPS} />
        <div role="alert" className={cn("grid max-w-2xl gap-3 p-4", panel)}>
          <p className="flex items-center gap-2 text-[14px] text-ink">
            <XCircleIcon className="size-4 text-danger" aria-hidden /> The scan of {hostOf(imp.sourceUrl)} failed
          </p>
          <p className="text-[13px] text-ink-2">{imp.error}</p>
          <Button type="button" variant="secondary" size="sm" className="h-10 w-fit sm:h-9" onClick={newScan}>
            Try another address
          </Button>
        </div>
      </div>
    )
  return <Review dto={dto} suggestion={dto.suggestion} onCreated={(next) => q.mutate(next)} onNewScan={newScan} />
}

/* ---------- 2. review ---------- */

type BrandFields = { name: string; handle: string; category: string; city: string; country: CountryCode | ""; currency: string; story: string; instagram: string; tiktok: string }

const keyStore = (importId: string) => `yard.fromWebsite.key.${importId}`
/** One request key per Create store on this scan, kept across a reload so a retry replays instead of creating twice. */
function useCreateKey(importId: string) {
  const [key] = useState(() => {
    try {
      const saved = window.sessionStorage.getItem(keyStore(importId))
      if (saved && /^[A-Za-z0-9_-]{8,80}$/.test(saved)) return saved
      const k = actionKey()
      window.sessionStorage.setItem(keyStore(importId), k)
      return k
    } catch {
      return actionKey()
    }
  })
  return key
}

function Review({ dto, suggestion: s, onCreated, onNewScan }: { dto: WebsiteScanDto; suggestion: WebsiteSuggestionDto; onCreated: (next: WebsiteScanDto) => void; onNewScan: () => void }) {
  const id = useId()
  const imp = dto.import
  const key = useCreateKey(imp.id)
  const [f, setF] = useState<BrandFields>(() => ({
    name: s.name,
    handle: s.handle,
    category: s.category ?? "",
    city: s.city,
    country: (s.country as CountryCode | null) ?? "",
    currency: s.currency ?? "",
    story: s.story,
    instagram: s.instagram ?? "",
    tiktok: s.tiktok ?? "",
  }))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [logo, setLogo] = useState<string | null>(s.logo)
  const [banner, setBanner] = useState<string | null>(s.banner)
  const [toggles, setToggles] = useState({ goLiveOnClaim: true, watch: true, foundingBadge: true })
  const brandCtx = { currency: f.currency || s.currency || "NGN", name: f.name.trim() || "This brand", category: f.category || null }
  const [drafts, setDrafts] = useState<Record<string, ImportDraft>>(() => Object.fromEntries(imp.found.map((p) => [p.key, withCurrency(draftOf(p, brandCtx, imp.categories), brandCtx.currency)])))
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<ActionError | null>(null)
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({})
  // After a request that may have created the brand, its card stays as sent (a retry replays the same key).
  const [sentOnce, setSentOnce] = useState(false)
  const handleCheck = useHandleCheck(f.handle)
  const handleKept = f.handle === s.handle && s.handleAvailable

  function set<K extends keyof BrandFields>(k: K, v: BrandFields[K]) {
    setF((cur) => {
      const next = { ...cur, [k]: v }
      if (k === "country" && v && !cur.currency) next.currency = countries[v as CountryCode].currency
      return next
    })
    setErrors((cur) => {
      const next = { ...cur }
      delete next[k]
      return next
    })
    // The products are priced in the brand's currency: switching it converts every price (and says so).
    if (k === "currency" && v) setDrafts((all) => Object.fromEntries(Object.entries(all).map(([kk, d]) => [kk, withCurrency(d, String(v))])))
  }

  const products = imp.found
  const ticked = products.filter((p) => drafts[p.key]?.on)
  const problems = Object.fromEntries(ticked.map((p) => [p.key, draftProblems(drafts[p.key], brandCtx)]))
  const blocked = ticked.filter((p) => Object.keys(problems[p.key]).length)
  const all = products.length > 0 && ticked.length === products.length
  const some = ticked.length > 0 && !all

  function validate() {
    const parsed = foundingCreateBody.safeParse({
      name: f.name.trim(),
      handle: f.handle,
      category: f.category,
      city: f.city.trim(),
      country: f.country,
      currency: f.currency,
      story: f.story.trim() || undefined,
      instagram: f.instagram.trim() || null,
      tiktok: f.tiktok.trim() || null,
      idempotencyKey: key,
    })
    const next: Record<string, string> = {}
    if (!parsed.success) for (const issue of parsed.error.issues) next[String(issue.path[0] ?? "form")] ??= issue.message
    if (!f.category) next.category = "Choose one of Yard's categories."
    if (!f.country) next.country = "Choose one of Yard's markets."
    if (!f.currency) next.currency = "Choose one of Yard's currencies."
    if (handleCheck?.state === "taken" && handleCheck.message && !sentOnce) next.handle = handleCheck.message
    return { body: parsed.success ? parsed.data : null, errors: next }
  }

  async function create() {
    if (busy) return
    const v = validate()
    if (Object.keys(v.errors).length || !v.body) {
      setErrors(v.errors)
      document.getElementById(`${id}-${Object.keys(v.errors)[0]}`)?.focus()
      setFailure({ message: "Check the brand's details first.", conflict: false })
      return
    }
    if (blocked.length) {
      document.getElementById(`${id}-p-${products.indexOf(blocked[0])}`)?.scrollIntoView({ behavior: "smooth", block: "center" })
      setFailure({ message: `${blocked.length === 1 ? "One ticked product needs" : `${blocked.length} ticked products need`} a fix first.`, conflict: false })
      return
    }
    setBusy(true)
    setFailure(null)
    setServerErrors({})
    const body: WebsiteCreateBody = { brand: v.body, logoUrl: logo, bannerUrl: banner, products: ticked.map((p) => choiceOf(p, drafts[p.key])), ...toggles }
    try {
      const r = await createStoreFromWebsite(imp.id, body)
      revalidatePrefix(foundingKeys.list)
      revalidatePrefix("admin.proposals")
      toast.success(`${r.created?.brand.name ?? v.body.name} created`, { description: ticked.length ? "Copying the photos into Yard now. You can stay on this page." : undefined })
      onCreated(r)
    } catch (cause) {
      const fields = fieldErrors(cause)
      const byKey: Record<string, string> = {}
      const brandFields: Record<string, string> = {}
      for (const [k, msg] of Object.entries(fields)) {
        const m = /^products\.(\d+)\./.exec(k)
        if (m && ticked[Number(m[1])]) byKey[ticked[Number(m[1])].key] = msg
        else brandFields[k.replace(/^brand\./, "")] = msg
      }
      setServerErrors(byKey)
      setErrors(brandFields)
      // No field to fix: the brand may exist already, so its card stays as sent and a retry finishes the job.
      if (!Object.keys(fields).length) setSentOnce(true)
      setFailure(actionError(cause, "The store couldn't be created. Try again: nothing is created twice."))
    } finally {
      setBusy(false)
    }
  }

  const handleHint = f.handle.length < 3 ? "Lowercase letters, numbers and hyphens." : handleKept ? `Available: /brands/${f.handle}` : !handleCheck || handleCheck.state === "checking" ? "Checking…" : handleCheck.state === "available" ? `Available: /brands/${f.handle}` : handleCheck.message
  const handleError = errors.handle ?? (handleCheck?.state === "taken" && !sentOnce ? handleCheck.message : undefined)
  const locked = busy || sentOnce
  const cats = imp.categories
  const summary = [ticked.length ? `${ticked.length} ${ticked.length === 1 ? "product" : "products"}` : "no products", logo ? "logo" : null, banner ? "banner" : null, toggles.goLiveOnClaim ? "goes live when they claim" : "stays hidden after the claim"].filter(Boolean).join(", ")

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <Steps at={1} steps={STEPS} />
      <div className={cn("flex flex-wrap items-center justify-between gap-3 px-4 py-3", panel)}>
        <p className="min-w-0 text-[13px] text-ink-2">
          <span className="text-ink">{imp.platform ? IMPORT_PLATFORM_LABELS[imp.platform] : "Website"}</span> · {hostOf(imp.sourceUrl)} · <span className="tabular">{imp.found.length}</span> {imp.found.length === 1 ? "product" : "products"} found
        </p>
        <Button type="button" size="sm" variant="secondary" className="h-9" onClick={onNewScan} disabled={locked}>
          New scan
        </Button>
      </div>

      {dto.duplicates.length ? <Duplicates list={dto.duplicates} /> : null}

      <section aria-labelledby={`${id}-brand`} className={cn("grid gap-5 p-4 sm:p-5", panel)}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id={`${id}-brand`} className="text-[15px] font-medium text-ink">
            The brand
          </h2>
          <p className="text-[11.5px] text-ink-3">Yard&apos;s best guesses from the site. Change anything.</p>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
          <Field id={`${id}-name`} label="Brand name" error={errors.name}>
            <Input id={`${id}-name`} value={f.name} maxLength={40} disabled={locked} onChange={(e) => set("name", e.target.value)} aria-invalid={!!errors.name} aria-describedby={describedBy(`${id}-name`, errors.name)} className={fieldClass} autoComplete="off" />
          </Field>
          <Field id={`${id}-handle`} label="Handle" error={handleError} hint={handleHint}>
            <div className="relative">
              <span aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[13px] text-ink-3">
                @
              </span>
              <Input id={`${id}-handle`} value={f.handle} maxLength={30} disabled={locked} onChange={(e) => set("handle", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} aria-invalid={!!handleError} aria-describedby={describedBy(`${id}-handle`, handleError, handleHint)} className={cn(fieldClass, "pl-7")} autoComplete="off" spellCheck={false} />
            </div>
          </Field>
          <Field id={`${id}-category`} label="Category" error={errors.category}>
            <Select value={f.category} onValueChange={(v) => set("category", v)} disabled={locked}>
              <SelectTrigger id={`${id}-category`} aria-invalid={!!errors.category} aria-describedby={describedBy(`${id}-category`, errors.category)} className={selectClass}>
                <SelectValue placeholder="Choose a category" />
              </SelectTrigger>
              <SelectContent>
                {cats.map((c) => (
                  <SelectItem key={c.slug} value={c.slug}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field id={`${id}-city`} label="City" error={errors.city} hint={s.location ? `The site says: ${s.location}` : "The site doesn't say."}>
            <Input id={`${id}-city`} value={f.city} maxLength={80} disabled={locked} onChange={(e) => set("city", e.target.value)} aria-invalid={!!errors.city} aria-describedby={describedBy(`${id}-city`, errors.city, true)} className={fieldClass} autoComplete="off" />
          </Field>
          <Field id={`${id}-country`} label="Country" error={errors.country} hint={s.why.length ? s.why.join(". ") : undefined}>
            <Select value={f.country} onValueChange={(v) => set("country", v as CountryCode)} disabled={locked}>
              <SelectTrigger id={`${id}-country`} aria-invalid={!!errors.country} aria-describedby={describedBy(`${id}-country`, errors.country, s.why.length)} className={selectClass}>
                <SelectValue placeholder="Choose a country" />
              </SelectTrigger>
              <SelectContent>
                {countryCodes.map((c) => (
                  <SelectItem key={c} value={c}>
                    {countries[c].name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field id={`${id}-currency`} label="Currency" error={errors.currency} hint="Prices and payouts. Changing it converts the product prices at Yard's reference rate.">
            <Select value={f.currency} onValueChange={(v) => set("currency", v)} disabled={locked}>
              <SelectTrigger id={`${id}-currency`} aria-invalid={!!errors.currency} aria-describedby={describedBy(`${id}-currency`, errors.currency, true)} className={selectClass}>
                <SelectValue placeholder="Choose a currency" />
              </SelectTrigger>
              <SelectContent>
                {currencyCodes.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <ImageChoice id={`${id}-logo`} label="Logo" images={s.images} value={logo} onChange={setLogo} disabled={locked} siteValue={s.logo} />
          <ImageChoice id={`${id}-banner`} label="Banner" wide images={s.images} value={banner} onChange={setBanner} disabled={locked} siteValue={s.banner} />
          <Field id={`${id}-story`} label="Bio" error={errors.story} hint={`${f.story.length}/2000. The storefront intro starts from it.`} className="sm:col-span-2">
            <Textarea id={`${id}-story`} value={f.story} maxLength={2000} rows={3} disabled={locked} onChange={(e) => set("story", e.target.value)} aria-invalid={!!errors.story} aria-describedby={describedBy(`${id}-story`, errors.story, true)} className="min-h-20 rounded-md border-white/10 bg-white/[0.02] text-[13px]" />
          </Field>
          <Field id={`${id}-instagram`} label="Instagram" error={errors.instagram} hint="Handle only, without @">
            <Input id={`${id}-instagram`} value={f.instagram} maxLength={31} disabled={locked} onChange={(e) => set("instagram", e.target.value)} aria-invalid={!!errors.instagram} aria-describedby={describedBy(`${id}-instagram`, errors.instagram, true)} className={fieldClass} autoComplete="off" spellCheck={false} />
          </Field>
          <Field id={`${id}-tiktok`} label="TikTok" error={errors.tiktok} hint="Handle only, without @">
            <Input id={`${id}-tiktok`} value={f.tiktok} maxLength={25} disabled={locked} onChange={(e) => set("tiktok", e.target.value)} aria-invalid={!!errors.tiktok} aria-describedby={describedBy(`${id}-tiktok`, errors.tiktok, true)} className={fieldClass} autoComplete="off" spellCheck={false} />
          </Field>
        </div>
      </section>

      <section aria-labelledby={`${id}-products`} className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id={`${id}-products`} className="text-[15px] font-medium text-ink">
            Products
          </h2>
          {products.length ? (
            <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-2">
              <Checkbox checked={all ? true : some ? "indeterminate" : false} disabled={locked} onCheckedChange={(v) => setDrafts((d) => Object.fromEntries(Object.entries(d).map(([k, x]) => [k, { ...x, on: v === true }])))} aria-label="Select all products" />
              <span>
                Select all · <span className="tabular">{ticked.length}</span> of <span className="tabular">{products.length}</span> ticked
              </span>
            </label>
          ) : null}
        </div>
        {!products.length ? (
          <p className={cn("px-4 py-6 text-center text-[13px] text-ink-2", panel)}>This scan found no products. The store can still be created with its logo, banner and intro, or try another address.</p>
        ) : (
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-3">
            {products.map((p, i) => (
              <ProductRow key={p.key} idBase={`${id}-p-${i}`} p={p} d={drafts[p.key]} brand={brandCtx} categories={cats} problems={drafts[p.key].on ? problems[p.key] : {}} serverError={serverErrors[p.key]} onChange={(patch) => setDrafts((d) => ({ ...d, [p.key]: typeof patch === "function" ? patch(d[p.key]) : { ...d[p.key], ...patch } }))} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby={`${id}-switches`} className={cn("grid gap-1 p-2 sm:p-3", panel)}>
        <h2 id={`${id}-switches`} className="sr-only">
          Settings
        </h2>
        <Toggle id={`${id}-golive`} label="Go live when they claim" hint="Publishes the storefront and accepts these products the moment the owner claims." checked={toggles.goLiveOnClaim} disabled={locked} onChange={(v) => setToggles((t) => ({ ...t, goLiveOnClaim: v }))} />
        <Toggle id={`${id}-watch`} label="Keep watching their website for new pieces" hint={`Checks ${hostOf(imp.sourceUrl)} every few hours; new pieces wait for approval.`} checked={toggles.watch} disabled={locked} onChange={(v) => setToggles((t) => ({ ...t, watch: v }))} />
        <Toggle id={`${id}-badge`} label="Show Founding brand badge" hint="On its storefront, product pages and brand cards." checked={toggles.foundingBadge} disabled={locked} onChange={(v) => setToggles((t) => ({ ...t, foundingBadge: v }))} />
      </section>

      <div className="sticky bottom-3 z-20 rounded-lg border border-line-soft bg-obsidian/95 px-4 py-3 shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.8)] backdrop-blur">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 text-[12px] text-ink-3">
            <ActionErrorNote error={failure} onReload={() => window.location.reload()} />
            {!failure ? <span>{f.name.trim() || "The store"}: {summary}.</span> : null}
          </div>
          <Button type="button" variant="primary" className="h-11 w-full shrink-0 sm:h-10 sm:w-fit" loading={busy} disabled={busy} onClick={() => void create()}>
            <StorefrontIcon aria-hidden /> {sentOnce ? "Finish creating the store" : "Create store"}
          </Button>
        </div>
      </div>
    </div>
  )
}

function Toggle({ id, label, hint, checked, disabled, onChange }: { id: string; label: string; hint: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md px-2 py-2.5">
      <Label htmlFor={id} className="grid min-w-0 gap-0.5 text-[13px] leading-snug font-normal text-ink-2">
        <span className="text-ink">{label}</span>
        <span className="text-[11.5px] text-ink-3">{hint}</span>
      </Label>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  )
}

function Duplicates({ list }: { list: WebsiteDuplicateDto[] }) {
  return (
    <section role="alert" className="grid gap-2 rounded-lg border border-acid/30 bg-acid/[0.04] p-4">
      <p className="flex items-center gap-2 text-[13.5px] text-ink">
        <WarningIcon className="size-4 shrink-0 text-acid" aria-hidden /> {list.length === 1 ? "Yard may already have this brand" : "Yard may already have this brand: check these first"}
      </p>
      <ul className="grid gap-1.5">
        {list.map((b) => (
          <li key={b.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[12.5px]">
            <span className="min-w-0 text-ink-2">
              <span className="text-ink">{b.name}</span> @{b.handle} · {b.founding ? (b.claimed ? "founding brand, claimed" : "founding brand") : "brand"} · {b.reasons.map((r) => DUPLICATE_LABELS[r]).join(", ")}
            </span>
            <Link href={b.href} className="inline-flex items-center gap-1 text-violet underline-offset-4 hover:underline">
              Open {b.name} <ArrowSquareOutIcon className="size-3" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** The logo or banner, chosen from the site's images (or none). Nothing is stored until Create store. */
function ImageChoice({ id, label, images, value, onChange, disabled, wide, siteValue }: { id: string; label: string; images: string[]; value: string | null; onChange: (v: string | null) => void; disabled?: boolean; wide?: boolean; siteValue: string | null }) {
  return (
    <fieldset className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-1.5">
      <legend className="mb-1.5 text-[12px] text-ink-2">{label}</legend>
      <div className="flex min-w-0 items-center gap-3">
        <span className={cn("relative shrink-0 overflow-hidden rounded-md border border-white/10 bg-white/[0.03]", wide ? "h-14 w-32" : "size-14")}>
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element -- the site's own image, previewed; copied into Yard on Create store
            <img src={value} alt="" referrerPolicy="no-referrer" className="size-full object-cover" />
          ) : (
            <ImageSquareIcon className="absolute inset-0 m-auto size-4 text-ink-3" aria-hidden />
          )}
        </span>
        <p className="min-w-0 text-[11.5px] text-ink-3">{value ? (value === siteValue ? `The site's ${label.toLowerCase()}` : "Chosen from the site") : `No ${label.toLowerCase()}`}</p>
      </div>
      {images.length ? (
        <div role="radiogroup" aria-label={`${label}: the site's images`} className="-mx-1 flex gap-1.5 overflow-x-auto px-1 py-1">
          <button type="button" role="radio" aria-checked={!value} disabled={disabled} onClick={() => onChange(null)} className={cn("flex shrink-0 items-center justify-center rounded-md border text-[10.5px] text-ink-3 outline-none focus-visible:ring-2 focus-visible:ring-violet disabled:opacity-50", wide ? "h-10 w-16" : "size-10", !value ? "border-violet" : "border-white/10")}>
            None
          </button>
          {images.map((src, i) => (
            <button key={src} id={i === 0 ? id : undefined} type="button" role="radio" aria-checked={value === src} aria-label={`${label}: image ${i + 1}`} disabled={disabled} onClick={() => onChange(src)} className={cn("shrink-0 overflow-hidden rounded-md border-2 outline-none focus-visible:ring-2 focus-visible:ring-violet disabled:opacity-50", wide ? "h-10 w-16" : "size-10", value === src ? "border-violet" : "border-transparent")}>
              {/* eslint-disable-next-line @next/next/no-img-element -- the site's own image, previewed */}
              <img src={src} alt="" referrerPolicy="no-referrer" loading="lazy" className="size-full object-cover" />
            </button>
          ))}
        </div>
      ) : (
        <p className="text-[11.5px] text-ink-3">The site has no images to choose from. Add one later from the founding tray.</p>
      )}
    </fieldset>
  )
}

/* ---------- 3. creating, then 4. the summary and claim link ---------- */

function Created({ dto, created, onChange }: { dto: WebsiteScanDto; created: NonNullable<WebsiteScanDto["created"]>; onChange: (next: WebsiteScanDto) => void }) {
  const id = useId()
  const imp = dto.import
  const b = created.brand
  const running = imp.status === "importing"
  const items = imp.items.filter((i) => i.status !== "skipped" || i.reason !== "Not ticked.")
  const made = imp.items.filter((i) => i.status === "created")
  const failed = imp.items.filter((i) => i.status === "failed")
  const profileWaiting = !!imp.profile && !imp.profile.applied
  const [link, setLink] = useState<{ url: string; email: string } | null>(null)
  const firstPaint = useRef(running)
  // Leaving the progress view moves focus to the summary for screen readers and keyboards.
  const headline = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (!running && firstPaint.current) headline.current?.focus()
  }, [running])
  const brandSaved = (next: FoundingBrandRow) => onChange({ ...dto, created: { ...created, brand: next } })

  if (running || profileWaiting) {
    return (
      <div className="grid gap-5">
        <Steps at={2} steps={STEPS} />
        <div className={cn("grid gap-3 p-4 sm:p-5", panel)} aria-live="polite" aria-busy="true">
          <p className="flex items-center gap-2 text-[14px] text-ink">
            <CircleNotchIcon className="size-4 animate-spin text-violet motion-reduce:animate-none" aria-hidden /> Creating {b.name}
          </p>
          <ol className="grid gap-1.5 text-[12.5px]">
            <Progress done label={`Founding brand @${b.handle} created`} />
            <Progress done={!profileWaiting} label={imp.profile?.logo || imp.profile?.banner ? "Logo and banner into the storefront draft" : "Storefront draft"} />
            <Progress done={!running} label={`Products: ${made.length} of ${items.length} copied into Yard`} note={running ? imp.progress.note : null} />
            <Progress done={!created.watch || !!created.watch.enabled} label={created.watch ? `Watching ${hostOf(created.watch.sourceUrl)}` : "Website watching off"} />
          </ol>
          <p className="text-[11.5px] text-ink-3">You can leave this page; Yard carries on. This link brings you back.</p>
        </div>
        {items.length ? (
          <ul className="grid gap-1.5">
            {items.map((it) => (
              <ResultRow key={it.key} it={it} p={imp.found.find((p) => p.key === it.key)} />
            ))}
          </ul>
        ) : null}
      </div>
    )
  }

  const parts = [`${made.length} ${made.length === 1 ? "product" : "products"}`, b.logo ? "logo" : null, b.banner ? "banner" : null, b.goLiveOnClaim ? "goes live when they claim" : "stays hidden after the claim"].filter(Boolean)
  const currency = (b.currency in currencies ? b.currency : "NGN") as CurrencyCode
  const shareText = link ? `Your Yard store for ${b.name} is ready. Claim it here (the link works once, for ${link.email}): ${link.url}` : ""
  return (
    <div className="grid gap-5">
      <Steps at={3} steps={STEPS} />
      <section aria-labelledby={`${id}-ready`} className={cn("grid gap-3 p-4 sm:p-5", panel)}>
        <h2 id={`${id}-ready`} ref={headline} tabIndex={-1} className="flex items-start gap-2 text-[16px] font-medium text-ink outline-none">
          <CheckCircleIcon className="mt-0.5 size-5 shrink-0 text-violet" aria-hidden />
          <span>
            {b.name} is ready: {parts.join(", ")}
          </span>
        </h2>
        <ul className="flex flex-wrap gap-1.5">
          <li>
            <StatusBadge tone="info">Unclaimed</StatusBadge>
          </li>
          {created.watch?.enabled ? (
            <li>
              <StatusBadge tone="neutral">Watching {hostOf(created.watch.sourceUrl)}</StatusBadge>
            </li>
          ) : null}
          {b.foundingBadge ? (
            <li>
              <StatusBadge tone="neutral">Founding badge on</StatusBadge>
            </li>
          ) : null}
          {failed.length ? (
            <li>
              <StatusBadge tone="danger">{failed.length} not imported</StatusBadge>
            </li>
          ) : null}
        </ul>
        {imp.profile?.error ? <p className="text-[12px] text-danger">Storefront draft: {imp.profile.error}</p> : null}
        {failed.length ? <p className="text-[12px] text-ink-2">{failed.map((f) => `${f.title}: ${f.reason ?? "failed"}`).join(" · ")}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="secondary" size="sm" className="h-10 sm:h-9">
            <Link href={created.trayHref}>Open the founding tray</Link>
          </Button>
          <Button asChild variant="ghost" size="sm" className="h-10 sm:h-9">
            <Link href={`/admin/products/suggestions?brand=${encodeURIComponent(b.id)}&status=all`}>Suggestions from Yard</Link>
          </Button>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-start">
        <section aria-labelledby={`${id}-preview`} className="grid min-w-0 gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id={`${id}-preview`} className="text-[15px] font-medium text-ink">
              What {b.name} will see
            </h2>
            {link ? (
              <a href={link.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12px] text-violet underline-offset-4 hover:underline">
                Open their claim page <ArrowSquareOutIcon className="size-3" aria-hidden />
              </a>
            ) : (
              <span className="text-[11.5px] text-ink-3">Their claim page opens from the link you send</span>
            )}
          </div>
          <ShopPreview brand={b} items={made} currency={currency} />
        </section>

        <section aria-label="Send the claim link" className={cn("grid min-w-0 gap-3 p-4 sm:p-5", panel)}>
          <ClaimSection brand={b} onSaved={brandSaved} onIssued={setLink} />
          {link ? (
            <a href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 w-fit items-center gap-2 rounded-md border border-white/10 px-3 text-[12.5px] text-ink-2 hover:text-ink sm:h-9">
              <WhatsappLogoIcon className="size-4" aria-hidden /> Send it on WhatsApp
            </a>
          ) : null}
        </section>
      </div>
    </div>
  )
}

function Progress({ done, label, note }: { done: boolean; label: string; note?: string | null }) {
  return (
    <li className="flex items-start gap-2">
      {done ? <CheckCircleIcon className="mt-0.5 size-4 shrink-0 text-violet" aria-hidden /> : <CircleNotchIcon className="mt-0.5 size-4 shrink-0 animate-spin text-ink-3 motion-reduce:animate-none" aria-hidden />}
      <span className={done ? "text-ink-2" : "text-ink"}>
        {label}
        {note ? <span className="block text-[11.5px] text-ink-3">{note}</span> : null}
        <span className="sr-only">{done ? ", done" : ", in progress"}</span>
      </span>
    </li>
  )
}

/** The shop as it opens when they claim: banner, logo, name, intro and the products (Yard's copies). */
function ShopPreview({ brand: b, items, currency }: { brand: FoundingBrandRow; items: WebsiteScanDto["import"]["items"]; currency: CurrencyCode }) {
  const intro = useMemo(() => (b.story ?? "").trim(), [b.story])
  return (
    <div className="overflow-hidden rounded-lg border border-white/[0.07] bg-obsidian">
      <div className="relative aspect-[3/1] w-full bg-white/[0.03]">{b.banner ? <AdminImg src={b.banner.src} alt={`${b.name} banner`} className="size-full" /> : null}</div>
      <div className="grid gap-3 p-4">
        <div className="relative -mt-10 flex items-end gap-3">
          {b.logo ? <AdminImg src={b.logo.src} alt={`${b.name} logo`} className="size-16 shrink-0 rounded-md border-2 border-obsidian" /> : <span className="size-16 shrink-0 rounded-md border-2 border-obsidian bg-white/[0.06]" aria-hidden />}
          <div className="min-w-0 pb-1">
            <p className="truncate text-[15px] font-medium text-ink">{b.name}</p>
            <p className="truncate text-[11.5px] text-ink-3">
              @{b.handle} · {b.city}, {countries[b.country as CountryCode]?.name ?? b.country}
              {b.foundingBadge ? " · Founding brand" : ""}
            </p>
          </div>
        </div>
        {intro ? <p className="line-clamp-3 text-[12.5px] text-ink-2">{intro}</p> : null}
        {items.length ? (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
            {items.map((it) => (
              <li key={it.key} className="grid min-w-0 gap-1">
                <AdminImg src={it.cover} alt={it.title} className="aspect-[4/5] w-full rounded-md" />
                <span className="truncate text-[12px] text-ink">{it.title}</span>
                {it.price && it.price.currency in currencies ? <span className="text-[11.5px] text-ink-2 tabular">{formatMoney(it.price.minor, it.price.currency as CurrencyCode)}</span> : <span className="text-[11.5px] text-ink-3">{currency}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12px] text-ink-3">No products yet.</p>
        )}
      </div>
    </div>
  )
}
