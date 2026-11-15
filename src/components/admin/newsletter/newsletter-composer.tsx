"use client"

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  CalendarBlankIcon,
  CaretLeftIcon,
  CheckCircleIcon,
  DesktopIcon,
  DeviceMobileIcon,
  ImageIcon,
  LinkSimpleIcon,
  ListBulletsIcon,
  PaperPlaneTiltIcon,
  TextBIcon,
  TrashIcon,
  UploadSimpleIcon,
  WarningIcon,
} from "@phosphor-icons/react"
import { EmptyState } from "@/components/dashboard/empty-state"
import { PageHeader } from "@/components/dashboard/page-header"
import { ListSkeleton } from "@/components/feedback/skeletons"
import { LoadError, TrustGate } from "@/components/admin/trust/shared"
import { useSearchParam } from "@/components/admin/marketplace/url-state"
import { Field, Panel } from "@/components/studio/catalog/fields"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { countries, countryCodes } from "@/config/markets"
import { ApiError } from "@/lib/api/client"
import type { NewsletterBrandDto, NewsletterDetailDto, NewsletterFields } from "@/lib/api/contracts/newsletter"
import { errorMessage, fieldErrors } from "@/lib/api/errors"
import { actionKey } from "@/lib/api/founding"
import { deleteNewsletter, getNewsletter, newsletterAudienceCount, newsletterBrands, newsletterKeys, previewNewsletter, saveNewsletter, sendNewsletter, testNewsletter } from "@/lib/api/newsletter"
import { apiUpload } from "@/lib/api/upload"
import { revalidatePrefix, useApi } from "@/lib/api/use-api"
import { prepareImage } from "@/lib/media/prepare-image"
import { NEWSLETTER_LIMITS, NEWSLETTER_MIN_LEAD_MS, newsletterAudienceMeta, newsletterHints, newsletterKindMeta, newsletterProblems, soundsPromotional, type NewsletterAudience, type NewsletterAudienceType, type NewsletterKind } from "@/lib/newsletter"
import { cn } from "@/lib/utils"
import { localTime, NEWSLETTER, people } from "./parts"

/*
 * Admin › Newsletter › Compose (?id=): one page, four sections (Type, Audience, Message, Send), with
 * the real email beside it (desktop or phone width). Everything autosaves a moment after you stop
 * typing; the preview is rendered by the server with the same template the outbox sends. Send is a
 * confirm step inside the page that names the exact count; "Send test to me" mails the admin first.
 */

type Form = Required<Omit<NewsletterFields, never>>
const FIELDS: (keyof Form)[] = ["name", "kind", "subject", "preheader", "heading", "body", "greet", "heroMediaId", "heroAlt", "buttonLabel", "buttonUrl", "audience", "audienceBrandId", "audienceCountry"]

const fromCampaign = (c: NewsletterDetailDto): Form => ({
  name: c.name,
  kind: c.kind,
  subject: c.subject,
  preheader: c.preheader,
  heading: c.heading,
  body: c.body,
  greet: c.greet,
  heroMediaId: c.hero?.mediaId ?? null,
  heroAlt: c.heroAlt,
  buttonLabel: c.buttonLabel,
  buttonUrl: c.buttonUrl,
  audience: c.audience.type,
  audienceBrandId: c.audience.brandId,
  audienceCountry: c.audience.country,
})

const audienceOf = (f: Form): NewsletterAudience => (f.audience === "followers" ? { type: "followers", brandId: f.audienceBrandId ?? "" } : f.audience === "country" ? { type: "country", country: f.audienceCountry ?? "" } : { type: f.audience })

const fieldClass = "h-10 rounded-md border-white/10 bg-white/[0.02] text-[13px]"

export function NewsletterComposeRoute() {
  const id = useSearchParam("id")
  return (
    <TrustGate feature="Newsletter" anyOf={["comms.newsletter"]}>
      {id ? <Loader key={id} id={id} /> : <EmptyState title="No campaign chosen" body="Open a draft from the Newsletter list, or start a new one there." action={<BackButton />} />}
    </TrustGate>
  )
}

function BackButton() {
  return (
    <Button asChild size="sm" variant="secondary">
      <Link href={NEWSLETTER}>Newsletter</Link>
    </Button>
  )
}

