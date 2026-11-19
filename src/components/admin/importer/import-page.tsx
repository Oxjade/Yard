"use client"

import { useEffect, useId, useMemo, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { ArrowSquareOutIcon, CaretLeftIcon, CheckCircleIcon, CircleNotchIcon, ClockIcon, GlobeIcon, WarningIcon, XCircleIcon } from "@phosphor-icons/react"
import { LoadError, TrustGate } from "@/components/admin/trust/shared"
import { ActionErrorNote, actionError, type ActionError } from "@/components/admin/finance/reauth"
import { useSearchParam, writeParams } from "@/components/admin/marketplace/url-state"
import { PageHeader } from "@/components/dashboard/page-header"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { ListSkeleton } from "@/components/feedback/skeletons"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { currencies, currencyCodes, type CurrencyCode } from "@/config/markets"
import { IMPORT_PLATFORM_LABELS, ONE_SIZE, type ImportBrandContextDto, type ImportDetailDto, type ImportItemDto, type ImportItemStatus, type ImportProductDto, type ImportSummaryDto } from "@/lib/api/contracts/imports"
import { brandImportKey, brandImportsKey, getBrandImport, listBrandImports, runBrandImport, startBrandImportScan } from "@/lib/api/imports"
import { revalidatePrefix, useApi } from "@/lib/api/use-api"
import { choiceOf, draftOf, draftProblems, sizesEditable, stockLabels, withCurrency, type ImportDraft } from "@/lib/importer"
import { formatMoney } from "@/lib/money"
import { cn } from "@/lib/utils"

/*
 * Admin › Brands › {brand} › Import from website (docs/IMPORTER.md). A dedicated page, as a
 * multi-step job: 1 paste the brand's shop address and confirm the brand agreed, then Scan (it
 * runs in the background; progress polls); 2 review: tick, edit and categorise the products the
 * scan found, and choose whether the site's logo, banner and description fill the storefront
 * draft; 3 import: Yard copies the photos into its own media and sends each product to the brand
 * as a Suggestion from Yard, with a result per product. ?import=<id> keeps the job in the URL, so
 * a reload or a later visit resumes it.
 */

const fieldClass = "h-10 rounded-md border-white/10 bg-white/[0.02] text-[13px]"
const selectClass = "h-10 w-full rounded-md border-white/10 bg-white/[0.02] text-[13px] data-[size=default]:h-10"
const panel = "rounded-lg border border-white/[0.07] bg-white/[0.015]"

export function ImportFromWebsiteRoute({ brandId }: { brandId: string }) {
  return (
    <TrustGate feature="Import from website" anyOf={["catalog.propose"]}>
      <ImportFromWebsite key={brandId} brandId={brandId} />
    </TrustGate>
  )
}

function backHref(brand: ImportBrandContextDto | undefined, from: string | null) {
  if (from && /^\/admin\/brands(\?|$)/.test(from)) return from
  if (brand?.founding) return `/admin/brands?tab=founding&brand=${encodeURIComponent(brand.id)}`
  return "/admin/brands"
}

function ImportFromWebsite({ brandId }: { brandId: string }) {
  const importId = useSearchParam("import")
  const from = useSearchParam("from")
  const list = useApi(brandImportsKey(brandId), () => listBrandImports(brandId), { revalidateOnFocus: false })
  const brand = list.data?.brand
  if (list.error && !list.data) return <LoadError error={list.error} onRetry={() => void list.revalidate()} what="this brand" />
  return (
    <div className="grid gap-6 pb-6">
      <div className="grid gap-2">
        <Link href={backHref(brand, from)} className="inline-flex w-fit items-center gap-1 text-xs text-ink-2 hover:text-ink">
          <CaretLeftIcon className="size-3.5" aria-hidden /> {brand ? brand.name : "Brands"}
        </Link>
        <PageHeader title="Import from website" description={brand ? `Copy ${brand.name}'s products from their own shop into Suggestions from Yard. Photos are copied into Yard; nothing goes live until ${brand.claimStatus === "unclaimed" ? (brand.goLiveOnClaim ? "they claim the brand" : "they claim and accept") : "they accept"}.` : undefined} />
      </div>
      {!brand ? <ListSkeleton rows={4} /> : importId ? <ImportJob key={importId} id={importId} brand={brand} /> : <ScanStep brand={brand} recent={list.data?.imports ?? []} />}
    </div>
  )
}

/* ---------- steps ---------- */

const STEPS = ["Scan", "Review", "Import"] as const

function Steps({ at }: { at: 0 | 1 | 2 }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px]" aria-label="Steps">
      {STEPS.map((s, i) => (
        <li key={s} className={cn("flex items-center gap-2", i === at ? "text-ink" : i < at ? "text-ink-2" : "text-ink-3")} aria-current={i === at ? "step" : undefined}>
          <span className={cn("inline-flex size-5 items-center justify-center rounded-full border text-[11px] tabular", i === at ? "border-acid bg-acid text-obsidian" : i < at ? "border-white/20 text-ink-2" : "border-white/10")}>{i < at ? "✓" : i + 1}</span>
          {s}
        </li>
      ))}
    </ol>
  )
}

