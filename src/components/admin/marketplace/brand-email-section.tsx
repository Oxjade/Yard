"use client"

import { useEffect, useId, useRef, useState } from "react"
import { toast } from "sonner"
import { CaretDownIcon, EnvelopeSimpleIcon, EyeIcon, EyeSlashIcon, PaperPlaneTiltIcon } from "@phosphor-icons/react"
import { ActionErrorNote, actionError, type ActionError } from "@/components/admin/finance/reauth"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { brandEmailSendBody, type BrandEmailContextDto } from "@/lib/api/contracts/brand-emails"
import { brandEmailKeys, getBrandEmails, previewBrandEmail, sendBrandEmail } from "@/lib/api/brand-emails"
import { errorMessage, fieldErrors } from "@/lib/api/errors"
import { actionKey } from "@/lib/api/founding"
import { useApi } from "@/lib/api/use-api"
import { BRAND_EMAIL_BODY_MAX, BRAND_EMAIL_PRESETS, BRAND_EMAIL_SUBJECT_MAX, brandEmailPresets, type BrandEmailPreset } from "@/lib/brand-emails"
import { payoutAccountNeededToSell } from "@/lib/sell-rule"
import { useNow } from "@/hooks/use-now"
import { cn } from "@/lib/utils"
import { useAdminSession } from "@/components/admin/trust/shared"
import { insetClass } from "./detail-sheet"
import { formatDateTime, plural, relDays } from "./format"

const fieldClass = "h-10 rounded-md border-white/10 bg-white/[0.02] text-[13px]"

type EmailsQuery = ReturnType<typeof useApi<BrandEmailContextDto>>

type Draft = { preset: BrandEmailPreset; subject: string; body: string }
/** `claimStatus` picks the payout wording: Buy is off without an account only for a founding brand (lib/sell-rule.ts). */
const draftFor = (preset: BrandEmailPreset, brand: string, claimStatus = "none"): Draft => ({ preset, subject: brandEmailPresets[preset].subject(brand), body: brandEmailPresets[preset].body(brand, { buyNeedsPayout: payoutAccountNeededToSell(claimStatus) }) })

/** "Tue 11:04 PM": when a capped brand can be emailed again, in the admin's own time zone. */
const sendAgainAt = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })

/**
 * "Email the brand" in a brand's tray (Admin › Brands and the founding-brand tray, brands.email):
 * ready-made templates as chips, an editable subject and message prefilled in Yard's voice, a
 * preview of the real email, and Send. It goes to the brand's owners and admins from the outbox;
 * every send is audited and listed under "Sent lately" with the reminders and decision emails.
 * Inline in the tray like the claim link, never a dialog.
 *
 * Collapsed by default to one row ("Email the brand", n of 5 in 24h): opening a brand is for
 * looking at it and helping it list, so the composer only opens when asked, and only then takes
 * focus (the subject). Collapsing keeps the draft.
 */
export function BrandEmailSection({ brandId, brandName, claimStatus }: { brandId: string; brandName: string; claimStatus?: string }) {
  const session = useAdminSession()
  if (!session.can("brands.email")) return null
  return <EmailSection key={brandId} brandId={brandId} brandName={brandName} claimStatus={claimStatus} />
}