function Loader({ id }: { id: string }) {
  const q = useApi(newsletterKeys.one(id), () => getNewsletter(id), { revalidateOnFocus: false, keepPrevious: false })
  const c = q.data?.campaign
  if (q.error && !c) return <LoadError error={q.error} onRetry={() => void q.revalidate()} what="this campaign" />
  if (!c) return <ListSkeleton rows={8} />
  if (c.status !== "draft")
    return (
      <div className="grid gap-5">
        <Back />
        <EmptyState
          title={c.status === "scheduled" ? "This campaign is scheduled" : "This campaign has gone out"}
          body={c.status === "scheduled" ? `It goes out ${c.scheduledFor ? localTime(c.scheduledFor) : "soon"}. Cancel the schedule from its panel to edit it.` : "Sent campaigns can't be edited. Its numbers are in the Newsletter list."}
          action={
            <Button asChild size="sm" variant="secondary">
              <Link href={`${NEWSLETTER}?campaign=${encodeURIComponent(c.id)}`}>Open its panel</Link>
            </Button>
          }
        />
      </div>
    )
  return <Composer campaign={c} />
}

function Back() {
  return (
    <Link href={NEWSLETTER} className="inline-flex w-fit items-center gap-1 text-xs text-ink-2 hover:text-ink">
      <CaretLeftIcon className="size-3.5" /> Newsletter
    </Link>
  )
}

type SaveState = { kind: "idle" | "saving" | "saved" | "error" | "conflict"; at?: number; message?: string }

function Composer({ campaign }: { campaign: NewsletterDetailDto }) {
  const id = campaign.id
  const uid = useId()
  const router = useRouter()
  const [form, setForm] = useState<Form>(() => fromCampaign(campaign))
  const [heroSrc, setHeroSrc] = useState<string | null>(campaign.hero?.src ?? null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [save, setSave] = useState<SaveState>({ kind: "saved", at: Date.parse(campaign.updatedAt) })
  const saved = useRef<Form>(fromCampaign(campaign))
  const revision = useRef(campaign.revision)
  const formRef = useRef(form)
  const inFlight = useRef<Promise<void> | null>(null)
  useEffect(() => {
    formRef.current = form
  })

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    if (errors[k] || (k.startsWith("audience") && errors.audience)) setErrors((e) => ({ ...e, [k]: "", ...(k.startsWith("audience") ? { audience: "" } : {}) }))
  }

  /** Saves what changed since the last save. Resolves once the server has it (or failed). */
  const flush = useCallback(async (): Promise<boolean> => {
    if (inFlight.current) await inFlight.current
    const cur = formRef.current
    const diff: Partial<Form> = {}
    for (const k of FIELDS) if (cur[k] !== saved.current[k]) (diff as Record<string, unknown>)[k] = cur[k]
    if (!Object.keys(diff).length) return true
    setSave({ kind: "saving" })
    let ok = true
    const run = (async () => {
      try {
        const r = await saveNewsletter(id, { ...diff, revision: revision.current })
        revision.current = r.campaign.revision
        saved.current = { ...saved.current, ...diff }
        if (r.campaign.hero?.src) setHeroSrc(r.campaign.hero.src)
        setSave({ kind: "saved", at: Date.now() })
      } catch (e) {
        ok = false
        if (e instanceof ApiError && e.status === 409) setSave({ kind: "conflict", message: errorMessage(e) })
        else {
          const f = fieldErrors(e)
          if (Object.keys(f).length) setErrors((x) => ({ ...x, ...f }))
          setSave({ kind: "error", message: errorMessage(e, "Couldn't save. We'll try again when you type.") })
        }
      }
    })()
    inFlight.current = run
    await run
    inFlight.current = null
    return ok
  }, [id])

  // Autosave a moment after the last change.
  useEffect(() => {
    if (save.kind === "conflict") return
    const dirty = FIELDS.some((k) => form[k] !== saved.current[k])
    if (!dirty) return
    const t = window.setTimeout(() => void flush(), 800)
    return () => window.clearTimeout(t)
  }, [form, flush, save.kind])

  // Save on the way out (tab close, navigation).
  useEffect(() => {
    const onHide = () => void flush()
    window.addEventListener("pagehide", onHide)
    return () => {
      window.removeEventListener("pagehide", onHide)
      void flush()
    }
  }, [flush])

  const origin = typeof window === "undefined" ? "" : window.location.origin
  const problems = useMemo(() => newsletterProblems({ ...form, audience: audienceOf(form) }, origin), [form, origin])
  const promo = form.kind === "service" && soundsPromotional(form)

  return (
    <div className="grid gap-5">
      <div className="grid gap-2">
        <Back />
        <PageHeader title={form.name.trim() || form.subject.trim() || "Untitled campaign"} description="Write it, check it, send it. Drafts save as you type." actions={<SaveNote state={save} />} />
      </div>
      {save.kind === "conflict" ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-danger/40 px-3 py-2.5 text-[13px] text-danger">
          <span>{save.message}</span>
          <Button size="sm" variant="secondary" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      ) : null}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,600px)]">
        <div className="grid min-w-0 gap-4">
          <TypeSection form={form} set={set} promo={promo} />
          <AudienceSection form={form} set={set} error={errors.audience || problems.audience} />
          <MessageSection uid={uid} form={form} set={set} errors={errors} heroSrc={heroSrc} setHeroSrc={setHeroSrc} flush={flush} />
          <SendSection
            id={id}
            form={form}
            problems={problems}
            flush={flush}
            onProblems={(p) => setErrors((e) => ({ ...e, ...p }))}
            onSent={() => {
              revalidatePrefix("admin.newsletters")
              router.push(`${NEWSLETTER}?campaign=${encodeURIComponent(id)}`)
            }}
            onDeleted={() => {
              revalidatePrefix("admin.newsletters")
              router.push(NEWSLETTER)
            }}
          />
        </div>
        <PreviewPane id={id} form={form} />
      </div>
    </div>
  )
}

