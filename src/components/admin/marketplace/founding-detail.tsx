"use client"

import { useEffect, useId, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowSquareOutIcon, ImageSquareIcon, LinkSimpleIcon, SealCheckIcon, StopCircleIcon, TrashSimpleIcon, XIcon } from "@phosphor-icons/react"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { AdminImg, ServerActivity } from "@/components/admin/trust/shared"
import { ActionErrorNote, ReauthCodeField, actionError, useReauth, type ActionError } from "@/components/admin/finance/reauth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { countries, countryCodes, currencyCodes, type CountryCode } from "@/config/markets"
import { errorMessage, fieldErrors } from "@/lib/api/errors"
import { CLAIM_LINK_DAYS, foundingCreateBody, type FoundingBrandRow, type FoundingPatchBody, type FoundingStatus } from "@/lib/api/contracts/founding"
import { IMAGE_MIMES, UPLOAD_CAPS } from "@/lib/api/contracts/uploads"
import {
  actionKey,
  checkFoundingHandle,
  createFoundingBrand,
  endSetupSession,
  foundingKeys,
  getFoundingBrand,
  issueClaimLink,
  openSetupSession,
  revokeClaimLink,
  updateFoundingBrand,
} from "@/lib/api/founding"
import { apiUpload } from "@/lib/api/upload"
import { useApi } from "@/lib/api/use-api"
import { categories } from "@/lib/data"
import { afterIdentityChange } from "@/lib/session/identity"
import { cn } from "@/lib/utils"
import { CopyValue, Initials } from "./bits"
import { DetailSection, DetailSheet, Facts, LinkRow, insetClass } from "./detail-sheet"
import { categoryName, countryName, formatDate, formatDateTime } from "./format"

/*
 * The founding-brand tray (owner only, brands.founding): the inline create form, and one brand's
 * record with its Yard setup, claim link, badge and profile. Everything typed is inline in the
 * tray (no dialogs); every write goes to the server and shows the server's own message.
 */

export const foundingStatusMeta: Record<FoundingStatus, { label: string; tone: "info" | "attention" | "neutral" | "success"; hint: string }> = {
  setting_up: { label: "Setting up", tone: "info", hint: "Yard is setting it up. No claim link is out." },
  link_sent: { label: "Link sent", tone: "attention", hint: "A claim link is waiting for the owner." },
  claimed: { label: "Claimed", tone: "neutral", hint: "Claimed. Selling starts once the owner adds a payout account and the storefront is published." },
  live: { label: "Live", tone: "success", hint: "Claimed, payout account added and storefront published." },
}

const fieldClass = "h-10 rounded-md border-white/10 bg-white/[0.02] text-[13px]"
const selectClass = "h-10 w-full rounded-md border-white/10 bg-white/[0.02] text-[13px] data-[size=default]:h-10"
const IMAGE_CAP = UPLOAD_CAPS.storefront_cover

function slugifyHandle(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
    .replace(/-+$/, "")
}

/** A label, its control and the field's error (or hint) under it. */
function Field({ id, label, error, hint, className, children }: { id: string; label: string; error?: string; hint?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("grid min-w-0 content-start gap-1.5", className)}>
      <Label htmlFor={id} className="text-[12px] text-ink-2">
        {label}
      </Label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs break-words text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[11px] break-words text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
const describedBy = (id: string, error?: string, hint?: unknown) => (error ? `${id}-error` : hint ? `${id}-hint` : undefined)

/** A staged image (logo or banner): picked here, uploaded only when the form is saved. */
type Staged = { file: File; preview: string } | null

function useStaged() {
  const [staged, setStaged] = useState<Staged>(null)
  useEffect(() => () => (staged ? URL.revokeObjectURL(staged.preview) : undefined), [staged])
  return [staged, (file: File | null) => setStaged(file ? { file, preview: URL.createObjectURL(file) } : null)] as const
}

function imageProblem(file: File) {
  if (!(IMAGE_MIMES as readonly string[]).includes(file.type)) return "Use a JPEG, PNG or WebP image."
  if (file.size > IMAGE_CAP) return `This image is too large. The limit is ${Math.round(IMAGE_CAP / (1 << 20))} MB.`
  return null
}

function ImagePick({ id, label, hint, wide, staged, current, onPick, onClear, error, disabled }: { id: string; label: string; hint: string; wide?: boolean; staged: Staged; current?: string | null; onPick: (f: File) => void; onClear?: () => void; error?: string; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  const src = staged?.preview ?? current ?? null
  return (
    <Field id={id} label={label} error={error} hint={hint}>
      <div className="flex min-w-0 items-center gap-3">
        <span className={cn("relative shrink-0 overflow-hidden rounded-md border border-white/8 bg-white/[0.03]", wide ? "h-14 w-28" : "size-14")}>
          {src ? (
            staged ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={src} alt="" className="size-full object-cover" />
            ) : (
              <AdminImg src={src} alt="" className="size-full" />
            )
          ) : (
            <ImageSquareIcon className="absolute inset-0 m-auto size-4 text-ink-3" aria-hidden />
          )}
        </span>
        <div className="flex min-w-0 flex-wrap gap-2">
          <Button type="button" size="sm" variant="secondary" className="h-10 sm:h-8" disabled={disabled} onClick={() => input.current?.click()} aria-describedby={describedBy(id, error, hint)}>
            {src ? "Replace" : "Choose image"}
          </Button>
          {staged && onClear ? (
            <Button type="button" size="sm" variant="ghost" className="h-10 sm:h-8" disabled={disabled} onClick={onClear}>
              <XIcon /> Remove
            </Button>
          ) : null}
        </div>
        <input
          ref={input}
          id={id}
          type="file"
          accept={IMAGE_MIMES.join(",")}
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ""
            if (f) onPick(f)
          }}
        />
      </div>
    </Field>
  )
}

