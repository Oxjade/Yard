"use client"

import { useEffect, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { CheckIcon as Check, InfoIcon as Info, BankIcon as Landmark, ShieldCheckIcon as ShieldCheck } from "@phosphor-icons/react"
import { PageHeader } from "@/components/dashboard/page-header"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { countries, type CountryCode } from "@/config/markets"
import { Bone } from "@/components/feedback/skeletons"
import { api, ApiError } from "@/lib/api/client"
import type { PayoutSummaryDto } from "@/lib/api/contracts/payouts"
import { errorMessage } from "@/lib/api/errors"
import { useApi } from "@/lib/api/use-api"
import { useServerSession } from "@/lib/session/use-server-session"
import { AccountDetails } from "@/components/market/account/account-details"
import { toast } from "sonner"
import { categories } from "@/lib/data/catalog"
import type { CategorySlug } from "@/lib/data/types"
import { useAsyncAction } from "@/hooks/use-async-action"
import { useSearchParam } from "@/hooks/use-search-param"
import { useStudio } from "@/lib/stores/studio"
import { duration, ease, spring } from "@/lib/motion"
import { cn } from "@/lib/utils"
import { formatDateTime } from "./model"
import { FeesPanel, ReturnsSection, ShippingSection, TeamSection } from "./settings-more"
import { settingsDescription, accountNumberError, accountNumberLabel, bankCodeFor, banksFor, checkHandle, countryOptions, currencyOptions, providerLabel, providersFor, scheduleLabel } from "./settings-model"
import { SaveRow } from "./settings-parts"
import { useFocusReturn } from "./shared"
import { SettingsSectionsSkeleton } from "./skeletons"
import { accountOnFile, liveProfile, useBrandSettings, useSettingsReady, type PayoutProvider, type PayoutSchedule, type ProfileSettings } from "./settings-store"
import { Field, Panel, Segmented, control, inputClass, selectClass } from "@/components/studio/catalog/fields"

const sections = [
  { id: "profile", label: "Brand profile" },
  { id: "payouts", label: "Payouts" },
  { id: "shipping", label: "Shipping" },
  { id: "returns", label: "Returns" },
  { id: "team", label: "Team" },
  { id: "fees", label: "Fees" },
  { id: "account", label: "Your account" },
  { id: "help", label: "Help" },
] as const

type SectionId = (typeof sections)[number]["id"]

export function SettingsView() {
  const ready = useSettingsReady()
  const [active, setActive] = useState<SectionId>("profile")

  useEffect(() => {
    if (!ready) return
    const els = sections.map((s) => document.getElementById(s.id)).filter((el): el is HTMLElement => !!el)
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (hit) setActive(hit.target.id as SectionId)
      },
      { rootMargin: "-20% 0px -65% 0px" },
    )
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [ready])

  function jump(id: SectionId) {
    setActive(id)
    document.getElementById(id)?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" })
  }

  return (
    <div className="grid gap-6">
      <PageHeader title="Settings" description={settingsDescription} />

      <nav aria-label="Settings sections" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] xl:hidden">
        <ul className="flex min-w-max gap-1.5">
          {sections.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                onClick={(e) => {
                  e.preventDefault()
                  jump(s.id)
                }}
                aria-current={active === s.id ? "true" : undefined}
                className={cn("inline-flex h-8 items-center rounded-full border px-3 text-xs transition-colors", active === s.id ? "border-purple bg-purple/20 text-ink" : "border-line text-ink-2 hover:text-ink")}
              >
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="grid items-start gap-6 xl:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="sticky top-24 hidden xl:block">
          <ul className="grid gap-0.5">
            {sections.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  onClick={(e) => {
                    e.preventDefault()
                    jump(s.id)
                  }}
                  aria-current={active === s.id ? "true" : undefined}
                  className={cn("relative flex h-9 items-center rounded-md px-3 text-sm transition-colors", active === s.id ? "text-ink" : "text-ink-2 hover:text-ink")}
                >
                  {active === s.id ? <motion.span layoutId="settings-nav" aria-hidden className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-purple" transition={spring.indicator} /> : null}
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {ready ? (
          <div className="grid min-w-0 gap-6">
            <ProfileSection />
            <PayoutsSection />
            <ShippingSection />
            <ReturnsSection />
            <TeamSection />
            <FeesPanel />
            <YourAccountSection />
            <HelpSection />
          </div>
        ) : (
          <div role="status" aria-label="Loading settings">
            <SettingsSectionsSkeleton />
          </div>
        )}
      </div>
    </div>
  )
}

/* ---------- Brand profile ---------- */

const fieldName: Record<keyof ProfileSettings, string> = { name: "name", handle: "handle", category: "category", description: "description", city: "city", country: "country", currency: "currency" }

const listFields = (keys: (keyof ProfileSettings)[]) => {
  const names = keys.map((k) => fieldName[k])
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0]
}

function ProfileSection() {
  const brandId = useStudio((s) => s.brandId)
  const saved = useBrandSettings((s) => s.profile)
  const savedAt = useBrandSettings((s) => s.savedAt.profile)
  const saveProfile = useBrandSettings((s) => s.saveProfile)
  const [form, setForm] = useState<ProfileSettings>(saved)
  const [submitted, setSubmitted] = useState(false)
  const live = liveProfile()
  const pendingFields = (Object.keys(fieldName) as (keyof ProfileSettings)[]).filter((k) => saved[k] !== live[k])

  const set = <K extends keyof ProfileSettings>(k: K, v: ProfileSettings[K]) => setForm((f) => ({ ...f, [k]: v }))
  const dirty = JSON.stringify(form) !== JSON.stringify(saved)
  // Checked against the brands this build knows about; the backend checks the database.
  const handle = checkHandle(form.handle, brandId)
  const desc = form.description.trim().length

  const errors = {
    name: form.name.trim().length < 2 ? "Enter your brand name." : form.name.trim().length > 40 ? "Keep it to 40 characters." : undefined,
    handle: handle.ok ? undefined : handle.message,
    description: desc < 40 ? "Write at least 40 characters so shoppers know what you make." : desc > 300 ? "Keep it to 300 characters." : undefined,
    city: form.city.trim().length < 2 ? "Enter the city you work from." : undefined,
  }
  const shown: Partial<typeof errors> = submitted ? errors : {}
  const liveHandleError = form.handle !== saved.handle && !handle.ok && form.handle.length >= 3 ? handle.message : undefined
  const handleError = shown.handle ?? liveHandleError

  const save = useAsyncAction((next: ProfileSettings) => {
    saveProfile(next)
    setForm(next)
    setSubmitted(false)
  })

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!dirty) return
    setSubmitted(true)
    const first = (Object.keys(errors) as (keyof typeof errors)[]).find((k) => errors[k])
    if (first) {
      document.getElementById(`profile-${first}`)?.focus()
      return
    }
    void save.run({ ...form, name: form.name.trim(), handle: form.handle.trim(), description: form.description.trim(), city: form.city.trim() })
  }

  return (
    <Panel id="profile" title="Brand profile" description="How your brand appears across the marketplace and on your storefront.">
      <form noValidate onSubmit={submit}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field id="profile-name" label="Brand name" error={shown.name}>
            <Input {...control("profile-name", shown.name)} value={form.name} onChange={(e) => set("name", e.target.value)} className={inputClass} maxLength={48} autoComplete="organization" />
          </Field>

          <Field
            id="profile-handle"
            label="Handle"
            error={handleError}
            hint={
              form.handle === saved.handle ? (
                "Your current storefront address."
              ) : handle.ok ? (
                <span className="inline-flex items-center gap-1.5 text-violet"><Check className="size-3" aria-hidden /> Available</span>
              ) : undefined
            }
          >
            <InputGroup className="h-11 md:h-9">
              <InputGroupAddon>
                <InputGroupText className="text-ink-3">/brands/</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                {...control("profile-handle", handleError, true)}
                value={form.handle}
                onChange={(e) => set("handle", e.target.value.toLowerCase().replace(/\s+/g, "-"))}
                autoComplete="off"
                spellCheck={false}
                maxLength={32}
                className="pl-0"
              />
            </InputGroup>
          </Field>

          <Field id="profile-category" label="Main category">
            <Select value={form.category} onValueChange={(v) => set("category", v as CategorySlug)}>
              <SelectTrigger id="profile-category" className={selectClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {categories.map((c) => (
                  <SelectItem key={c.slug} value={c.slug}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field
            id="profile-currency"
            label="Currency"
            hint={
              form.currency !== saved.currency
                ? "Prices you've set stay as they are; edit them on each product."
                : saved.currency !== live.currency
                  ? `Saved. Prices, payouts and reports stay in ${live.currency} until the backend is connected.`
                  : "Used for prices, payouts and reports."
            }
          >
            <Select value={form.currency} onValueChange={(v) => set("currency", v as ProfileSettings["currency"])}>
              <SelectTrigger id="profile-currency" aria-describedby="profile-currency-hint" className={selectClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {currencyOptions.map((c) => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field id="profile-city" label="City" error={shown.city}>
            <Input {...control("profile-city", shown.city)} value={form.city} onChange={(e) => set("city", e.target.value)} className={inputClass} maxLength={48} autoComplete="address-level2" />
          </Field>

          <Field id="profile-country" label="Country" hint="Sets your domestic shipping zone and payout options.">
            <Select value={form.country} onValueChange={(v) => set("country", v as CountryCode)}>
              <SelectTrigger id="profile-country" aria-describedby="profile-country-hint" className={selectClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {countryOptions.map((c) => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field id="profile-description" label="Description" className="md:col-span-2" error={shown.description} hint={`${desc}/300`}>
            <Textarea {...control("profile-description", shown.description, true)} value={form.description} onChange={(e) => set("description", e.target.value)} rows={3} maxLength={320} />
          </Field>
        </div>
        {pendingFields.length ? (
          <p className="mt-4 flex gap-2 rounded-md border border-line-soft bg-surface/60 p-3 text-xs text-ink-2">
            <Info className="mt-0.5 size-3.5 shrink-0 text-ink-3" aria-hidden />
            <span>
              Your saved {listFields(pendingFields)} {pendingFields.length > 1 ? "are" : "is"} kept here in Settings. The rest of Studio and your storefront still show {live.name}
              {saved.currency !== live.currency ? ` in ${live.currency}` : ""} until the backend is connected.
            </span>
          </p>
        ) : null}
        <SaveRow
          dirty={dirty}
          savedAt={savedAt}
          onDiscard={() => {
            setForm(saved)
            setSubmitted(false)
          }}
          saveLabel="Save profile"
          pending={save.pending}
          succeeded={save.succeeded}
        />
      </form>
    </Panel>
  )
}

/* ---------- Payouts ---------- */

function PayoutsSection() {
  const profile = useBrandSettings((s) => s.profile)
  const payout = useBrandSettings((s) => s.payout)
  const savedAt = useBrandSettings((s) => s.savedAt.payouts)
  const saveSchedule = useBrandSettings((s) => s.saveSchedule)
  const [schedule, setSchedule] = useState<PayoutSchedule>(payout.schedule)
  const [changing, setChanging] = useState(false)
  const a = payout.account
  // What the Payouts page pays into today. A change saved here stays pending until the backend verifies it.
  const onFile = accountOnFile()
  const mismatch = a.country !== profile.country
  const save = useAsyncAction((next: PayoutSchedule) => saveSchedule(next))
  // A real brand's account lives on the server (the ledger pays into it); the demo brand keeps the browser sample.
  const member = useServerSession((s) => s.brand)
  const live = !!member && !member.demo

  return (
    <Panel id="payouts" title="Payouts" description="Where your earnings go and how often. We never see or store the full account number in Studio.">
      {live && member ? <LivePayoutAccount brandId={member.brand.id} role={member.role} fallbackCountry={profile.country} /> : <>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 rounded-md border border-line-soft bg-surface/60 p-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
        <span className="inline-flex size-9 items-center justify-center rounded-full border border-line"><Landmark className="size-4 text-ink-2" aria-hidden /></span>
        <div className="min-w-0">
          <p className="text-sm text-ink">
            {providerLabel[a.provider]} to {a.bankName} <span className="tabular">•••• {a.last4}</span>
          </p>
          <p className="mt-0.5 truncate text-xs text-ink-2">{a.accountName}, {countries[a.country].name}</p>
          {a.status === "pending" && a.changedAt ? (
            <p className="mt-1 text-xs text-ink-3">
              Saved here {formatDateTime(a.changedAt)} UTC. It stays pending until the backend is connected and {providerLabel[a.provider]} confirms the name. Until then payouts keep going to {onFile.bankName} <span className="tabular">•••• {onFile.last4}</span>.
            </p>
          ) : null}
        </div>
        {a.status === "verified" ? (
          <span className="col-start-2 inline-flex items-center gap-1.5 text-xs text-ink-2 sm:col-start-auto"><ShieldCheck className="size-3.5 text-violet" aria-hidden /> Verified</span>
        ) : (
          <StatusBadge tone="attention" className="col-start-2 w-fit sm:col-start-auto">Pending verification</StatusBadge>
        )}
      </div>

      {mismatch ? <p className="mt-3 text-xs text-acid">Your saved profile country is {countries[profile.country].name}. Add a payout account there before the change goes live.</p> : null}

      <AnimatePresence initial={false} mode="wait">
        {changing ? (
          <motion.div key="form" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: duration.dropdown, ease: ease.out }}>
            <AccountForm country={profile.country} onDone={() => setChanging(false)} />
          </motion.div>
        ) : (
          <motion.div key="button" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: duration.hover }} className="mt-3">
            <Button type="button" size="sm" variant="secondary" onClick={() => setChanging(true)}>
              {mismatch ? "Add an account" : "Change payout account"}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
      </>}

      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          if (schedule !== payout.schedule) void save.run(schedule)
        }}
        className="mt-5 border-t border-line-soft pt-5"
      >
        <Field id="payout-schedule" label="Payout schedule" hint="Automatic payouts send your available balance once the backend is connected. Until then, request a payout any time from Payouts." className="max-w-sm">
          <Select value={schedule} onValueChange={(v) => setSchedule(v as PayoutSchedule)}>
            <SelectTrigger id="payout-schedule" aria-describedby="payout-schedule-hint" className={selectClass}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              {(Object.keys(scheduleLabel) as PayoutSchedule[]).map((s) => (
                <SelectItem key={s} value={s}>{scheduleLabel[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <SaveRow dirty={schedule !== payout.schedule} savedAt={savedAt} onDiscard={() => setSchedule(payout.schedule)} saveLabel="Save schedule" pending={save.pending} succeeded={save.succeeded} />
      </form>
    </Panel>
  )
}

const needsReauth = (e: unknown) => e instanceof ApiError && e.status === 403 && e.fields?.reauth === "required"

function countryFor(currency: string | undefined, fallback: CountryCode): CountryCode {
  if (!currency || countries[fallback].currency === currency) return fallback
  const hit = (Object.keys(countries) as CountryCode[]).find((c) => countries[c].currency === currency)
  return hit ?? fallback
}

type LiveAccountSave = { currency: string; onSaved: () => Promise<unknown> }

/** A real brand's payout account: read from and saved to the ledger (PUT /api/studio/payouts/account). */
function LivePayoutAccount({ brandId, role, fallbackCountry }: { brandId: string; role: string; fallbackCountry: CountryCode }) {
  const financeView = role === "owner" || role === "admin" || role === "finance"
  const owner = role === "owner"
  // The same cache entry as the Payouts page and the sidebar card, so a save here updates both.
  const summary = useApi<PayoutSummaryDto>(financeView ? `studio.payouts:${brandId}` : null, () => api<PayoutSummaryDto>("/api/studio/payouts"), { revalidateOnFocus: true })
  const [changing, setChanging] = useState(false)
  // Arriving from claiming a founding brand (/auth/claim): selling starts once this account is saved.
  const justClaimed = useSearchParam("claimed") === "1"

  if (!financeView) return <p className="text-sm text-ink-2">Only the owner, admins and finance can see where payouts go.</p>
  if (!summary.data) {
    return summary.error ? (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2.5 text-sm text-danger">
        <span>{errorMessage(summary.error, "Couldn't load your payout account.")}</span>
        <Button type="button" size="sm" variant="secondary" onClick={() => void summary.revalidate()}>Try again</Button>
      </div>
    ) : (
      <span aria-hidden className="grid gap-1.5 rounded-md border border-line-soft p-3">
        <Bone className="h-3.5 w-56" />
        <Bone className="h-3 w-40" />
      </span>
    )
  }

  const a = summary.data.account
  const country = a && a.country in countries ? (a.country as CountryCode) : countryFor(summary.data.currency, fallbackCountry)
  const cooldownUntil = summary.data.rules.cooldownUntil

  return (
    <>
      {justClaimed && !a ? (
        <div role="status" className="mb-3 flex items-start gap-2.5 rounded-md border border-violet/40 bg-violet/[0.08] p-3">
          <Info className="mt-0.5 size-4 shrink-0 text-violet" aria-hidden />
          <p className="min-w-0 text-sm text-ink-2">
            <span className="text-ink">Your store is yours.</span> Add your payout account to start selling: shoppers can see your pieces now, and Buy turns on as soon as it&apos;s saved.
          </p>
        </div>
      ) : null}
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 rounded-md border border-line-soft bg-surface/60 p-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
        <span className="inline-flex size-9 items-center justify-center rounded-full border border-line"><Landmark className="size-4 text-ink-2" aria-hidden /></span>
        <div className="min-w-0">
          {a ? (
            <>
              <p className="text-sm text-ink">
                {a.bankName} <span className="tabular">•••• {a.accountLast4}</span>
              </p>
              <p className="mt-0.5 truncate text-xs text-ink-2">{a.accountName}, {a.country in countries ? countries[a.country as CountryCode].name : a.country}, paid in {a.currency}</p>
              {cooldownUntil ? <p className="mt-1 text-xs text-ink-3">Changed recently. Payout requests reopen after {new Date(cooldownUntil).toLocaleString("en-GB")}.</p> : null}
            </>
          ) : (
            <>
              <p className="text-sm text-ink">No payout account yet</p>
              <p className="mt-0.5 text-xs text-ink-2">Add the bank account your earnings should go to. Payout requests open once it&apos;s saved.</p>
            </>
          )}
        </div>
        {a ? (
          a.recipientProvider === "stub" ? (
            <StatusBadge tone="muted" className="col-start-2 w-fit sm:col-start-auto">Test account</StatusBadge>
          ) : a.verified ? (
            <span className="col-start-2 inline-flex items-center gap-1.5 text-xs text-ink-2 sm:col-start-auto"><ShieldCheck className="size-3.5 text-violet" aria-hidden /> Verified</span>
          ) : (
            <StatusBadge tone="attention" className="col-start-2 w-fit sm:col-start-auto">Pending verification</StatusBadge>
          )
        ) : null}
      </div>

      <AnimatePresence initial={false} mode="wait">
        {changing ? (
          <motion.div key="form" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: duration.dropdown, ease: ease.out }}>
            <AccountForm country={country} onDone={() => setChanging(false)} live={{ currency: countries[country].currency, onSaved: () => summary.revalidate() }} />
          </motion.div>
        ) : owner ? (
          <motion.div key="button" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: duration.hover }} className="mt-3">
            <Button type="button" size="sm" variant="secondary" onClick={() => setChanging(true)}>
              {a ? "Change payout account" : "Add an account"}
            </Button>
          </motion.div>
        ) : (
          <motion.p key="note" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-3 text-xs text-ink-3">Only the brand owner can add or change the payout account.</motion.p>
        )}
      </AnimatePresence>
    </>
  )
}

function AccountForm({ country, onDone, live }: { country: CountryCode; onDone: () => void; live?: LiveAccountSave }) {
  const saveAccount = useBrandSettings((s) => s.saveAccount)
  const onFile = accountOnFile()
  const providers = providersFor(country)
  const banks = banksFor[country]
  const [provider, setProvider] = useState<PayoutProvider>(providers[0])
  const [bank, setBank] = useState("")
  const [number, setNumber] = useState("")
  const [holder, setHolder] = useState("")
  const [submitted, setSubmitted] = useState(false)
  const [confirming, setConfirming] = useState(false)
  // Live: the server asks for the password again before a bank change (403 with fields.reauth).
  const [reauth, setReauth] = useState(false)
  const [password, setPassword] = useState("")
  const [liveError, setLiveError] = useState<string | null>(null)
  // Escape returns to Review change; after saving, the form closes and the payouts section takes focus.
  const confirmFocus = useFocusReturn(() => document.querySelector<HTMLElement>("#payouts button"))

  const errors = {
    bank: bank.trim().length < 2 ? (banks ? "Choose your bank." : "Enter your bank's name.") : undefined,
    number: accountNumberError(number, country),
    holder: holder.trim().length < 2 ? "Enter the name on the account, exactly as your bank has it." : undefined,
  }
  const shown: Partial<typeof errors> = submitted ? errors : {}
  const clean = number.replace(/\s/g, "")

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitted(true)
    const first = (Object.keys(errors) as (keyof typeof errors)[]).find((k) => errors[k])
    if (first) {
      document.getElementById(`account-${first}`)?.focus()
      return
    }
    setConfirming(true)
  }

  // The panel above shows the new account as pending once it's saved: that is the confirmation.
  const change = useAsyncAction(
    async () => {
      if (!live) return saveAccount({ provider, country, bankName: bank.trim(), accountName: holder.trim().toUpperCase(), last4: clean.slice(-4).toUpperCase() })
      if (reauth && !password) throw new Error("password")
      setLiveError(null)
      if (reauth) await api("/api/auth/reauth", { query: { as: "brand" }, body: { password } })
      await api("/api/studio/payouts/account", {
        method: "PUT",
        body: { country, currency: live.currency, bankCode: bankCodeFor(country, bank.trim()), bankName: bank.trim(), accountName: holder.trim(), accountNumber: clean },
      })
      await live.onSaved()
    },
    {
      errorToast: !live,
      onError: (cause) => {
        if (!live) return
        if (cause instanceof Error && cause.message === "password") {
          setLiveError("Enter your Studio password to confirm.")
          document.getElementById("account-password")?.focus()
        } else if (needsReauth(cause)) {
          setReauth(true)
          setPassword("")
          setLiveError("Confirm it's you: enter your Studio password, then save again.")
          window.setTimeout(() => document.getElementById("account-password")?.focus(), 0)
        } else setLiveError(errorMessage(cause, "The account wasn't saved. Check your connection and try again."))
      },
      onSuccess: () => {
        if (live) toast.success("Payout account saved", { description: "Payout requests pause for 24 hours after a change, which protects you if someone else made it." })
        setConfirming(false)
        onDone()
      },
    },
  )

  return (
    <form noValidate onSubmit={submit} className="mt-4 grid gap-4 rounded-md border border-line-soft p-4">
      <div>
        <p className="text-sm text-ink">New payout account in {countries[country].name}</p>
        <p className="mt-0.5 text-xs text-ink-2">{live ? `Paid out in ${live.currency} by bank transfer to an account in your name or your company's.` : providers.length > 1 ? "Paid out through a local payment provider to your bank account." : "Paid out by bank transfer to an account in your name or your company's."}</p>
      </div>

      {providers.length > 1 && !live ? (
        <fieldset className="grid gap-1.5">
          <legend className="mb-1.5 text-[13px] font-medium text-ink">Provider</legend>
          <Segmented<PayoutProvider> id="account-provider" label="Provider" value={provider} onChange={setProvider} options={providers.map((p) => ({ value: p, label: providerLabel[p] }))} className="sm:w-fit" />
        </fieldset>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Field id="account-bank" label="Bank" error={shown.bank}>
          {banks ? (
            <Select value={bank} onValueChange={setBank}>
              <SelectTrigger {...control("account-bank", shown.bank)} className={selectClass}>
                <SelectValue placeholder="Choose your bank" />
              </SelectTrigger>
              <SelectContent position="popper">
                {banks.map((b) => (
                  <SelectItem key={b} value={b}>{b}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input {...control("account-bank", shown.bank)} value={bank} onChange={(e) => setBank(e.target.value)} className={inputClass} autoComplete="off" />
          )}
        </Field>
        <Field id="account-number" label={accountNumberLabel(country)} error={shown.number}>
          <Input {...control("account-number", shown.number)} value={number} onChange={(e) => setNumber(e.target.value)} className={cn(inputClass, "tabular")} inputMode={providers.length > 1 ? "numeric" : "text"} autoComplete="off" spellCheck={false} />
        </Field>
        <Field id="account-holder" label="Name on the account" error={shown.holder} hint="It must match your verified business or owner name." className="md:col-span-2">
          <Input {...control("account-holder", shown.holder, true)} value={holder} onChange={(e) => setHolder(e.target.value)} className={inputClass} autoComplete="off" />
        </Field>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
        <Button type="submit" size="sm" variant="secondary">Review change</Button>
      </div>

      <Dialog
        open={confirming}
        onOpenChange={(o) => {
          if (change.pending) return
          setConfirming(o)
          if (!o) setLiveError(null)
        }}
      >
        <DialogContent className="sm:max-w-[440px]" {...confirmFocus}>
          <DialogHeader>
            <DialogTitle>{live ? "Save this payout account?" : "Change your payout account?"}</DialogTitle>
            {live ? (
              <DialogDescription>
                The payment provider checks the account with your bank, then payouts go to it. Payout requests pause for 24 hours after a change, which protects you if someone else made it.
              </DialogDescription>
            ) : (
            <DialogDescription>
              The new account is saved here in Settings as pending. Once the backend is connected, {providerLabel[provider]} confirms the name and payouts move to it, after a 48-hour pause that protects you if someone else made the change. Until then payouts keep going to {onFile.bankName} <span className="tabular">•••• {onFile.last4}</span>.
            </DialogDescription>
            )}
          </DialogHeader>
          <dl className="grid gap-2 rounded-lg border border-white/10 p-3 text-sm">
            {live ? null : <div className="flex justify-between gap-4"><dt className="text-ink-2">Provider</dt><dd className="text-ink">{providerLabel[provider]}</dd></div>}
            <div className="flex justify-between gap-4"><dt className="text-ink-2">Bank</dt><dd className="text-right text-ink">{bank}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-ink-2">Account</dt><dd className="text-ink tabular">•••• {clean.slice(-4).toUpperCase()}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-ink-2">Name</dt><dd className="text-right text-ink">{live ? holder.trim() : holder.trim().toUpperCase()}</dd></div>
          </dl>
          {live && reauth ? (
            <Field id="account-password" label="Your password">
              <Input {...control("account-password")} type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} autoComplete="current-password" />
            </Field>
          ) : null}
          {liveError ? <p role="alert" className="text-sm text-danger">{liveError}</p> : null}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setConfirming(false)} disabled={change.pending}>Back</Button>
            <Button type="button" variant="primary" onClick={() => void change.run()} loading={change.pending}>{live ? "Save account" : "Save as pending"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  )
}

/** The signed-in member's own name and email (their Yard account, shared with shopping). */
function YourAccountSection() {
  const member = useServerSession((s) => s.brand)
  return (
    <Panel id="account" title="Your account" description="Your own name and sign-in email. They're yours, not the brand's: the same account you shop with.">
      {member ? <AccountDetails as="brand" /> : <p className="text-sm text-ink-2">Sign in to Studio to change your name or email.</p>}
    </Panel>
  )
}

/** Yard Support: the brand's thread with the Yard team. */
function HelpSection() {
  return (
    <Panel id="help" title="Help" description="Questions about selling on Yard, your storefront, orders or payouts. Message @support and a person on the Yard team replies in Studio.">
      <Button asChild variant="primary" size="sm">
        <Link href="/studio/support">Contact Yard Support</Link>
      </Button>
    </Panel>
  )
}