/* ---------- step 1: scan ---------- */

function ScanStep({ brand, recent }: { brand: ImportBrandContextDto; recent: ImportSummaryDto[] }) {
  const id = useId()
  const [url, setUrl] = useState("")
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<ActionError | null>(null)
  const [errors, setErrors] = useState<{ url?: string; consent?: string }>({})
  const running = recent.find((r) => r.status === "scanning" || r.status === "importing")

  async function scan(e: React.FormEvent) {
    e.preventDefault()
    const next: typeof errors = {}
    if (url.trim().length < 4) next.url = "Paste the brand's website address."
    if (!consent) next.consent = "Confirm the brand agreed before Yard copies their products."
    setErrors(next)
    if (Object.keys(next).length) {
      document.getElementById(next.url ? `${id}-url` : `${id}-consent`)?.focus()
      return
    }
    setBusy(true)
    setFailure(null)
    try {
      const r = await startBrandImportScan({ brandId: brand.id, url: url.trim(), consent: true })
      revalidatePrefix(brandImportsKey(brand.id))
      writeParams({ import: r.import.id })
    } catch (cause) {
      const f = actionError(cause, "The scan couldn't start. Try again.")
      const fields = (cause as { fields?: Record<string, string> }).fields
      if (fields?.url) setErrors({ url: fields.url })
      else setFailure(f)
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-6">
      <Steps at={0} />
      <form onSubmit={(e) => void scan(e)} className={cn("grid max-w-2xl gap-4 p-4 sm:p-5", panel)} noValidate>
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-url`} className="text-[12px] text-ink-2">
            {brand.name}&apos;s website
          </Label>
          <Input id={`${id}-url`} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://brand.com" inputMode="url" autoComplete="off" spellCheck={false} maxLength={2000} aria-invalid={!!errors.url} aria-describedby={`${id}-url-hint${errors.url ? ` ${id}-url-error` : ""}`} className={fieldClass} />
          <p id={`${id}-url-hint`} className="text-[11.5px] text-ink-3">
            The shop&apos;s home page. Tracking bits like ?utm_source are removed. Shopify, WooCommerce and Labeld shops are read directly; other sites through their product pages.
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
            <span>This brand agreed to us importing their products</span>
          </label>
          {errors.consent ? (
            <p id={`${id}-consent-error`} role="alert" className="text-xs text-danger">
              {errors.consent}
            </p>
          ) : null}
        </div>
        <ActionErrorNote error={failure} onReload={() => window.location.reload()} />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" className="h-11 w-full sm:h-10 sm:w-fit" loading={busy} disabled={busy || !!running}>
            <GlobeIcon aria-hidden /> Scan website
          </Button>
          {running ? (
            <span className="text-[12px] text-ink-3">
              An import is still running.{" "}
              <button type="button" className="text-violet underline-offset-4 hover:underline" onClick={() => writeParams({ import: running.id })}>
                Open it
              </button>
            </span>
          ) : (
            <span className="text-[12px] text-ink-3">Reads up to 200 products, politely: a few pages a second.</span>
          )}
        </div>
      </form>
      {recent.length ? (
        <section className="grid max-w-2xl gap-2" aria-labelledby={`${id}-recent`}>
          <h2 id={`${id}-recent`} className="text-[13px] font-medium text-ink">
            Earlier imports
          </h2>
          <ul className="grid gap-1.5">
            {recent.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => writeParams({ import: r.id })} className={cn("flex min-h-12 w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-white/[0.03] focus-visible:outline-2 focus-visible:outline-violet", panel)}>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] text-ink">{hostOf(r.sourceUrl)}</span>
                    <span className="block truncate text-[11.5px] text-ink-3">
                      {new Date(r.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {r.platform ? IMPORT_PLATFORM_LABELS[r.platform] : "Detecting"} · {r.products} found · {r.counts.created} created
                    </span>
                  </span>
                  <ImportStatusBadge status={r.status} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "")
  } catch {
    return u
  }
}

function ImportStatusBadge({ status }: { status: ImportSummaryDto["status"] }) {
  const meta: Record<ImportSummaryDto["status"], { label: string; tone: "info" | "attention" | "success" | "danger" | "muted" }> = {
    scanning: { label: "Scanning", tone: "info" },
    scanned: { label: "Ready to review", tone: "attention" },
    importing: { label: "Importing", tone: "info" },
    done: { label: "Done", tone: "success" },
    failed: { label: "Failed", tone: "danger" },
  }
  return <StatusBadge tone={meta[status].tone}>{meta[status].label}</StatusBadge>
}

/* ---------- an import: progress, review, results ---------- */

function ImportJob({ id, brand }: { id: string; brand: ImportBrandContextDto }) {
  const q = useApi(brandImportKey(id), () => getBrandImport(id), { revalidateOnFocus: true, keepPrevious: false })
  const imp = q.data?.import
  const live = imp?.status === "scanning" || imp?.status === "importing"
  const revalidate = q.revalidate
  // Poll while the job runs (the runner writes progress about once a second).
  useEffect(() => {
    if (!live) return
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") void revalidate()
    }, 1500)
    return () => window.clearInterval(t)
  }, [live, revalidate])
  // Reviewing again after a finished import ("Import more").
  const [reviewAgain, setReviewAgain] = useState(false)
  if (q.error && !imp) return <LoadError error={q.error} onRetry={() => void q.revalidate()} what="this import" />
  if (!imp) return <ListSkeleton rows={5} />
  const newScan = () => {
    revalidatePrefix(brandImportsKey(brand.id))
    writeParams({ import: null })
  }
  if (imp.status === "scanning") return <ScanProgress imp={imp} />
  if (imp.status === "failed" && !imp.items.length)
    return (
      <div className="grid gap-5">
        <Steps at={0} />
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
  if (imp.status === "scanned" || (imp.status === "done" && reviewAgain))
    return (
      <Review
        imp={imp}
        brand={imp.context}
        onStarted={(next) => {
          q.mutate({ import: next })
          setReviewAgain(false)
        }}
        onNewScan={newScan}
      />
    )
  return <Results imp={imp} onMore={() => setReviewAgain(true)} onNewScan={newScan} />
}

const PHASES: Record<ImportDetailDto["progress"]["phase"], string> = { start: "Starting", detect: "Reading the home page", listing: "Finding the products", products: "Reading product pages", images: "Copying photos", done: "Finishing" }

function ScanProgress({ imp }: { imp: ImportDetailDto }) {
  const p = imp.progress
  return (
    <div className="grid gap-5">
      <Steps at={0} />
      <div className={cn("grid max-w-2xl gap-3 p-4 sm:p-5", panel)} aria-live="polite" aria-busy="true">
        <p className="flex items-center gap-2 text-[14px] text-ink">
          <CircleNotchIcon className="size-4 animate-spin text-violet motion-reduce:animate-none" aria-hidden /> Scanning {hostOf(imp.sourceUrl)}
        </p>
        <p className="text-[13px] text-ink-2">
          {PHASES[p.phase] ?? "Working"}
          {p.note ? `: ${p.note}` : ""}
        </p>
        <dl className="grid grid-cols-3 gap-3 text-[12px]">
          <div>
            <dt className="text-ink-3">Pages read</dt>
            <dd className="text-[18px] text-ink tabular">{p.pagesFetched}</dd>
          </div>
          <div>
            <dt className="text-ink-3">Product pages</dt>
            <dd className="text-[18px] text-ink tabular">{p.productPages || "–"}</dd>
          </div>
          <div>
            <dt className="text-ink-3">Products found</dt>
            <dd className="text-[18px] text-ink tabular">{p.productsFound}</dd>
          </div>
        </dl>
        <p className="text-[11.5px] text-ink-3">You can leave this page; the scan carries on and this link brings you back to it.</p>
      </div>
    </div>
  )
}

/* ---------- step 2: review ---------- */

type Cat = ImportDetailDto["categories"][number]
const catValue = (slug: string, sub: string | null) => (sub ? `${slug}::${sub}` : slug)

function Review({ imp, brand, onStarted, onNewScan }: { imp: ImportDetailDto; brand: ImportBrandContextDto; onStarted: (i: ImportDetailDto) => void; onNewScan: () => void }) {
  const id = useId()
  const created = useMemo(() => new Set(imp.items.filter((i) => i.status === "created").map((i) => i.key)), [imp.items])
  const products = useMemo(() => imp.found.filter((p) => !created.has(p.key)), [imp.found, created])
  const [drafts, setDrafts] = useState<Record<string, ImportDraft>>(() => Object.fromEntries(imp.found.map((p) => [p.key, draftOf(p, brand, imp.categories)])))
  const site = imp.brand
  const canProfile = brand.canUseSiteProfile && !!site && !imp.profile?.applied
  const [profile, setProfile] = useState(() => ({
    logo: canProfile && !!site?.logo && !brand.has.logo,
    banner: canProfile && !!site?.banner && !brand.has.banner,
    description: canProfile && !!site?.description && !brand.has.story,
    socials: canProfile && !!(site?.socials.instagram || site?.socials.tiktok) && !brand.has.instagram && !brand.has.tiktok,
  }))
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<ActionError | null>(null)
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({})
  const [showWarnings, setShowWarnings] = useState(false)
  const set = (key: string, patch: Partial<ImportDraft> | ((d: ImportDraft) => ImportDraft)) => setDrafts((all) => ({ ...all, [key]: typeof patch === "function" ? patch(all[key]) : { ...all[key], ...patch } }))

  const ticked = products.filter((p) => drafts[p.key]?.on)
  const problems = Object.fromEntries(ticked.map((p) => [p.key, draftProblems(drafts[p.key], brand)]))
  const blocked = ticked.filter((p) => Object.keys(problems[p.key]).length)
  const all = products.length > 0 && ticked.length === products.length
  const some = ticked.length > 0 && !all
  const wantsProfile = profile.logo || profile.banner || profile.description || profile.socials

  async function start() {
    if (blocked.length) {
      document.getElementById(`${id}-p-${products.indexOf(blocked[0])}`)?.scrollIntoView({ behavior: "smooth", block: "center" })
      setFailure({ message: `${blocked.length === 1 ? "One ticked product needs" : `${blocked.length} ticked products need`} a fix first.`, conflict: false })
      return
    }
    setBusy(true)
    setFailure(null)
    setServerErrors({})
    try {
      const r = await runBrandImport(imp.id, { products: ticked.map((p) => choiceOf(p, drafts[p.key])), ...(canProfile ? { profile } : {}) })
      revalidatePrefix(brandImportsKey(brand.id))
      revalidatePrefix("admin.proposals")
      toast.success(ticked.length ? `Importing ${ticked.length} ${ticked.length === 1 ? "product" : "products"}` : "Updating the storefront draft", { description: "Photos are copied into Yard first. You can leave this page." })
      onStarted(r.import)
    } catch (cause) {
      const fields = (cause as { fields?: Record<string, string> }).fields ?? {}
      const byKey: Record<string, string> = {}
      for (const [f, msg] of Object.entries(fields)) {
        const m = /^products\.(\d+)\./.exec(f)
        if (m && ticked[Number(m[1])]) byKey[ticked[Number(m[1])].key] = msg
      }
      setServerErrors(byKey)
      setFailure(actionError(cause, "The import couldn't start. Try again."))
    } finally {
      setBusy(false)
    }
  }

  const dupes = products.filter((p) => p.duplicate).length
  return (
    <div className="grid gap-5">
      <Steps at={1} />
      <div className={cn("flex flex-wrap items-center justify-between gap-3 px-4 py-3", panel)}>
        <p className="text-[13px] text-ink-2">
          <span className="text-ink">{imp.platform ? IMPORT_PLATFORM_LABELS[imp.platform] : "Website"}</span> · {hostOf(imp.sourceUrl)} · <span className="tabular">{imp.found.length}</span> {imp.found.length === 1 ? "product" : "products"} found
          {created.size ? <> · <span className="tabular">{created.size}</span> already imported</> : null}
          {dupes ? <> · <span className="tabular">{dupes}</span> look like duplicates</> : null}
        </p>
        <div className="flex items-center gap-2">
          {imp.warnings.length ? (
            <Button type="button" size="sm" variant="ghost" className="h-9" aria-expanded={showWarnings} onClick={() => setShowWarnings((v) => !v)}>
              <WarningIcon aria-hidden /> {imp.warnings.length} {imp.warnings.length === 1 ? "note" : "notes"}
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="secondary" className="h-9" onClick={onNewScan}>
            New scan
          </Button>
        </div>
        {showWarnings ? (
          <ul className="grid w-full gap-1 text-[12px] text-ink-2">
            {imp.warnings.map((w) => (
              <li key={w} className="break-words">
                {w}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {site ? <SiteProfile site={site} brand={brand} canProfile={canProfile} applied={!!imp.profile?.applied} profile={profile} setProfile={setProfile} /> : null}

      <section aria-labelledby={`${id}-products`} className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id={`${id}-products`} className="text-[15px] font-medium text-ink">
            Products
          </h2>
          {products.length ? (
            <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-2">
              <Checkbox checked={all ? true : some ? "indeterminate" : false} onCheckedChange={(v) => setDrafts((d) => Object.fromEntries(Object.entries(d).map(([k, x]) => [k, { ...x, on: v === true && products.some((p) => p.key === k) }])))} aria-label="Select all products" />
              <span>
                Select all · <span className="tabular">{ticked.length}</span> of <span className="tabular">{products.length}</span> ticked
              </span>
            </label>
          ) : null}
        </div>
        {!products.length ? (
          <p className={cn("px-4 py-6 text-center text-[13px] text-ink-2", panel)}>{imp.found.length ? "Every product from this scan is already imported." : "This scan found no products. Try the shop's home page, or another address."}</p>
        ) : (
          <ul className="grid gap-3">
            {products.map((p, i) => (
              <ProductRow key={p.key} idBase={`${id}-p-${i}`} p={p} d={drafts[p.key]} brand={brand} categories={imp.categories} problems={drafts[p.key].on ? problems[p.key] : {}} serverError={serverErrors[p.key]} onChange={(patch) => set(p.key, patch)} />
            ))}
          </ul>
        )}
      </section>

      <div className="sticky bottom-3 z-20 rounded-lg border border-line-soft bg-obsidian/95 px-4 py-3 shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.8)] backdrop-blur">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 text-[12px] text-ink-3">
            <ActionErrorNote error={failure} onReload={() => window.location.reload()} />
            {!failure ? (
              <span>
                {brand.claimStatus === "unclaimed" ? (brand.goLiveOnClaim ? `Each becomes a suggestion that goes live the moment ${brand.name} is claimed.` : `Each becomes a suggestion the owner accepts after claiming.`) : `Each becomes a suggestion ${brand.name} accepts before it goes live.`}
              </span>
            ) : null}
          </div>
          <Button type="button" variant="primary" className="h-11 w-full shrink-0 sm:h-10 sm:w-fit" loading={busy} disabled={busy || (!ticked.length && !wantsProfile)} onClick={() => void start()}>
            {ticked.length ? `Import ${ticked.length} ${ticked.length === 1 ? "product" : "products"}` : wantsProfile ? "Update storefront draft" : "Import"}
          </Button>
        </div>
      </div>
    </div>
  )
}

function SiteProfile({ site, brand, canProfile, applied, profile, setProfile }: { site: NonNullable<ImportDetailDto["brand"]>; brand: ImportBrandContextDto; canProfile: boolean; applied: boolean; profile: { logo: boolean; banner: boolean; description: boolean; socials: boolean }; setProfile: (p: { logo: boolean; banner: boolean; description: boolean; socials: boolean }) => void }) {
  const id = useId()
  const socials = [site.socials.instagram ? `Instagram @${site.socials.instagram}` : null, site.socials.tiktok ? `TikTok @${site.socials.tiktok}` : null].filter(Boolean).join(" · ")
  const opt = (key: keyof typeof profile, label: string, has: boolean, available: boolean) =>
    available ? (
      <label className="flex cursor-pointer items-start gap-2 text-[12.5px] text-ink-2">
        <Checkbox checked={profile[key]} disabled={!canProfile} onCheckedChange={(v) => setProfile({ ...profile, [key]: v === true })} className="mt-0.5" />
        <span>
          {label}
          {has ? <span className="text-ink-3"> (replaces the current one)</span> : null}
        </span>
      </label>
    ) : null
  return (
    <section aria-labelledby={`${id}-site`} className={cn("grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]", panel)}>
      <div className="flex min-w-0 gap-3">
        {site.logo ? (
          // eslint-disable-next-line @next/next/no-img-element -- a preview of the brand's own site; nothing is stored until import
          <img src={site.logo} alt="" referrerPolicy="no-referrer" className="size-14 shrink-0 rounded-md border border-white/10 object-cover" />
        ) : (
          <span className="size-14 shrink-0 rounded-md border border-dashed border-white/10" aria-hidden />
        )}
        <div className="min-w-0">
          <h2 id={`${id}-site`} className="truncate text-[14px] text-ink">
            {site.name ?? "The site"}
          </h2>
          {site.description ? <p className="mt-0.5 line-clamp-3 text-[12.5px] text-ink-2">{site.description}</p> : null}
          {socials ? <p className="mt-1 text-[11.5px] text-ink-3">{socials}</p> : null}
        </div>
      </div>
      <div className="grid content-start gap-2">
        {site.banner ? (
          // eslint-disable-next-line @next/next/no-img-element -- see above
          <img src={site.banner} alt="" referrerPolicy="no-referrer" className="aspect-[3/1] w-full rounded-md border border-white/10 object-cover" />
        ) : null}
        {applied ? (
          <p className="flex items-center gap-1.5 text-[12px] text-ink-2">
            <CheckCircleIcon className="size-4 text-violet" aria-hidden /> Used for the storefront draft.
          </p>
        ) : canProfile ? (
          <fieldset className="grid gap-1.5">
            <legend className="mb-1 text-[12px] text-ink-3">Use for {brand.name}&apos;s storefront draft</legend>
            {opt("logo", "Logo", brand.has.logo, !!site.logo)}
            {opt("banner", "Banner", brand.has.banner, !!site.banner)}
            {opt("description", "Description as the intro", brand.has.story, !!site.description)}
            {opt("socials", "Instagram and TikTok handles", brand.has.instagram || brand.has.tiktok, !!(site.socials.instagram || site.socials.tiktok))}
          </fieldset>
        ) : (
          <p className="text-[11.5px] text-ink-3">{brand.claimStatus === "claimed" ? `${brand.name} manages its own storefront.` : "Only Yard owners fill in a founding brand's storefront."}</p>
        )}
      </div>
    </section>
  )
}

function ProductRow({ idBase, p, d, brand, categories, problems, serverError, onChange }: { idBase: string; p: ImportProductDto; d: ImportDraft; brand: ImportBrandContextDto; categories: Cat[]; problems: ReturnType<typeof draftProblems>; serverError?: string; onChange: (patch: Partial<ImportDraft> | ((d: ImportDraft) => ImportDraft)) => void }) {
  const labels = stockLabels(p, d)
  const editableSizes = sizesEditable(p)
  const currencyOptions = useMemo(() => [...new Set([d.currency, brand.currency, ...currencyCodes])].filter((c) => c in currencies) as CurrencyCode[], [d.currency, brand.currency])
  const sitePrice = p.priceMinor != null && p.currency && p.currency in currencies ? formatMoney(p.priceMinor, p.currency as CurrencyCode) : null
  const err = (k: keyof typeof problems) => problems[k]
  const describe = (k: string, has: boolean) => (has ? `${idBase}-${k}-error` : undefined)
  return (
    <li id={idBase} className={cn("grid gap-3 p-3 sm:p-4", panel, d.on ? "" : "opacity-[0.72]")}>
      <div className="flex items-start gap-3">
        <Checkbox checked={d.on} onCheckedChange={(v) => onChange({ on: v === true })} aria-label={`Import ${d.title || p.title}`} className="mt-1" />
        <div className="relative shrink-0">
          {p.images[0] ? (
            // eslint-disable-next-line @next/next/no-img-element -- a preview of the source photo; it's copied into Yard on import
            <img src={p.images[0]} alt="" referrerPolicy="no-referrer" loading="lazy" className="size-16 rounded-md border border-white/10 object-cover sm:size-20" />
          ) : (
            <span className="flex size-16 items-center justify-center rounded-md border border-dashed border-white/10 text-[10px] text-ink-3 sm:size-20">No photo</span>
          )}
          {p.images.length > 1 ? <span className="absolute right-1 bottom-1 rounded bg-obsidian/85 px-1 text-[10px] text-ink tabular">{p.images.length}</span> : null}
        </div>
        <div className="grid min-w-0 flex-1 gap-1">
          <div className="flex flex-wrap items-center gap-2">
            {p.duplicate ? <StatusBadge tone="attention">Possible duplicate</StatusBadge> : null}
            {p.availability === "out_of_stock" ? <StatusBadge tone="muted">Sold out on the site</StatusBadge> : null}
            <a href={p.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full min-w-0 items-center gap-1 text-[11.5px] text-ink-3 hover:text-ink">
              <span className="truncate">{hostOf(p.sourceUrl)}{new URL(p.sourceUrl).pathname}</span>
              <ArrowSquareOutIcon className="size-3 shrink-0" aria-hidden />
              <span className="sr-only">(opens the source page)</span>
            </a>
          </div>
          {p.duplicate ? <p className="text-[12px] text-acid">{p.duplicate.reason} Tick it to import anyway.</p> : null}
          {sitePrice ? <p className="text-[11.5px] text-ink-3">On the site: {sitePrice}</p> : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1.6fr)]">
        <div className="col-span-2 grid min-w-0 content-start gap-1 sm:col-span-1">
          <Label htmlFor={`${idBase}-title`} className="text-[11.5px] text-ink-3">
            Title
          </Label>
          <Input id={`${idBase}-title`} value={d.title} maxLength={120} onChange={(e) => onChange({ title: e.target.value })} aria-invalid={!!err("title")} aria-describedby={describe("title", !!err("title"))} className={fieldClass} />
          {err("title") ? <FieldError id={`${idBase}-title-error`}>{err("title")}</FieldError> : null}
        </div>
        <div className="grid min-w-0 content-start gap-1">
          <Label htmlFor={`${idBase}-price`} className="text-[11.5px] text-ink-3">
            Price ({d.currency})
          </Label>
          <Input id={`${idBase}-price`} value={d.price} inputMode="decimal" onChange={(e) => onChange({ price: e.target.value.replace(/[^\d.]/g, ""), convertedFrom: null })} aria-invalid={!!err("price")} aria-describedby={describe("price", !!err("price"))} className={cn(fieldClass, "tabular")} />
          {err("price") ? <FieldError id={`${idBase}-price-error`}>{err("price")}</FieldError> : d.convertedFrom ? <p className="text-[11px] text-ink-3">Converted from {d.convertedFrom} at Yard&apos;s reference rate. Check it.</p> : null}
        </div>
        <div className="grid min-w-0 content-start gap-1">
          <Label htmlFor={`${idBase}-currency`} className="text-[11.5px] text-ink-3">
            Currency
          </Label>
          <Select value={d.currency} onValueChange={(v) => onChange((x) => withCurrency(x, v))}>
            <SelectTrigger id={`${idBase}-currency`} aria-invalid={!!err("currency")} aria-describedby={describe("currency", !!err("currency"))} className={selectClass}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {currencyOptions.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {err("currency") ? <FieldError id={`${idBase}-currency-error`}>{err("currency")}</FieldError> : null}
        </div>
        <div className="col-span-2 grid min-w-0 content-start gap-1 sm:col-span-1">
          <Label htmlFor={`${idBase}-category`} className="text-[11.5px] text-ink-3">
            Category
          </Label>
          <Select value={catValue(d.categorySlug, d.subcategory)} onValueChange={(v) => onChange({ categorySlug: v.split("::")[0], subcategory: v.split("::")[1] ?? null })}>
            <SelectTrigger id={`${idBase}-category`} aria-invalid={!!err("categorySlug")} className={selectClass}>
              <SelectValue placeholder="Choose a category" />
            </SelectTrigger>
            <SelectContent>
              {categories.map((c) => (
                <SelectGroup key={c.slug}>
                  <SelectLabel>{c.name}</SelectLabel>
                  <SelectItem value={c.slug}>{c.name}, any</SelectItem>
                  {c.subcategories.map((s) => (
                    <SelectItem key={s} value={catValue(c.slug, s)}>
                      {c.name} › {s}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        {editableSizes ? (
          <div className="grid min-w-0 content-start gap-1">
            <Label htmlFor={`${idBase}-sizes`} className="text-[11.5px] text-ink-3">
              Sizes
            </Label>
            <Input id={`${idBase}-sizes`} value={d.sizes} placeholder={ONE_SIZE} onChange={(e) => onChange({ sizes: e.target.value })} aria-describedby={`${idBase}-sizes-hint`} className={fieldClass} />
            <p id={`${idBase}-sizes-hint`} className="text-[11px] text-ink-3">
              Comma-separated. Empty means one size.
            </p>
          </div>
        ) : (
          <div className="grid min-w-0 content-start gap-1">
            <p className="text-[11.5px] text-ink-3">Options</p>
            <p className="text-[12.5px] text-ink-2">{p.options.map((o) => `${o.name}: ${o.values.map((v) => v.value).join(", ")}`).join(" · ")}</p>
          </div>
        )}
        <fieldset className="grid min-w-0 content-start gap-1">
          <legend className="mb-1 text-[11.5px] text-ink-3">Stock</legend>
          <div className="flex flex-wrap gap-1.5">
            {labels.map((l) => (
              <label key={l} className="flex h-9 items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.02] pr-1 pl-2 text-[12px] text-ink-2">
                <span className="max-w-[9rem] truncate">{l}</span>
                <input
                  value={d.stock[l] ?? ""}
                  inputMode="numeric"
                  placeholder="0"
                  aria-label={`Stock, ${l}`}
                  onChange={(e) => onChange((x) => ({ ...x, stock: { ...x.stock, [l]: e.target.value.replace(/\D/g, "").slice(0, 7) } }))}
                  className="h-7 w-12 rounded border border-white/10 bg-transparent px-1.5 text-right text-[12.5px] text-ink tabular outline-none focus-visible:border-violet"
                />
              </label>
            ))}
          </div>
          {err("stock") ? <FieldError id={`${idBase}-stock-error`}>{err("stock")}</FieldError> : null}
        </fieldset>
      </div>

      {p.warnings.length || serverError ? (
        <ul className="grid gap-0.5 text-[11.5px]">
          {serverError ? (
            <li role="alert" className="text-danger">
              {serverError}
            </li>
          ) : null}
          {p.warnings.map((w) => (
            <li key={w} className="flex items-start gap-1.5 text-ink-3">
              <WarningIcon className="mt-0.5 size-3 shrink-0 text-acid/80" aria-hidden />
              <span>{w}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}

function FieldError({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} role="alert" className="text-[11.5px] break-words text-danger">
      {children}
    </p>
  )
}

/* ---------- step 3: results ---------- */

const ITEM_META: Record<ImportItemStatus, { label: string; tone: "info" | "success" | "muted" | "danger"; icon: React.ComponentType<{ className?: string }> }> = {
  queued: { label: "Waiting", tone: "info", icon: ClockIcon },
  created: { label: "Created", tone: "success", icon: CheckCircleIcon },
  skipped: { label: "Skipped", tone: "muted", icon: CircleNotchIcon },
  failed: { label: "Failed", tone: "danger", icon: XCircleIcon },
}

const PROPOSAL_LABEL: Record<string, string> = { pending: "waiting for the brand", accepted: "accepted", declined: "declined", withdrawn: "withdrawn", superseded: "updated" }

function Results({ imp, onMore, onNewScan }: { imp: ImportDetailDto; onMore: () => void; onNewScan: () => void }) {
  const id = useId()
  const running = imp.status === "importing"
  const shown = imp.items.filter((i) => i.status !== "skipped" || i.reason !== "Not ticked.")
  const notTicked = imp.items.length - shown.length
  const remaining = imp.found.length - imp.items.filter((i) => i.status === "created").length
  const brand = imp.context
  return (
    <div className="grid gap-5">
      <Steps at={2} />
      <div className={cn("grid gap-3 p-4 sm:p-5", panel)} aria-live="polite" aria-busy={running}>
        <p className="flex items-center gap-2 text-[14px] text-ink">
          {running ? <CircleNotchIcon className="size-4 animate-spin text-violet motion-reduce:animate-none" aria-hidden /> : imp.status === "failed" ? <XCircleIcon className="size-4 text-danger" aria-hidden /> : <CheckCircleIcon className="size-4 text-violet" aria-hidden />}
          {running ? `Importing from ${hostOf(imp.sourceUrl)}` : imp.status === "failed" ? "The import stopped" : `Import from ${hostOf(imp.sourceUrl)} finished`}
        </p>
        {running && imp.progress.note ? <p className="text-[12.5px] text-ink-2">{imp.progress.note}</p> : null}
        {imp.error ? <p className="text-[12.5px] text-danger">{imp.error}</p> : null}
        <dl className="grid grid-cols-2 gap-3 text-[12px] sm:grid-cols-4">
          {(["created", "queued", "failed", "skipped"] as const).map((s) => (
            <div key={s}>
              <dt className="text-ink-3">{ITEM_META[s].label}</dt>
              <dd className="text-[18px] text-ink tabular">{s === "skipped" ? imp.counts.skipped - notTicked : imp.counts[s]}</dd>
            </div>
          ))}
        </dl>
        {imp.profile && (imp.profile.logo || imp.profile.banner || imp.profile.description || imp.profile.socials) ? (
          <p className="text-[12.5px] text-ink-2">
            Storefront draft: {imp.profile.applied ? (imp.profile.error ? `updated, with problems: ${imp.profile.error}` : "updated from the site.") : running ? "waiting…" : (imp.profile.error ?? "not updated.")}
          </p>
        ) : null}
        {running ? (
          <p className="text-[11.5px] text-ink-3">You can leave this page; the import carries on. If Yard restarts, it resumes where it stopped.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="primary" size="sm" className="h-10 sm:h-9">
              <Link href={`/admin/products/suggestions?brand=${encodeURIComponent(imp.brandId)}&status=all`}>Open {brand.name}&apos;s suggestions</Link>
            </Button>
            {remaining > 0 ? (
              <Button type="button" variant="secondary" size="sm" className="h-10 sm:h-9" onClick={onMore}>
                Import more from this scan
              </Button>
            ) : null}
            <Button type="button" variant="ghost" size="sm" className="h-10 sm:h-9" onClick={onNewScan}>
              New scan
            </Button>
          </div>
        )}
      </div>
      <section aria-labelledby={`${id}-items`} className="grid gap-2">
        <h2 id={`${id}-items`} className="text-[15px] font-medium text-ink">
          Products
          {notTicked ? <span className="ml-2 text-[12px] font-normal text-ink-3">{notTicked} not ticked</span> : null}
        </h2>
        <ul className="grid gap-1.5">
          {shown.map((it) => (
            <ResultRow key={it.key} it={it} p={imp.found.find((f) => f.key === it.key)} />
          ))}
        </ul>
      </section>
    </div>
  )
}

function ResultRow({ it, p }: { it: ImportItemDto; p: ImportProductDto | undefined }) {
  const m = ITEM_META[it.status]
  return (
    <li className={cn("flex items-start gap-3 px-3 py-2.5", panel)}>
      {it.cover || p?.images[0] ? (
        // eslint-disable-next-line @next/next/no-img-element -- Yard's own copy once made; until then the source photo, for recognition only
        <img src={it.cover ?? p!.images[0]} alt="" referrerPolicy="no-referrer" loading="lazy" className="size-11 shrink-0 rounded border border-white/10 object-cover" />
      ) : (
        <span className="size-11 shrink-0 rounded border border-dashed border-white/10" aria-hidden />
      )}
      <div className="grid min-w-0 flex-1 gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 truncate text-[13px] text-ink">{it.title}</span>
          <StatusBadge tone={m.tone}>{m.label}</StatusBadge>
        </div>
        <p className="text-[11.5px] text-ink-3">
          {it.status === "queued" ? (it.images.total ? `Photos ${it.images.done} of ${it.images.total} copied` : "Waiting") : null}
          {it.status === "created" ? `${it.images.done} ${it.images.done === 1 ? "photo" : "photos"} in Yard · suggestion ${PROPOSAL_LABEL[it.proposalStatus ?? "pending"] ?? it.proposalStatus}` : null}
          {it.reason && it.status !== "queued" ? <span className={cn(it.status === "failed" ? "text-danger" : "", "block break-words")}>{it.reason}</span> : null}
        </p>
      </div>
      {it.proposalId ? (
        <Link href={`/admin/products/suggestions?proposal=${encodeURIComponent(it.proposalId)}`} className="shrink-0 text-[12px] text-violet hover:underline">
          Open
        </Link>
      ) : null}
    </li>
  )
}