/** Uploads a staged image for a founding brand (as admin), returning its media id. */
async function uploadFor(brandId: string, file: File) {
  const media = await apiUpload(file, { purpose: "storefront_cover", as: "admin", brandId }).promise
  return media.id
}

/* ------------------------------------------------------------------ */
/* The tray                                                            */
/* ------------------------------------------------------------------ */

export function FoundingDetail({
  target,
  row,
  open,
  onOpenChange,
  onSaved,
  onCreated,
}: {
  /** "new" for the create form, else a brand id. */
  target: string | null
  /** The list's copy of the record, shown while the fresh one loads. */
  row?: FoundingBrandRow
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (brand: FoundingBrandRow) => void
  onCreated: (brand: FoundingBrandRow) => void
}) {
  // Keep the last target while the sheet animates out.
  const [last, setLast] = useState(target)
  if (target && target !== last) setLast(target)
  const shown = target ?? last
  if (!shown) return null
  if (shown === "new") return <CreateSheet key="new" open={open} onOpenChange={onOpenChange} onCreated={onCreated} />
  return <BrandSheet key={shown} id={shown} row={row} open={open} onOpenChange={onOpenChange} onSaved={onSaved} />
}

/* ---------- Create ---------- */

type CreateFields = { name: string; handle: string; category: string; city: string; country: CountryCode | ""; currency: string; story: string; instagram: string; tiktok: string }
const emptyCreate: CreateFields = { name: "", handle: "", category: "", city: "", country: "", currency: "", story: "", instagram: "", tiktok: "" }

type HandleCheck = { handle: string; state: "checking" | "available" | "taken" | "error"; message?: string }

function useHandleCheck(handle: string) {
  const [check, setCheck] = useState<HandleCheck | null>(null)
  useEffect(() => {
    if (handle.length < 3) return
    const controller = new AbortController()
    const t = window.setTimeout(() => {
      setCheck({ handle, state: "checking" })
      checkFoundingHandle(handle, controller.signal)
        .then((r) => setCheck({ handle, state: r.available ? "available" : "taken", message: r.message ?? undefined }))
        .catch((e: unknown) => {
          if (!controller.signal.aborted) setCheck({ handle, state: "error", message: errorMessage(e, "Couldn't check the handle.") })
        })
    }, 350)
    return () => {
      window.clearTimeout(t)
      controller.abort()
    }
  }, [handle])
  return check?.handle === handle ? check : null
}