function EmailSection({ brandId, brandName, claimStatus }: { brandId: string; brandName: string; claimStatus?: string }) {
  const id = useId()
  const q = useApi(brandEmailKeys.one(brandId), () => getBrandEmails(brandId), { revalidateOnFocus: true })
  const ctx = q.data
  const [open, setOpen] = useState(false)
  // Mounted on first open and kept (hidden) after, so collapsing never throws a draft away.
  const [mounted, setMounted] = useState(false)
  const focusOnOpen = useRef(false)

  useEffect(() => {
    if (!open || !focusOnOpen.current) return
    focusOnOpen.current = false
    document.getElementById(`${id}-subject`)?.focus()
  }, [open, id])

  function toggle() {
    if (!open) {
      setMounted(true)
      focusOnOpen.current = true
    }
    setOpen(!open)
  }

  return (
    <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2.5">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={toggle}
        className={cn("flex min-h-12 w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:border-white/[0.13] hover:bg-white/[0.03] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-violet", insetClass)}
      >
        <EnvelopeSimpleIcon className="size-4 shrink-0 text-ink-2" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block font-label text-[13px] text-ink">Email the brand</span>
          <span className="block text-[11.5px] text-ink-3">{open ? "Templates, preview and what Yard sent lately" : "Templates for drafts, storefront and payout, with a preview"}</span>
        </span>
        {ctx ? <span className="shrink-0 text-[11px] text-ink-3 tabular">{ctx.sentToday} of {ctx.dailyLimit} in 24h</span> : null}
        <CaretDownIcon className={cn("size-4 shrink-0 text-ink-3 transition-transform duration-150", open && "rotate-180")} aria-hidden />
      </button>
      <div id={`${id}-panel`} hidden={!open} className="min-w-0">
        {mounted ? <Composer id={id} brandId={brandId} brandName={brandName} claimStatus={claimStatus} q={q} /> : null}
      </div>
    </section>
  )
}