function SaveNote({ state }: { state: SaveState }) {
  const text = state.kind === "saving" ? "Saving…" : state.kind === "saved" ? `Saved${state.at ? ` ${new Date(state.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : ""}` : state.kind === "error" ? (state.message ?? "Not saved") : state.kind === "conflict" ? "Not saved" : ""
  return (
    <p role="status" aria-live="polite" className={cn("flex items-center gap-1.5 text-xs", state.kind === "error" || state.kind === "conflict" ? "text-danger" : "text-ink-3")}>
      {state.kind === "saved" ? <CheckCircleIcon className="size-3.5 text-violet" aria-hidden /> : null}
      {text}
    </p>
  )
}

/* ---------- Type ---------- */

function OptionCard({ on, onClick, title, body, children }: { on: boolean; onClick: () => void; title: string; body: string; children?: React.ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      className={cn(
        "grid min-h-11 content-start gap-1 rounded-[12px] border px-3 py-2.5 text-left transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-violet",
        on ? "border-violet/50 bg-purple/15" : "border-white/10 hover:bg-white/[0.03]",
      )}
    >
      <span className="flex items-center gap-2 text-[13px] text-ink">
        <span className={cn("grid size-3.5 place-items-center rounded-full border", on ? "border-violet" : "border-white/25")} aria-hidden>
          {on ? <span className="size-1.5 rounded-full bg-violet" /> : null}
        </span>
        {title}
      </span>
      <span className="text-[12px] leading-snug text-ink-3">{body}</span>
      {children}
    </button>
  )
}

type SetFn = <K extends keyof Form>(k: K, v: Form[K]) => void

function TypeSection({ form, set, promo }: { form: Form; set: SetFn; promo: boolean }) {
  return (
    <Panel title="1. Type" description="Who is allowed to get it depends on what it is.">
      <div role="radiogroup" aria-label="Campaign type" className="grid gap-2 sm:grid-cols-2">
        {(["marketing", "service"] as NewsletterKind[]).map((k) => (
          <OptionCard key={k} on={form.kind === k} onClick={() => set("kind", k)} title={newsletterKindMeta[k].label} body={newsletterKindMeta[k].body} />
        ))}
      </div>
      {form.kind === "service" ? (
        <p role="note" className={cn("mt-3 flex gap-2 rounded-[10px] border px-3 py-2.5 text-[12.5px]", promo ? "border-acid/50 text-ink" : "border-white/10 text-ink-2")}>
          <WarningIcon className={cn("mt-0.5 size-4 shrink-0", promo ? "text-acid" : "text-ink-3")} aria-hidden />
          <span>
            Not for promotions. Service notices skip people&apos;s marketing choice, so use them only for changes to terms, privacy or how Yard works.
            {promo ? " This one reads like a promotion (sale, drops, offers): send it as Marketing instead." : ""}
          </span>
        </p>
      ) : null}
    </Panel>
  )
}

/* ---------- Audience ---------- */

function AudienceSection({ form, set, error }: { form: Form; set: SetFn; error?: string }) {
  const audience = audienceOf(form)
  const [count, setCount] = useState<{ key: string; n: number } | null>(null)
  const countKey = `${form.kind}:${form.audience}:${form.audienceBrandId ?? ""}:${form.audienceCountry ?? ""}`
  useEffect(() => {
    const ctl = new AbortController()
    const t = window.setTimeout(() => {
      newsletterAudienceCount({ kind: form.kind, type: form.audience, brandId: form.audienceBrandId, country: form.audienceCountry }, ctl.signal)
        .then((r) => setCount({ key: countKey, n: r.count }))
        .catch(() => {})
    }, 250)
    return () => {
      window.clearTimeout(t)
      ctl.abort()
    }
  }, [countKey, form.kind, form.audience, form.audienceBrandId, form.audienceCountry])
  const n = count?.key === countKey ? count.n : null
  const incomplete = (audience.type === "followers" && !audience.brandId) || (audience.type === "country" && !audience.country)

  return (
    <Panel
      title="2. Audience"
      description={form.kind === "marketing" ? "Only people who said yes to news and offers from Yard, and haven't unsubscribed." : "Everyone in the audience with a working address, whatever their marketing choice."}
      action={
        <p className="shrink-0 text-right text-[12px] text-ink-2 tabular" aria-live="polite">
          {incomplete ? "Choose one first" : n == null ? "Counting…" : <span className="text-ink">{people(n)}</span>}
        </p>
      }
    >
      <div role="radiogroup" aria-label="Audience" className="grid gap-2 sm:grid-cols-2">
        {(["shoppers", "brands", "followers", "country"] as NewsletterAudienceType[]).map((t) => (
          <OptionCard key={t} on={form.audience === t} onClick={() => set("audience", t)} title={newsletterAudienceMeta[t].label} body={newsletterAudienceMeta[t].body} />
        ))}
      </div>
      {form.audience === "followers" ? <BrandPicker value={form.audienceBrandId} onChange={(id) => set("audienceBrandId", id)} /> : null}
      {form.audience === "country" ? (
        <div className="mt-3 grid max-w-xs gap-1.5">
          <Label htmlFor="nl-country" className="text-[12px] text-ink-2">
            Country
          </Label>
          <Select value={form.audienceCountry ?? undefined} onValueChange={(v) => set("audienceCountry", v)}>
            <SelectTrigger id="nl-country" className="h-10 w-full rounded-md border-white/10 bg-white/[0.02] text-[13px] data-[size=default]:h-10">
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
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      ) : null}
      {form.kind === "marketing" && n === 0 && !incomplete ? <p className="mt-3 text-[12px] text-ink-3">Nobody here has opted in yet. People switch on &ldquo;News and offers from Yard&rdquo; in their Settings.</p> : null}
    </Panel>
  )
}

function BrandPicker({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const [term, setTerm] = useState("")
  const [q, setQ] = useState("")
  useEffect(() => {
    const t = window.setTimeout(() => setQ(term.trim()), 250)
    return () => window.clearTimeout(t)
  }, [term])
  const list = useApi(`admin.newsletters.brands:${q}`, () => newsletterBrands(q))
  const brands: NewsletterBrandDto[] = list.data?.brands ?? []
  return (
    <div className="mt-3 grid gap-2">
      <Label htmlFor="nl-brand" className="text-[12px] text-ink-2">
        Brand
      </Label>
      <Input id="nl-brand" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search brands" className={fieldClass} autoComplete="off" />
      <ul className="grid max-h-56 gap-1 overflow-y-auto" aria-label="Brands">
        {brands.map((b) => (
          <li key={b.id}>
            <button
              type="button"
              aria-pressed={value === b.id}
              onClick={() => onChange(b.id)}
              className={cn("flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border px-3 py-1.5 text-left transition-colors", value === b.id ? "border-violet/50 bg-purple/15" : "border-white/[0.06] hover:bg-white/[0.04]")}
            >
              <span className="min-w-0">
                <span className="block truncate text-[13px] text-ink">{b.name}</span>
                <span className="block truncate text-[11.5px] text-ink-3">@{b.handle}</span>
              </span>
              <span className="shrink-0 text-[11.5px] text-ink-2 tabular">{b.followers.toLocaleString("en-US")} followers</span>
            </button>
          </li>
        ))}
        {list.data && !brands.length ? <li className="px-1 text-[12px] text-ink-3">No brand matches.</li> : null}
      </ul>
    </div>
  )
}

/* ---------- Message ---------- */

function Count({ n, max }: { n: number; max: number }) {
  return <span className={cn("text-xs tabular", n > max * 0.9 ? "text-ink-2" : "text-ink-3")}>{n}/{max}</span>
}

function MessageSection({ uid, form, set, errors, heroSrc, setHeroSrc, flush }: { uid: string; form: Form; set: SetFn; errors: Record<string, string>; heroSrc: string | null; setHeroSrc: (s: string | null) => void; flush: () => Promise<boolean> }) {
  const body = useRef<HTMLTextAreaElement>(null)
  const L = NEWSLETTER_LIMITS
  const f = (k: string) => `${uid}-${k}`

  /** Wraps the selection (Bold), makes it a link, or bullets the selected lines. */
  function format(kind: "bold" | "link" | "list") {
    const el = body.current
    if (!el) return
    const { selectionStart: a, selectionEnd: b, value } = el
    const sel = value.slice(a, b)
    let next = value
    let cursor = b
    if (kind === "bold") {
      const t = sel || "bold words"
      next = `${value.slice(0, a)}**${t}**${value.slice(b)}`
      cursor = a + t.length + 4
    } else if (kind === "link") {
      const t = sel || "link words"
      const ins = `[${t}](/shop)`
      next = `${value.slice(0, a)}${ins}${value.slice(b)}`
      cursor = a + ins.length
    } else {
      const start = value.lastIndexOf("\n", a - 1) + 1
      const lines = value.slice(start, b || a).split("\n")
      const ins = lines.map((l) => (l.startsWith("- ") ? l : `- ${l}`)).join("\n")
      next = `${value.slice(0, start)}${ins}${value.slice(b || a)}`
      cursor = start + ins.length
    }
    set("body", next.slice(0, L.body))
    window.requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(cursor, cursor)
    })
  }

  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  async function upload(file: File) {
    setUploading(true)
    setUploadError(null)
    try {
      const ready = await prepareImage(file, { max: 1600 })
      const media = await apiUpload(ready, { purpose: "newsletter_image", as: "admin" }).promise
      setHeroSrc(media.src)
      set("heroMediaId", media.id)
      window.setTimeout(() => void flush(), 0)
    } catch (e) {
      setUploadError(errorMessage(e, "The image didn't upload. Try again."))
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  return (
    <Panel title="3. Message" description="You write the words; the email wraps them in Yard's look. The placeholders are just ideas.">
      <div className="grid gap-4">
        <Field id={f("name")} label="Campaign name" hint="Only admins see this, in the list." optional aside={<Count n={form.name.length} max={L.name} />}>
          <Input id={f("name")} value={form.name} maxLength={L.name} onChange={(e) => set("name", e.target.value)} placeholder={newsletterHints.name} className={fieldClass} />
        </Field>
        <Field id={f("subject")} label="Subject" error={errors.subject} aside={<Count n={form.subject.length} max={L.subject} />}>
          <Input id={f("subject")} value={form.subject} maxLength={L.subject} onChange={(e) => set("subject", e.target.value)} placeholder={newsletterHints.subject} aria-invalid={!!errors.subject} className={fieldClass} />
        </Field>
        <Field id={f("preheader")} label="Preview text" hint="The grey line after the subject in most inboxes." optional aside={<Count n={form.preheader.length} max={L.preheader} />}>
          <Input id={f("preheader")} value={form.preheader} maxLength={L.preheader} onChange={(e) => set("preheader", e.target.value)} placeholder={newsletterHints.preheader} className={fieldClass} />
        </Field>
        <Field id={f("heading")} label="Heading" error={errors.heading} aside={<Count n={form.heading.length} max={L.heading} />}>
          <Input id={f("heading")} value={form.heading} maxLength={L.heading} onChange={(e) => set("heading", e.target.value)} placeholder={newsletterHints.heading} aria-invalid={!!errors.heading} className={fieldClass} />
        </Field>
        <div className="flex items-start gap-3">
          <Switch id={f("greet")} checked={form.greet} onCheckedChange={(v) => set("greet", v)} className="mt-0.5" />
          <Label htmlFor={f("greet")} className="grid gap-0.5 font-normal">
            <span className="text-[13px] text-ink">Start with &ldquo;Hey {"{first name}"},&rdquo;</span>
            <span className="text-xs text-ink-3">Left out for anyone without a name on their account.</span>
          </Label>
        </div>

        <div className="grid min-w-0 gap-1.5">
          <div className="flex min-h-4 items-baseline justify-between gap-3">
            <Label htmlFor={f("body")} className="text-[13px] text-ink">
              Message
            </Label>
            <Count n={form.body.length} max={L.body} />
          </div>
          <div role="toolbar" aria-label="Formatting" className="flex flex-wrap gap-1">
            <Button type="button" size="sm" variant="ghost" className="h-9 sm:h-8" onClick={() => format("bold")}>
              <TextBIcon /> Bold
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-9 sm:h-8" onClick={() => format("link")}>
              <LinkSimpleIcon /> Link
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-9 sm:h-8" onClick={() => format("list")}>
              <ListBulletsIcon /> Bullets
            </Button>
          </div>
          <Textarea
            ref={body}
            id={f("body")}
            value={form.body}
            maxLength={L.body}
            rows={10}
            onChange={(e) => set("body", e.target.value)}
            placeholder={newsletterHints.body}
            aria-invalid={!!errors.body}
            aria-describedby={`${f("body")}-hint`}
            className="min-h-56 rounded-md border-white/10 bg-white/[0.02] font-mono text-[13px] leading-relaxed"
          />
          {errors.body ? (
            <p role="alert" className="text-xs text-danger">
              {errors.body}
            </p>
          ) : (
            <p id={`${f("body")}-hint`} className="text-[11.5px] text-ink-3">
              A blank line starts a new paragraph. **Bold**, [link words](/shop) and lines starting with &ldquo;- &rdquo; for bullets. Links can be Yard paths like /shop or full https:// addresses.
            </p>
          )}
        </div>

        <div className="grid gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[13px] text-ink">Image</span>
            <span className="text-xs text-ink-3">Optional</span>
          </div>
          {form.heroMediaId && heroSrc ? (
            <div className="grid gap-2 sm:grid-cols-[160px_minmax(0,1fr)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={heroSrc} alt="" className="aspect-[16/10] w-full rounded-[10px] border border-white/10 object-cover" />
              <div className="grid content-start gap-2">
                <Field id={f("alt")} label="Describe the image" error={errors.heroAlt} aside={<Count n={form.heroAlt.length} max={L.heroAlt} />}>
                  <Input id={f("alt")} value={form.heroAlt} maxLength={L.heroAlt} onChange={(e) => set("heroAlt", e.target.value)} placeholder={newsletterHints.heroAlt} aria-invalid={!!errors.heroAlt} className={fieldClass} />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="secondary" loading={uploading} onClick={() => fileRef.current?.click()}>
                    <UploadSimpleIcon /> Replace
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      set("heroMediaId", null)
                      setHeroSrc(null)
                    }}
                  >
                    <TrashIcon /> Remove
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className="flex min-h-20 items-center justify-center gap-2 rounded-[12px] border border-dashed border-white/15 px-3 text-[13px] text-ink-2 transition-colors hover:bg-white/[0.03] focus-visible:outline-2 focus-visible:outline-violet disabled:opacity-60">
              <ImageIcon className="size-4" aria-hidden /> {uploading ? "Uploading…" : "Add a wide image (JPEG, PNG or WebP)"}
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
          {uploadError ? (
            <p role="alert" className="text-xs text-danger">
              {uploadError}
            </p>
          ) : null}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field id={f("blabel")} label="Button label" error={errors.buttonLabel} optional aside={<Count n={form.buttonLabel.length} max={L.buttonLabel} />}>
            <Input id={f("blabel")} value={form.buttonLabel} maxLength={L.buttonLabel} onChange={(e) => set("buttonLabel", e.target.value)} placeholder={newsletterHints.buttonLabel} aria-invalid={!!errors.buttonLabel} className={fieldClass} />
          </Field>
          <Field id={f("burl")} label="Button link" error={errors.buttonUrl} optional>
            <Input id={f("burl")} value={form.buttonUrl} maxLength={L.buttonUrl} onChange={(e) => set("buttonUrl", e.target.value)} placeholder={newsletterHints.buttonUrl} aria-invalid={!!errors.buttonUrl} inputMode="url" className={fieldClass} />
          </Field>
        </div>
      </div>
    </Panel>
  )
}

/* ---------- Send ---------- */

const toLocalInput = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function SendSection({ id, form, problems, flush, onProblems, onSent, onDeleted }: { id: string; form: Form; problems: Record<string, string>; flush: () => Promise<boolean>; onProblems: (p: Record<string, string>) => void; onSent: () => void; onDeleted: () => void }) {
  const [step, setStep] = useState<"idle" | "confirm">("idle")
  const [when, setWhen] = useState<"now" | "later">("now")
  const [at, setAt] = useState(() => toLocalInput(new Date(Date.now() + 60 * 60_000)))
  const [count, setCount] = useState<number | null>(null)
  const [minAt, setMinAt] = useState("")
  const [busy, setBusy] = useState<"test" | "send" | "count" | "delete" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const testKey = useRef(actionKey())
  const sendKey = useRef(actionKey())
  const missing = Object.entries(problems)

  async function test() {
    setError(null)
    const p = { ...problems }
    delete p.audience
    if (Object.keys(p).length) return onProblems(p)
    setBusy("test")
    try {
      if (!(await flush())) return
      const r = await testNewsletter(id, testKey.current)
      toast.success(r.created ? `Test on its way to ${r.to}` : "That test already went out", { description: r.created ? "It leaves the outbox in a moment, marked [Test]." : "Change something to send another." })
      testKey.current = actionKey()
    } catch (e) {
      const f = fieldErrors(e)
      if (Object.keys(f).length) onProblems(f)
      else setError(errorMessage(e, "The test couldn't be sent. Try again."))
    } finally {
      setBusy(null)
    }
  }

  async function review() {
    setError(null)
    if (missing.length) return onProblems(problems)
    setBusy("count")
    try {
      if (!(await flush())) return
      const r = await newsletterAudienceCount({ kind: form.kind, type: form.audience, brandId: form.audienceBrandId, country: form.audienceCountry })
      setCount(r.count)
      setMinAt(toLocalInput(new Date(Date.now() + NEWSLETTER_MIN_LEAD_MS)))
      setStep("confirm")
      sendKey.current = actionKey()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  async function send() {
    if (count == null) return
    setBusy("send")
    setError(null)
    try {
      if (!(await flush())) return
      const atIso = when === "later" ? new Date(at).toISOString() : undefined
      if (when === "later" && (!atIso || Date.parse(atIso) - Date.now() < NEWSLETTER_MIN_LEAD_MS - 60_000)) {
        setError("Pick a time at least 5 minutes from now, or send it now.")
        return
      }
      const r = await sendNewsletter(id, { when, at: atIso, expectedCount: count, idempotencyKey: sendKey.current })
      toast.success(when === "now" ? `Sending to ${people(count)}` : `Scheduled for ${localTime(r.campaign.scheduledFor ?? atIso!)}`, { description: when === "now" ? "A batch goes out every minute. Watch the numbers in the list." : "You can cancel the schedule until then." })
      onSent()
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // The audience moved: show the new number and ask again.
        const r = await newsletterAudienceCount({ kind: form.kind, type: form.audience, brandId: form.audienceBrandId, country: form.audienceCountry }).catch(() => null)
        if (r) setCount(r.count)
        sendKey.current = actionKey()
      }
      const f = fieldErrors(e)
      if (Object.keys(f).length) onProblems(f)
      setError(errorMessage(e, "It couldn't be sent. Try again."))
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    setBusy("delete")
    try {
      await deleteNewsletter(id)
      toast("Draft deleted")
      onDeleted()
    } catch (e) {
      setError(errorMessage(e))
      setBusy(null)
    }
  }

  return (
    <Panel title="4. Send" description="Send yourself a test first. Then check the count and send it now or later.">
      {missing.length ? (
        <ul className="mb-3 grid gap-1 text-[12.5px] text-ink-2" aria-label="Still to do">
          {missing.map(([k, m]) => (
            <li key={k} className="flex gap-2">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-ink-3" aria-hidden /> {m}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-3 flex items-center gap-1.5 text-[12.5px] text-ink-2">
          <CheckCircleIcon className="size-4 text-violet" aria-hidden /> Ready to go.
        </p>
      )}

      {step === "confirm" && count != null ? (
        <div className="grid gap-3 rounded-[14px] border border-violet/40 bg-purple/[0.08] p-3 sm:p-4" role="group" aria-label="Confirm">
          <p className="font-display text-[1.5rem] leading-tight text-ink">
            This will send to <span className="tabular">{people(count)}</span>.
          </p>
          <p className="text-[12.5px] text-ink-2">
            {newsletterKindMeta[form.kind].label}: &ldquo;{form.subject}&rdquo;.{" "}
            {form.kind === "marketing" ? "Only people who said yes to news and offers. Each email has a one-click unsubscribe." : "A service notice goes to everyone in the audience, opted in or not."}
          </p>
          <div role="radiogroup" aria-label="When" className="grid gap-2 sm:grid-cols-2">
            <OptionCard on={when === "now"} onClick={() => setWhen("now")} title="Send now" body="The first batch leaves within a minute." />
            <OptionCard on={when === "later"} onClick={() => setWhen("later")} title="Schedule for later" body="Pick a day and time. Cancel any time before." />
          </div>
          {when === "later" ? (
            <div className="grid max-w-xs gap-1.5">
              <Label htmlFor="nl-at" className="text-[12px] text-ink-2">
                Goes out (your time)
              </Label>
              <Input id="nl-at" type="datetime-local" value={at} min={minAt} onChange={(e) => setAt(e.target.value)} className={cn(fieldClass, "[color-scheme:dark]")} />
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2 [&>*]:flex-1 sm:[&>*]:flex-none">
            <Button type="button" size="sm" variant="ghost" className="h-10 sm:h-9" disabled={busy === "send"} onClick={() => setStep("idle")}>
              Back
            </Button>
            <Button type="button" size="sm" variant="primary" className="h-10 sm:h-9" loading={busy === "send"} disabled={count === 0} onClick={() => void send()}>
              {when === "now" ? <PaperPlaneTiltIcon /> : <CalendarBlankIcon />} {when === "now" ? `Send to ${people(count)}` : "Schedule it"}
            </Button>
          </div>
          {count === 0 ? <p className="text-[12px] text-ink-3">Nobody to send to yet.</p> : null}
        </div>
      ) : (
        <>
          {error ? (
            <p role="alert" className="mb-2 text-xs text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button type="button" size="sm" variant="ghost" className="h-10 sm:h-9" loading={busy === "delete"} disabled={!!busy} onClick={() => void remove()}>
              <TrashIcon /> Delete draft
            </Button>
            <div className="flex flex-wrap gap-2 [&>*]:flex-1 sm:[&>*]:flex-none">
              <Button type="button" size="sm" variant="secondary" className="h-10 sm:h-9" loading={busy === "test"} disabled={!!busy} onClick={() => void test()}>
                <PaperPlaneTiltIcon /> Send test to me
              </Button>
              <Button type="button" size="sm" variant="primary" className="h-10 sm:h-9" loading={busy === "count"} disabled={!!busy} onClick={() => void review()}>
                Review and send
              </Button>
            </div>
          </div>
        </>
      )}
    </Panel>
  )
}

/* ---------- Preview ---------- */

function PreviewPane({ id, form }: { id: string; form: Form }) {
  const [device, setDevice] = useState<"desktop" | "phone">("desktop")
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null)
  const [failed, setFailed] = useState(false)
  const key = JSON.stringify(form)
  useEffect(() => {
    const ctl = new AbortController()
    const t = window.setTimeout(() => {
      previewNewsletter(id, JSON.parse(key) as Form, ctl.signal)
        .then((r) => {
          setPreview({ subject: r.subject, html: r.html })
          setFailed(false)
        })
        .catch((e) => {
          if (!ctl.signal.aborted && !(e instanceof DOMException)) setFailed(true)
        })
    }, 450)
    return () => {
      window.clearTimeout(t)
      ctl.abort()
    }
  }, [id, key])

  return (
    <section aria-label="Preview" className="grid min-w-0 gap-2 xl:sticky xl:top-20">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-ink">Preview</h2>
          <p className="truncate text-xs text-ink-3">{preview ? preview.subject : "Rendering…"}</p>
        </div>
        <div role="radiogroup" aria-label="Preview width" className="inline-flex rounded-full border border-white/10 p-0.5">
          {(["desktop", "phone"] as const).map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={device === d}
              onClick={() => setDevice(d)}
              className={cn("inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[12px] transition-colors sm:h-8", device === d ? "bg-purple/25 text-ink" : "text-ink-2 hover:text-ink")}
            >
              {d === "desktop" ? <DesktopIcon className="size-4" aria-hidden /> : <DeviceMobileIcon className="size-4" aria-hidden />}
              {d === "desktop" ? "Desktop" : "Phone"}
            </button>
          ))}
        </div>
      </div>
      {preview?.subject ? (
        <div className="rounded-[12px] border border-white/[0.07] bg-white/[0.02] px-3 py-2 text-[12px]">
          <p className="truncate text-ink">
            <span className="text-ink-3">Yard · </span>
            {preview.subject}
          </p>
          {form.preheader ? <p className="truncate text-ink-3">{form.preheader}</p> : null}
        </div>
      ) : null}
      <div className={cn("overflow-hidden rounded-[16px] border border-white/10 bg-[#080808]", device === "phone" ? "mx-auto w-full max-w-[390px]" : "w-full")}>
        {preview ? (
          <iframe title="Email preview" srcDoc={preview.html} sandbox="" className={cn("block w-full border-0 bg-[#080808]", device === "phone" ? "h-[720px]" : "h-[820px]")} />
        ) : (
          <div className="grid h-[420px] place-items-center text-[12px] text-ink-3">{failed ? "The preview couldn't be made." : "Rendering…"}</div>
        )}
      </div>
      {failed && preview ? <p className="text-[11.5px] text-danger">The preview is out of date: the last change couldn&apos;t be rendered.</p> : null}
    </section>
  )
}