function CreateSheet({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (b: FoundingBrandRow) => void }) {
  const id = useId()
  const [f, setF] = useState<CreateFields>(emptyCreate)
  const [handleEdited, setHandleEdited] = useState(false)
  const [currencyEdited, setCurrencyEdited] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [logo, setLogo] = useStaged()
  const [banner, setBanner] = useStaged()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<ActionError | null>(null)
  // One key per "Create" action, kept across retries; the steps already done are skipped on retry.
  const [prog, setProg] = useState<{ key: string; brand?: FoundingBrandRow; logoId?: string; bannerId?: string; patched?: boolean }>(() => ({ key: actionKey() }))
  const [created, setCreated] = useState<FoundingBrandRow | null>(null)
  const handleCheck = useHandleCheck(f.handle)
  const locked = !!created || busy

  function set<K extends keyof CreateFields>(k: K, v: CreateFields[K]) {
    setF((cur) => {
      const next = { ...cur, [k]: v }
      if (k === "name" && !handleEdited) next.handle = slugifyHandle(String(v))
      if (k === "country" && !currencyEdited && v) next.currency = countries[v as CountryCode].currency
      return next
    })
    setErrors((cur) => {
      const next = { ...cur }
      delete next[k]
      if (k === "name" && !handleEdited) delete next.handle
      if (k === "country" && !currencyEdited) delete next.currency
      return next
    })
  }

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
      idempotencyKey: prog.key,
    })
    const next: Record<string, string> = {}
    if (!parsed.success) for (const issue of parsed.error.issues) next[String(issue.path[0] ?? "form")] ??= issue.message
    if (!f.category) next.category = "Choose one of Yard's categories."
    if (!f.country) next.country = "Choose one of Yard's markets."
    if (!f.currency) next.currency = "Choose one of Yard's currencies."
    if (handleCheck?.state === "taken" && handleCheck.message) next.handle = handleCheck.message
    return { body: parsed.success ? parsed.data : null, errors: next }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setFailure(null)
    const p = { ...prog }
    if (!p.brand) {
      const v = validate()
      if (Object.keys(v.errors).length || !v.body) {
        setErrors(v.errors)
        const first = Object.keys(v.errors)[0]
        document.getElementById(`${id}-${first}`)?.focus()
        return
      }
    }
    setBusy(true)
    try {
      if (!p.brand) {
        const v = validate()
        p.brand = (await createFoundingBrand(v.body!)).brand
        setProg({ ...p })
      }
      const brandId = p.brand.id
      if (logo && !p.logoId) {
        p.logoId = await uploadFor(brandId, logo.file)
        setProg({ ...p })
      }
      if (banner && !p.bannerId) {
        p.bannerId = await uploadFor(brandId, banner.file)
        setProg({ ...p })
      }
      if ((p.logoId || p.bannerId) && !p.patched) {
        const patch: FoundingPatchBody = {}
        if (p.logoId) patch.logoMediaId = p.logoId
        if (p.bannerId) patch.bannerMediaId = p.bannerId
        p.brand = (await updateFoundingBrand(brandId, patch)).brand
        p.patched = true
        setProg({ ...p })
      }
      setCreated(p.brand)
      toast.success(`${p.brand.name} created`, { description: "Set it up in Studio as Yard setup, then send the owner a claim link." })
      onCreated(p.brand)
    } catch (cause) {
      const fields = fieldErrors(cause)
      if (!p.brand && Object.keys(fields).length) {
        setErrors(fields)
        const first = Object.keys(fields)[0]
        document.getElementById(`${id}-${first}`)?.focus()
      } else {
        setFailure(actionError(cause, p.brand ? "The brand was created, but its photos didn't save. Try again." : "The brand couldn't be created. Try again."))
      }
    } finally {
      setBusy(false)
    }
  }

  const handleHint =
    f.handle.length < 3 ? "Lowercase letters, numbers and hyphens. The storefront lives at /brands/handle." : !handleCheck || handleCheck.state === "checking" ? "Checking…" : handleCheck.state === "available" ? `Available: /brands/${f.handle}` : handleCheck.message
  const handleError = errors.handle ?? (handleCheck?.state === "taken" ? handleCheck.message : undefined)
  const stepNote = prog.brand && !created ? `${prog.brand.name} was created. Saving its photos is what's left: press Finish to try again.` : null

  return (
    <DetailSheet
      open={open}
      onOpenChange={onOpenChange}
      title="New founding brand"
      description="Yard sets it up, then the owner claims it"
      lead={<Initials name={f.name || "New brand"} size="lg" />}
      actions={
        <div className="grid gap-2.5">
          {stepNote ? <p className="text-[11.5px] leading-snug text-ink-3">{stepNote}</p> : <p className="text-[11.5px] leading-snug text-ink-3">It&apos;s created verified, with the Founding badge on, starter shipping and a storefront draft. It stays hidden until its storefront is published, and isn&apos;t for sale until the owner claims it and adds a payout account.</p>}
          <ActionErrorNote error={failure} onReload={() => window.location.reload()} />
          <div className="flex flex-wrap items-center justify-end gap-2 [&>*]:flex-1 sm:[&>*]:flex-none">
            <Button type="button" size="sm" variant="secondary" className="h-10 sm:h-9" onClick={() => onOpenChange(false)}>
              {created ? "Close" : "Cancel"}
            </Button>
            {created ? null : (
              <Button type="submit" form={`${id}-form`} size="sm" variant="primary" className="h-10 sm:h-9" loading={busy} disabled={busy}>
                {prog.brand ? "Finish" : "Create brand"}
              </Button>
            )}
          </div>
        </div>
      }
    >
      <form id={`${id}-form`} onSubmit={submit} noValidate className="grid gap-4">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
          <Field id={`${id}-name`} label="Brand name" error={errors.name} className="sm:col-span-2">
            <Input id={`${id}-name`} value={f.name} maxLength={40} disabled={locked || !!prog.brand} onChange={(e) => set("name", e.target.value)} aria-invalid={!!errors.name} aria-describedby={describedBy(`${id}-name`, errors.name)} className={fieldClass} autoComplete="off" />
          </Field>
          <Field id={`${id}-handle`} label="Handle" error={handleError} hint={handleHint} className="sm:col-span-2">
            <div className="relative">
              <span aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[13px] text-ink-3">@</span>
              <Input
                id={`${id}-handle`}
                value={f.handle}
                maxLength={30}
                disabled={locked || !!prog.brand}
                onChange={(e) => {
                  setHandleEdited(true)
                  set("handle", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))
                }}
                aria-invalid={!!handleError}
                aria-describedby={describedBy(`${id}-handle`, handleError, handleHint)}
                className={cn(fieldClass, "pl-7")}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          </Field>
          <Field id={`${id}-category`} label="Category" error={errors.category}>
            <Select value={f.category} onValueChange={(v) => set("category", v)} disabled={locked || !!prog.brand}>
              <SelectTrigger id={`${id}-category`} aria-invalid={!!errors.category} aria-describedby={describedBy(`${id}-category`, errors.category)} className={selectClass}>
                <SelectValue placeholder="Choose a category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.slug} value={c.slug}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field id={`${id}-city`} label="City" error={errors.city}>
            <Input id={`${id}-city`} value={f.city} maxLength={80} disabled={locked || !!prog.brand} onChange={(e) => set("city", e.target.value)} aria-invalid={!!errors.city} aria-describedby={describedBy(`${id}-city`, errors.city)} className={fieldClass} autoComplete="off" />
          </Field>
          <Field id={`${id}-country`} label="Country" error={errors.country}>
            <Select value={f.country} onValueChange={(v) => set("country", v as CountryCode)} disabled={locked || !!prog.brand}>
              <SelectTrigger id={`${id}-country`} aria-invalid={!!errors.country} aria-describedby={describedBy(`${id}-country`, errors.country)} className={selectClass}>
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
          <Field id={`${id}-currency`} label="Currency" error={errors.currency} hint="Prices and payouts. The owner can't change it later without Yard.">
            <Select
              value={f.currency}
              onValueChange={(v) => {
                setCurrencyEdited(true)
                set("currency", v)
              }}
              disabled={locked || !!prog.brand}
            >
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
          <Field id={`${id}-story`} label="Story" error={errors.story} hint={`${f.story.length}/2000. The storefront intro starts from it.`} className="sm:col-span-2">
            <Textarea id={`${id}-story`} value={f.story} maxLength={2000} rows={4} disabled={locked || !!prog.brand} onChange={(e) => set("story", e.target.value)} aria-invalid={!!errors.story} aria-describedby={describedBy(`${id}-story`, errors.story, true)} className="min-h-24 rounded-md border-white/10 bg-white/[0.02] text-[13px]" />
          </Field>
          <Field id={`${id}-instagram`} label="Instagram" error={errors.instagram} hint="Handle only, without @">
            <Input id={`${id}-instagram`} value={f.instagram} maxLength={31} disabled={locked || !!prog.brand} onChange={(e) => set("instagram", e.target.value)} aria-invalid={!!errors.instagram} aria-describedby={describedBy(`${id}-instagram`, errors.instagram, true)} className={fieldClass} autoComplete="off" spellCheck={false} />
          </Field>
          <Field id={`${id}-tiktok`} label="TikTok" error={errors.tiktok} hint="Handle only, without @">
            <Input id={`${id}-tiktok`} value={f.tiktok} maxLength={25} disabled={locked || !!prog.brand} onChange={(e) => set("tiktok", e.target.value)} aria-invalid={!!errors.tiktok} aria-describedby={describedBy(`${id}-tiktok`, errors.tiktok, true)} className={fieldClass} autoComplete="off" spellCheck={false} />
          </Field>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
          <ImagePick
            id={`${id}-logo`}
            label="Logo"
            hint="Square works best. JPEG, PNG or WebP."
            staged={logo}
            error={errors.logo}
            disabled={locked || !!prog.logoId}
            onPick={(file) => {
              const problem = imageProblem(file)
              setErrors((c) => ({ ...c, logo: problem ?? "" }))
              if (!problem) setLogo(file)
            }}
            onClear={() => setLogo(null)}
          />
          <ImagePick
            id={`${id}-banner`}
            label="Banner"
            wide
            hint="The storefront cover. Landscape."
            staged={banner}
            error={errors.banner}
            disabled={locked || !!prog.bannerId}
            onPick={(file) => {
              const problem = imageProblem(file)
              setErrors((c) => ({ ...c, banner: problem ?? "" }))
              if (!problem) setBanner(file)
            }}
            onClear={() => setBanner(null)}
          />
        </div>
        {created ? (
          <p role="status" className={cn("px-3 py-2.5 text-[13px] text-ink-2", insetClass)}>
            {created.name} is ready. Open it from the list to set it up in Studio and send the claim link.
          </p>
        ) : null}
      </form>
    </DetailSheet>
  )
}