function Composer({ id, brandId, brandName, claimStatus, q }: { id: string; brandId: string; brandName: string; claimStatus?: string; q: EmailsQuery }) {
  const now = useNow(60_000)
  const ctx = q.data
  const name = ctx?.brand.name ?? brandName
  const claim = ctx?.brand.claimStatus ?? claimStatus
  const [draft, setDraft] = useState<Draft>(() => draftFor("finish_listing", name))
  const [errors, setErrors] = useState<{ subject?: string; body?: string }>({})
  const [busy, setBusy] = useState<"send" | "preview" | null>(null)
  const [failure, setFailure] = useState<ActionError | null>(null)
  const [preview, setPreview] = useState<{ html: string; subject: string } | null>(null)
  // One key per message; a retry of the same send reuses it (the server sends nothing twice).
  const key = useRef(actionKey())

  const preset = brandEmailPresets[draft.preset]
  const recipients = ctx?.recipients ?? []
  // The cap is a rolling 24 hours, so the composer names the moment a slot opens rather than "tomorrow".
  const capped = !!ctx && ctx.sentToday >= ctx.dailyLimit
  const blocked = ctx && !recipients.length ? (ctx.brand.claimStatus === "unclaimed" ? `${name} has no owner yet. Send the claim link first.` : `${name} has no active owner or admin to email.`) : capped ? `${name} already got ${ctx!.dailyLimit} emails from Yard in the last 24 hours.` : null

  function choose(p: BrandEmailPreset) {
    setDraft(draftFor(p, name, claim))
    setErrors({})
    setPreview(null)
    setFailure(null)
    key.current = actionKey()
    if (p === "custom") window.setTimeout(() => document.getElementById(`${id}-body`)?.focus(), 0)
  }

  function edit<K extends "subject" | "body">(k: K, v: string) {
    setDraft((d) => ({ ...d, [k]: v }))
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }))
    if (preview) setPreview(null)
    key.current = actionKey()
  }

  function check() {
    const r = brandEmailSendBody.safeParse({ ...draft, idempotencyKey: key.current })
    if (r.success) return r.data
    const next: { subject?: string; body?: string } = {}
    for (const issue of r.error.issues) {
      const f = issue.path[0]
      if ((f === "subject" || f === "body") && !next[f]) next[f] = issue.message
    }
    setErrors(next)
    document.getElementById(`${id}-${next.subject ? "subject" : "body"}`)?.focus()
    return null
  }

  async function showPreview() {
    if (busy) return
    if (preview) return setPreview(null)
    const body = check()
    if (!body) return
    setBusy("preview")
    setFailure(null)
    try {
      const r = await previewBrandEmail(brandId, { preset: body.preset, subject: body.subject, body: body.body })
      setPreview({ html: r.html, subject: r.subject })
    } catch (cause) {
      setFailure(actionError(cause, "The preview couldn't be made. Try again."))
    } finally {
      setBusy(null)
    }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault()
    if (busy || blocked) return
    const body = check()
    if (!body) return
    setBusy("send")
    setFailure(null)
    try {
      const r = await sendBrandEmail(brandId, body)
      q.mutate(r)
      const to = r.recipients.length === 1 ? (r.recipients[0].name ?? r.recipients[0].email) : plural(r.emailed, "person", "people")
      toast.success(r.created ? `Sent to ${to}` : "That email already went out", { description: r.created ? "It leaves the outbox in a moment. Recorded in the audit log." : "Nothing was sent twice." })
      setDraft(draftFor(draft.preset, name, claim))
      setPreview(null)
      key.current = actionKey()
    } catch (cause) {
      const fields = fieldErrors(cause)
      if (fields.subject || fields.body) setErrors({ subject: fields.subject, body: fields.body })
      else setFailure(actionError(cause, "The email couldn't be sent. Try again."))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2.5">
      {q.error && !ctx ? (
        <div role="alert" className={cn("grid gap-2 px-3 py-2.5 text-[12.5px] text-danger", insetClass)}>
          <p>{errorMessage(q.error, "Couldn't load this brand's emails.")}</p>
          <Button type="button" size="sm" variant="secondary" className="w-fit" onClick={() => void q.revalidate()}>
            Try again
          </Button>
        </div>
      ) : null}

      <div className={cn("grid gap-1 px-3 py-2.5", insetClass)}>
        <p className="text-[11px] text-ink-3">To</p>
        {!ctx ? (
          <p className="text-[12.5px] text-ink-3">Loading…</p>
        ) : recipients.length ? (
          <ul className="grid gap-0.5">
            {recipients.map((r) => (
              <li key={r.email} className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-[13px] text-ink-2">
                <span className="text-ink">{r.name ?? r.email}</span>
                <span className="text-[11.5px] text-ink-3">{r.role === "owner" ? "Owner" : "Admin"}</span>
                {r.name ? <span className="min-w-0 text-[11.5px] break-all text-ink-3">{r.email}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12.5px] text-ink-3">{blocked}</p>
        )}
        {ctx && !ctx.nudges ? <p className="pt-1 text-[11.5px] text-ink-3">The brand switched reminder emails off in Studio. Emails you send here still reach them.</p> : null}
      </div>

      <form onSubmit={send} noValidate className="grid min-w-0 gap-2.5">
        <div role="group" aria-label="Templates" className="flex flex-wrap gap-1.5">
          {BRAND_EMAIL_PRESETS.map((p) => {
            const on = draft.preset === p
            return (
              <button
                key={p}
                type="button"
                aria-pressed={on}
                title={brandEmailPresets[p].hint}
                onClick={() => choose(p)}
                disabled={!!busy}
                className={cn(
                  "inline-flex h-10 items-center rounded-full border px-3 text-[12px] transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-violet disabled:opacity-40 sm:h-7 sm:px-2.5 sm:text-[11.5px]",
                  on ? "border-violet/50 bg-purple/20 text-ink" : "border-line text-ink-2 hover:bg-elevated hover:text-ink",
                )}
              >
                {brandEmailPresets[p].label}
              </button>
            )
          })}
        </div>

        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor={`${id}-subject`} className="text-[12px] text-ink-2">
            Subject
          </Label>
          <Input
            id={`${id}-subject`}
            value={draft.subject}
            maxLength={BRAND_EMAIL_SUBJECT_MAX}
            onChange={(e) => edit("subject", e.target.value)}
            aria-invalid={!!errors.subject}
            aria-describedby={errors.subject ? `${id}-subject-error` : undefined}
            className={fieldClass}
          />
          {errors.subject ? (
            <p id={`${id}-subject-error`} role="alert" className="text-xs text-danger">
              {errors.subject}
            </p>
          ) : null}
        </div>

        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor={`${id}-body`} className="text-[12px] text-ink-2">
            Message
          </Label>
          <Textarea
            id={`${id}-body`}
            value={draft.body}
            maxLength={BRAND_EMAIL_BODY_MAX}
            onChange={(e) => edit("body", e.target.value)}
            rows={7}
            placeholder={draft.preset === "custom" ? "Say hi, keep it short and tell them what to do next." : undefined}
            aria-invalid={!!errors.body}
            aria-describedby={errors.body ? `${id}-body-error` : `${id}-body-hint`}
            className="min-h-36 rounded-md border-white/10 bg-white/[0.02] text-[13px] leading-relaxed"
          />
          {errors.body ? (
            <p id={`${id}-body-error`} role="alert" className="text-xs text-danger">
              {errors.body}
            </p>
          ) : (
            <p id={`${id}-body-hint`} className="text-[11px] break-words text-ink-3">
              Opens with &ldquo;{preset.heading}&rdquo; and &ldquo;Hey {name},&rdquo;. A blank line starts a new paragraph. The button says &ldquo;{preset.action.label}&rdquo; and opens {preset.action.url}.
            </p>
          )}
        </div>

        {preview ? (
          <div className={cn("grid min-w-0 gap-1.5 overflow-hidden p-1.5", insetClass)}>
            <p className="px-1.5 pt-1 text-[11.5px] text-ink-3">
              Preview: <span className="text-ink-2">{preview.subject}</span>
            </p>
            <iframe title={`Preview of the email to ${name}`} srcDoc={preview.html} sandbox="" className="h-[460px] w-full rounded-md border-0 bg-[#080808]" />
          </div>
        ) : null}

        <ActionErrorNote error={failure} onReload={() => window.location.reload()} />
        {blocked && recipients.length ? <p className="text-[11.5px] text-ink-3">{blocked}{capped && ctx?.nextSendAt ? ` You can send again ${sendAgainAt(ctx.nextSendAt)}.` : ""}</p> : null}
        <div className="flex flex-wrap items-center justify-end gap-2 [&>*]:flex-1 sm:[&>*]:flex-none">
          <Button type="button" size="sm" variant="secondary" className="h-10 sm:h-8" loading={busy === "preview"} disabled={!!busy} onClick={() => void showPreview()}>
            {preview ? <EyeSlashIcon /> : <EyeIcon />} {preview ? "Hide preview" : "Preview"}
          </Button>
          <Button type="submit" size="sm" variant="primary" className="h-10 sm:h-8" loading={busy === "send"} disabled={!!busy || !!blocked || !ctx}>
            <PaperPlaneTiltIcon /> Send email
          </Button>
        </div>
      </form>

      <History ctx={ctx} now={now} />
    </div>
  )
}

function History({ ctx, now }: { ctx: BrandEmailContextDto | undefined; now: number | null }) {
  if (!ctx) return null
  return (
    <div className="grid gap-1.5">
      <p className="text-[12px] text-ink-2">Sent lately</p>
      {ctx.history.length ? (
        <ul className={cn("divide-y divide-white/[0.07]", insetClass)}>
          {ctx.history.map((h) => (
            <li key={h.id} className="flex min-w-0 items-start gap-2.5 px-3 py-2.5">
              <EnvelopeSimpleIcon className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5 text-[13px] text-ink">
                  {h.label}
                  {h.by ? null : <StatusBadge tone="muted">Automatic</StatusBadge>}
                </span>
                {h.subject ? <span className="block text-[12px] break-words text-ink-2">{h.subject}</span> : null}
                <span className="block text-[11px] text-ink-3">
                  {h.by ? `${h.by}, ` : ""}
                  <time dateTime={h.at} title={formatDateTime(h.at)}>
                    {relDays(h.at, now).toLowerCase()}
                  </time>
                  {`, to ${plural(h.emailed, "person", "people")}`}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-[10px] border border-dashed border-white/10 px-3 py-2.5 text-[12px] text-ink-3">Nothing sent yet. Reminders, decisions and emails from here show up in this list.</p>
      )}
    </div>
  )
}