/* ---------- One brand ---------- */

function BrandSheet({ id: brandId, row, open, onOpenChange, onSaved }: { id: string; row?: FoundingBrandRow; open: boolean; onOpenChange: (o: boolean) => void; onSaved: (b: FoundingBrandRow) => void }) {
  const q = useApi(foundingKeys.one(brandId), () => getFoundingBrand(brandId), { revalidateOnFocus: true })
  const b = q.data?.brand ?? row ?? null
  const saved = (next: FoundingBrandRow) => {
    q.mutate({ brand: next })
    onSaved(next)
  }

  if (!b) {
    return (
      <DetailSheet open={open} onOpenChange={onOpenChange} title={q.error ? "Founding brand not found" : "Loading…"} lead={<Initials name="?" size="lg" />}>
        {q.error ? (
          <div role="alert" className={cn("grid gap-2 px-3 py-3 text-[13px] text-danger", insetClass)}>
            <p>{errorMessage(q.error, "This founding brand couldn't be loaded.")}</p>
            <Button type="button" size="sm" variant="secondary" className="w-fit" onClick={() => void q.revalidate()}>
              Try again
            </Button>
          </div>
        ) : (
          <p role="status" className="text-[13px] text-ink-3">
            Loading the brand…
          </p>
        )}
      </DetailSheet>
    )
  }

  const status = foundingStatusMeta[b.status]
  const unclaimed = b.claimStatus === "unclaimed"
  const onHold = b.reviewStatus === "suspended" || b.reviewStatus === "restricted"

  return (
    <DetailSheet
      open={open}
      onOpenChange={onOpenChange}
      title={b.name}
      description={`@${b.handle}, ${b.city}, ${countryName(b.country)}`}
      lead={b.logo ? <AdminImg src={b.logo.src} alt="" className="size-11 shrink-0 rounded-md border border-white/10" /> : <Initials name={b.name} size="lg" />}
      badges={
        <>
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          {b.foundingBadge ? <StatusBadge tone="neutral">Founding badge on</StatusBadge> : <StatusBadge tone="muted">Badge off</StatusBadge>}
          {onHold ? <StatusBadge tone="danger">{b.reviewStatus === "suspended" ? "Suspended" : "Restricted"}</StatusBadge> : null}
        </>
      }
      actions={unclaimed ? <SetupBar brand={b} disabledReason={onHold ? `Yard has ${b.reviewStatus} ${b.name}. Reinstate it from Brands first.` : undefined} /> : undefined}
    >
      {q.error ? <p className="text-[12px] text-danger">{errorMessage(q.error, "Couldn't refresh this brand. Showing the list's copy.")}</p> : null}
      <p className="text-[12.5px] text-ink-2">{status.hint}</p>
      <Facts
        items={[
          { label: "Products", value: <span className="tabular">{b.products.published} published of {b.products.total}</span> },
          { label: "Storefront", value: b.storefrontPublished ? "Published" : <span className="text-ink-3">Draft only</span> },
          { label: "Payout account", value: b.hasPayoutAccount ? "Added" : <span className="text-ink-3">Not yet</span> },
          { label: "Category", value: b.category ? categoryName(b.category) : "—" },
        ]}
      />

      <ClaimSection brand={b} onSaved={saved} />
      <BadgeSection brand={b} onSaved={saved} />
      {unclaimed ? <ProfileSection key={`${b.id}:${b.logo?.mediaId}:${b.banner?.mediaId}`} brand={b} onSaved={saved} disabled={onHold} /> : null}

      <DetailSection title="Activity">
        <ServerActivity subjectIds={[b.id]} extra={b.createdAt ? [{ at: `${b.createdAt}T00:00:00.000Z`, label: "Founding brand created" }] : []} empty="No activity recorded yet." />
      </DetailSection>

      <DetailSection title="Links">
        <ul className="grid gap-1.5">
          <li>
            {b.storefrontPublished ? (
              <LinkRow href={`/brands/${b.handle}`} label="View storefront" hint={`/brands/${b.handle}`} />
            ) : (
              <p className="rounded-[10px] border border-dashed border-white/10 px-3 py-2.5 text-[12px] text-ink-3">No public storefront yet. It appears once it&apos;s published in Studio.</p>
            )}
          </li>
        </ul>
      </DetailSection>
    </DetailSheet>
  )
}

/** The tray's footer for an unclaimed brand: open (or end) Studio as Yard setup. */
function SetupBar({ brand: b, disabledReason }: { brand: FoundingBrandRow; disabledReason?: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState<"open" | "end" | null>(null)
  const [failure, setFailure] = useState<ActionError | null>(null)
  async function openSetup() {
    setBusy("open")
    setFailure(null)
    try {
      await openSetupSession(b.id)
      // The brand session cookie changed: Studio reads it afresh, then opens on Products.
      await afterIdentityChange("studio")
      router.push("/studio/products")
    } catch (cause) {
      setFailure(actionError(cause, "Yard setup couldn't be opened. Try again."))
      setBusy(null)
    }
  }
  async function endSetup() {
    setBusy("end")
    setFailure(null)
    try {
      const r = await endSetupSession(b.id)
      toast.success(r.ended || r.removed ? `Yard setup on ${b.name} ended` : `No Yard setup was open on ${b.name}`)
    } catch (cause) {
      setFailure(actionError(cause, "Yard setup couldn't be ended. Try again."))
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="grid gap-2.5">
      <p className="text-[11.5px] leading-snug text-ink-3">{disabledReason ?? "Yard setup opens Studio on this brand for 8 hours: products, photos, collections, storefront, shipping and store locations (the Around map) only. Every change is recorded under your name. It ends when the owner claims the brand."}</p>
      <ActionErrorNote error={failure} onReload={() => window.location.reload()} />
      <div className="flex flex-wrap items-center justify-end gap-2 [&>*]:flex-1 sm:[&>*]:flex-none">
        <Button type="button" size="sm" variant="secondary" className="h-10 sm:h-9" loading={busy === "end"} disabled={!!busy} onClick={() => void endSetup()}>
          <StopCircleIcon /> End Yard setup
        </Button>
        <Button type="button" size="sm" variant="primary" className="h-10 sm:h-9" loading={busy === "open"} disabled={!!busy || !!disabledReason} onClick={() => void openSetup()}>
          <ArrowSquareOutIcon /> Open in Studio
        </Button>
      </div>
    </div>
  )
}

/** The claim link: who it's for, when it expires, and the inline composer to send, re-send or revoke it. */
function ClaimSection({ brand: b, onSaved }: { brand: FoundingBrandRow; onSaved: (b: FoundingBrandRow) => void }) {
  const id = useId()
  const link = b.claimLink
  const [email, setEmail] = useState(link?.email ?? "")
  const [emailError, setEmailError] = useState<string | null>(null)
  const [busy, setBusy] = useState<"send" | "revoke" | null>(null)
  const [failure, setFailure] = useState<ActionError | null>(null)
  const [issued, setIssued] = useState<{ url: string; email: string; expiresAt: string } | null>(null)
  const reauth = useReauth()
  // One key per "Send" action, reused if it's retried (a retry returns the same link, no second email).
  const key = useRef(actionKey())

  if (b.claimStatus === "claimed") {
    return (
      <DetailSection title="Claim">
        <div className={cn("flex items-start gap-2.5 px-3 py-2.5", insetClass)}>
          <SealCheckIcon className="mt-0.5 size-4 shrink-0 text-violet" aria-hidden />
          <p className="min-w-0 text-[13px] break-words text-ink-2">
            Claimed{b.claimedBy ? ` by ${b.claimedBy.name}` : ""}
            {b.claimedAt ? ` on ${formatDate(b.claimedAt)}` : ""}. The owner runs it from Studio now; Yard setup has ended.
          </p>
        </div>
      </DetailSection>
    )
  }

  async function send(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    const v = email.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      setEmailError("Enter the owner's email address.")
      document.getElementById(`${id}-email`)?.focus()
      return
    }
    setBusy("send")
    setFailure(null)
    try {
      if (!(await reauth.verify())) return
      const r = await issueClaimLink(b.id, { email: v, idempotencyKey: key.current })
      setIssued({ url: r.url, email: r.link.email, expiresAt: r.link.expiresAt })
      key.current = actionKey()
      toast.success(r.created ? `Claim link sent to ${r.link.email}` : "That link was already sent", { description: "Copy it from the tray if you want to share it yourself. It's shown only now." })
      const fresh = await getFoundingBrand(b.id).catch(() => null)
      if (fresh) onSaved(fresh.brand)
    } catch (cause) {
      if (reauth.catches(cause)) return
      const fields = fieldErrors(cause)
      if (fields.email) setEmailError(fields.email)
      else setFailure(actionError(cause, "The claim link couldn't be sent. Try again."))
    } finally {
      setBusy(null)
    }
  }

  async function revoke() {
    if (busy) return
    setBusy("revoke")
    setFailure(null)
    try {
      await revokeClaimLink(b.id)
      setIssued(null)
      toast.success("Claim link revoked", { description: "It no longer works. Send a new one when you're ready." })
      const fresh = await getFoundingBrand(b.id).catch(() => null)
      if (fresh) onSaved(fresh.brand)
    } catch (cause) {
      setFailure(actionError(cause, "The claim link couldn't be revoked. Try again."))
    } finally {
      setBusy(null)
    }
  }

  return (
    <DetailSection title="Claim link" className="min-w-0 grid-cols-[minmax(0,1fr)]" aside={<span className="text-[11px] text-ink-3">Single use, {CLAIM_LINK_DAYS} days</span>}>
      {link ? (
        <div className={cn("grid gap-1 px-3 py-2.5", insetClass)}>
          <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink">
            <LinkSimpleIcon className="size-3.5 shrink-0 text-ink-3" aria-hidden />
            <span className="min-w-0 break-all">{link.email}</span>
            {link.status === "expired" ? <StatusBadge tone="danger">Expired</StatusBadge> : <StatusBadge tone="attention">Waiting</StatusBadge>}
          </p>
          <p className="text-[11.5px] text-ink-3">
            Sent {formatDateTime(link.createdAt)}. {link.status === "expired" ? "Expired" : "Expires"} {formatDateTime(link.expiresAt)}.
          </p>
        </div>
      ) : (
        <p className="rounded-[10px] border border-dashed border-white/10 px-3 py-2.5 text-[12px] text-ink-3">No claim link out. Send one when the store is ready for its owner.</p>
      )}

      {issued ? (
        <div className={cn("grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1.5 px-3 py-2.5", insetClass)} role="status">
          <p className="text-[12px] text-ink-2">Emailed to {issued.email}. This is the only time Yard shows the link; sending again replaces it.</p>
          <CopyValue value={issued.url} display={<span className="text-[12px]">{issued.url}</span>} label="Copy claim link" className="w-full max-w-full min-w-0 text-ink-2" />
        </div>
      ) : null}

      <form onSubmit={send} noValidate className="grid gap-2.5">
        <Field id={`${id}-email`} label="Owner's email" error={emailError ?? undefined} hint="The link only works for this address. The owner signs in or creates their account with it.">
          <Input
            id={`${id}-email`}
            type="email"
            inputMode="email"
            autoComplete="off"
            value={email}
            maxLength={254}
            onChange={(e) => {
              setEmail(e.target.value)
              setEmailError(null)
            }}
            aria-invalid={!!emailError}
            aria-describedby={describedBy(`${id}-email`, emailError ?? undefined, true)}
            className={fieldClass}
          />
        </Field>
        <ReauthCodeField reauth={reauth} id={`${id}-code`} />
        <ActionErrorNote error={failure} onReload={() => window.location.reload()} />
        <div className="flex flex-wrap items-center justify-end gap-2 [&>*]:flex-1 sm:[&>*]:flex-none">
          {link && link.status === "pending" ? (
            <Button type="button" size="sm" variant="secondary" className="h-10 sm:h-8" loading={busy === "revoke"} disabled={!!busy} onClick={() => void revoke()}>
              <TrashSimpleIcon /> Revoke link
            </Button>
          ) : null}
          <Button type="submit" size="sm" variant="secondary" className="h-10 sm:h-8" loading={busy === "send"} disabled={!!busy || reauth.waiting}>
            {reauth.required ? "Confirm and send" : link ? "Send a new link" : "Send claim link"}
          </Button>
        </div>
      </form>
    </DetailSection>
  )
}

/** The Founding badge on the storefront header, product pages and brand cards. */
function BadgeSection({ brand: b, onSaved }: { brand: FoundingBrandRow; onSaved: (b: FoundingBrandRow) => void }) {
  const id = useId()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function toggle(on: boolean) {
    setBusy(true)
    setError(null)
    try {
      const r = await updateFoundingBrand(b.id, { foundingBadge: on })
      onSaved(r.brand)
      toast.success(on ? "Founding badge on" : "Founding badge off", { description: "Shoppers see the change within a minute." })
    } catch (cause) {
      setError(errorMessage(cause, "The badge couldn't be changed. Try again."))
    } finally {
      setBusy(false)
    }
  }
  return (
    <DetailSection title="Founding badge">
      <div className={cn("flex items-center justify-between gap-3 px-3 py-2.5", insetClass)}>
        <Label htmlFor={`${id}-badge`} className="min-w-0 text-[13px] leading-snug font-normal text-ink-2">
          Show “Founding brand” on its storefront, product pages and brand cards
        </Label>
        <Switch id={`${id}-badge`} checked={b.foundingBadge} disabled={busy} onCheckedChange={(v) => void toggle(v)} />
      </div>
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </DetailSection>
  )
}

/** Profile, logo and banner while the brand is unclaimed (the owner manages them after claiming). */
function ProfileSection({ brand: b, onSaved, disabled }: { brand: FoundingBrandRow; onSaved: (b: FoundingBrandRow) => void; disabled: boolean }) {
  const id = useId()
  const initial = useMemo(() => ({ name: b.name, city: b.city, story: b.story ?? "", instagram: b.instagram ?? "", tiktok: b.tiktok ?? "" }), [b])
  const [f, setF] = useState(initial)
  const [logo, setLogo] = useStaged()
  const [banner, setBanner] = useStaged()
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<ActionError | null>(null)
  const changed = (Object.keys(f) as (keyof typeof f)[]).filter((k) => f[k].trim() !== initial[k].trim())
  const dirty = changed.length > 0 || !!logo || !!banner

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (busy || !dirty) return
    setBusy(true)
    setFailure(null)
    setErrors({})
    try {
      const patch: FoundingPatchBody = {}
      for (const k of changed) {
        const v = f[k].trim()
        if (k === "story" || k === "instagram" || k === "tiktok") patch[k] = v || null
        else patch[k] = v
      }
      if (logo) patch.logoMediaId = await uploadFor(b.id, logo.file)
      if (banner) patch.bannerMediaId = await uploadFor(b.id, banner.file)
      const r = await updateFoundingBrand(b.id, patch)
      setLogo(null)
      setBanner(null)
      onSaved(r.brand)
      toast.success("Profile saved")
    } catch (cause) {
      const fields = fieldErrors(cause)
      if (Object.keys(fields).length) setErrors(fields)
      else setFailure(actionError(cause, "The profile couldn't be saved. Try again."))
    } finally {
      setBusy(false)
    }
  }

  const input = (k: keyof typeof f, label: string, max: number, hint?: string) => (
    <Field id={`${id}-${k}`} label={label} error={errors[k]} hint={hint}>
      <Input id={`${id}-${k}`} value={f[k]} maxLength={max} disabled={disabled || busy} onChange={(e) => setF((c) => ({ ...c, [k]: e.target.value }))} aria-invalid={!!errors[k]} aria-describedby={describedBy(`${id}-${k}`, errors[k], hint)} className={fieldClass} autoComplete="off" />
    </Field>
  )

  return (
    <DetailSection title="Profile">
      <form onSubmit={save} noValidate className="grid gap-4">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
          {input("name", "Brand name", 40)}
          {input("city", "City", 80)}
          <Field id={`${id}-story`} label="Story" error={errors.story} hint={`${f.story.length}/2000`} className="sm:col-span-2">
            <Textarea id={`${id}-story`} value={f.story} maxLength={2000} rows={4} disabled={disabled || busy} onChange={(e) => setF((c) => ({ ...c, story: e.target.value }))} aria-invalid={!!errors.story} aria-describedby={describedBy(`${id}-story`, errors.story, true)} className="min-h-24 rounded-md border-white/10 bg-white/[0.02] text-[13px]" />
          </Field>
          {input("instagram", "Instagram", 31, "Handle only")}
          {input("tiktok", "TikTok", 25, "Handle only")}
          <ImagePick
            id={`${id}-logo`}
            label="Logo"
            hint="Square works best."
            staged={logo}
            current={b.logo?.src}
            error={errors.logo ?? errors.logoMediaId}
            disabled={disabled || busy}
            onPick={(file) => {
              const problem = imageProblem(file)
              setErrors((c) => ({ ...c, logo: problem ?? "" }))
              if (!problem) setLogo(file)
            }}
            onClear={() => setLogo(null)}
          />
          <ImagePick
            id={`${id}-banner`}
            label="Banner"
            wide
            hint="Goes into the storefront draft as its cover."
            staged={banner}
            current={b.banner?.src}
            error={errors.banner ?? errors.bannerMediaId}
            disabled={disabled || busy}
            onPick={(file) => {
              const problem = imageProblem(file)
              setErrors((c) => ({ ...c, banner: problem ?? "" }))
              if (!problem) setBanner(file)
            }}
            onClear={() => setBanner(null)}
          />
        </div>
        <ActionErrorNote error={failure} onReload={() => window.location.reload()} />
        <div className="flex flex-wrap items-center justify-end gap-2 [&>*]:flex-1 sm:[&>*]:flex-none">
          {dirty ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-10 sm:h-8"
              disabled={busy}
              onClick={() => {
                setF(initial)
                setLogo(null)
                setBanner(null)
                setErrors({})
              }}
            >
              Discard
            </Button>
          ) : null}
          <Button type="submit" size="sm" variant="secondary" className="h-10 sm:h-8" loading={busy} disabled={busy || !dirty || disabled}>
            Save profile
          </Button>
        </div>
      </form>
    </DetailSection>
  )
}
