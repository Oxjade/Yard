"use client"

import { useEffect, useMemo, useState } from "react"
import { motion } from "motion/react"
import { CalendarXIcon, PlusIcon, TrashIcon, TruckIcon, WarningCircleIcon } from "@phosphor-icons/react"
import { toast } from "sonner"
import { PageHeader } from "@/components/dashboard/page-header"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { Bone } from "@/components/feedback/skeletons"
import { SessionGate } from "@/components/session/session-gate"
import { SaveRow } from "@/components/studio/business/settings-parts"
import { Field, FieldMessage, Panel, control, inputClass, selectClass } from "@/components/studio/catalog/fields"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { countries, countryCodes, currencies, type CountryCode, type CurrencyCode } from "@/config/markets"
import { useNow } from "@/hooks/use-now"
import type { StudioShippingDto } from "@/lib/api/contracts/shipping"
import { errorMessage, fieldErrors } from "@/lib/api/errors"
import { getStudioShipping, saveStudioShipping, STUDIO_SHIPPING_KEY } from "@/lib/api/shipping"
import { useApi } from "@/lib/api/use-api"
import { spring } from "@/lib/motion"
import { roleCantSentence } from "@/lib/permissions"
import { useServerSession } from "@/lib/session/use-server-session"
import { formatDay, formatRange } from "@/lib/shipping/format"
import { cn } from "@/lib/utils"
import { countriesLabel, DAYS, freeCountries, fromDto, newKey, previewEstimate, serviceName, toBody, validate, type MethodForm, type ShippingForm, type ZoneForm } from "./model"

const sections = [
  { id: "dispatch", label: "Dispatch" },
  { id: "handling", label: "Handling time" },
  { id: "zones", label: "Zones & rates" },
  { id: "holidays", label: "Holidays & closures" },
  { id: "providers", label: "Delivery providers" },
] as const

export const shippingDescription = "How long you take to dispatch, where you ship and what it costs. Product pages, the bag and checkout estimate delivery from these settings."

/** /studio/shipping (§6.5). Server-backed: a brand session is needed to read it, shipping.manage to change it. */
export function ShippingView() {
  return (
    <div className="grid gap-6">
      <PageHeader title="Shipping & fulfilment" description={shippingDescription} />
      <SessionGate surface="studio" feature="Shipping & fulfilment">
        <ShippingSettings />
      </SessionGate>
    </div>
  )
}

function ShippingSettings() {
  const brandId = useServerSession((s) => s.brand?.brand.id ?? null)
  const q = useApi<StudioShippingDto>(brandId ? `${STUDIO_SHIPPING_KEY}:${brandId}` : null, () => getStudioShipping(), { revalidateOnFocus: false })
  if (!q.data && q.error) {
    return (
      <div role="alert" className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-line px-6 py-14 text-center">
        <span className="inline-flex size-11 items-center justify-center rounded-full border border-line">
          <WarningCircleIcon className="size-5 text-ink-2" aria-hidden />
        </span>
        <div>
          <p className="text-base text-ink">Couldn&apos;t load your shipping settings.</p>
          <p className="mt-1 text-sm text-ink-2">{errorMessage(q.error, "Yard's server didn't answer. Check your connection, then try again.")} Nothing can be saved until they load.</p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="secondary" onClick={() => void q.revalidate()} loading={q.isValidating}>
            Retry
          </Button>
          <Button variant="primary" disabled>
            Save
          </Button>
        </div>
      </div>
    )
  }
  if (!q.data) return <ShippingSkeleton />
  return <ShippingForm key={`${q.data.brand.id}:${q.data.profile.updatedAt}`} data={q.data} onSaved={(d) => q.mutate(d)} />
}

/** The page while it loads: a skeleton per section and a disabled Save. */
function ShippingSkeleton() {
  return (
    <div role="status" aria-label="Loading your shipping settings" className="grid items-start gap-6 xl:grid-cols-[180px_minmax(0,1fr)_300px]">
      <ul className="hidden gap-0.5 xl:grid" aria-hidden>
        {sections.map((s) => (
          <li key={s.id} className="flex h-9 items-center px-3 text-sm text-ink-3">
            {s.label}
          </li>
        ))}
      </ul>
      <div className="grid gap-6" aria-hidden>
        {sections.map((s) => (
          <div key={s.id} className="rounded-lg border border-line-soft bg-card p-4 md:p-5">
            <p className="text-sm text-ink-3">{s.label}</p>
            <Bone className="mt-2 h-3 w-64 max-w-full" />
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <Bone className="h-10" />
              <Bone className="h-10" />
            </div>
          </div>
        ))}
        <div className="flex justify-end">
          <Button variant="primary" disabled>
            Save
          </Button>
        </div>
      </div>
      <Bone className="hidden h-44 rounded-lg xl:block" />
    </div>
  )
}

function ShippingForm({ data, onSaved }: { data: StudioShippingDto; onSaved: (d: StudioShippingDto) => void }) {
  const session = useServerSession((s) => s.brand)
  const canManage = !!session?.permissions.includes("shipping.manage")
  const cur = data.profile.currency as CurrencyCode
  const symbol = currencies[cur].symbol
  const initial = useMemo(() => fromDto(data), [data])
  const [form, setForm] = useState<ShippingForm>(initial)
  const [submitted, setSubmitted] = useState(false)
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const [active, setActive] = useState<(typeof sections)[number]["id"]>("dispatch")

  const dirty = JSON.stringify(form) !== JSON.stringify(initial)
  const localErrors = validate(form, cur)
  const errors: Record<string, string> = { ...(submitted ? localErrors : {}), ...serverErrors }
  const err = (path: string) => errors[path]
  const disabled = !canManage || saving

  useEffect(() => {
    const els = sections.map((s) => document.getElementById(s.id)).filter((el): el is HTMLElement => !!el)
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (hit) setActive(hit.target.id as typeof active)
      },
      { rootMargin: "-20% 0px -65% 0px" },
    )
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])

  function update(patch: Partial<ShippingForm>) {
    setForm((f) => ({ ...f, ...patch }))
    setServerErrors({})
  }
  function updateZone(i: number, patch: Partial<ZoneForm>) {
    setForm((f) => ({ ...f, zones: f.zones.map((z, j) => (j === i ? { ...z, ...patch } : z)) }))
    setServerErrors({})
  }
  function updateMethod(i: number, k: number, patch: Partial<MethodForm>) {
    setForm((f) => ({ ...f, zones: f.zones.map((z, j) => (j === i ? { ...z, methods: z.methods.map((m, n) => (n === k ? { ...m, ...patch } : m)) } : z)) }))
    setServerErrors({})
  }

  function jump(id: string) {
    setActive(id as typeof active)
    document.getElementById(id)?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" })
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!dirty || saving || !canManage) return
    setSubmitted(true)
    const first = Object.keys(localErrors)[0]
    if (first) {
      document.getElementById(`f-${first}`)?.focus()
      return
    }
    setSaving(true)
    try {
      const next = await saveStudioShipping(toBody(form, cur))
      setSubmitted(false)
      setServerErrors({})
      setJustSaved(true)
      toast.success("Saved — product pages and checkout now use these settings.")
      onSaved(next)
    } catch (err) {
      const f = fieldErrors(err)
      setServerErrors(f)
      toast.error(errorMessage(err, "Your shipping settings weren't saved. Check your connection and try again."))
      const key = Object.keys(f)[0]
      if (key) document.getElementById(`f-${key}`)?.focus()
    } finally {
      setSaving(false)
    }
  }

  const summary = Object.keys(errors).length
  return (
    <form noValidate onSubmit={save} className="grid items-start gap-6 xl:grid-cols-[180px_minmax(0,1fr)_300px]">
      <nav aria-label="Shipping sections" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] xl:sticky xl:top-24 xl:mx-0 xl:overflow-visible xl:px-0">
        <ul className="flex min-w-max gap-1.5 xl:grid xl:min-w-0 xl:gap-0.5">
          {sections.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                onClick={(e) => {
                  e.preventDefault()
                  jump(s.id)
                }}
                aria-current={active === s.id ? "true" : undefined}
                className={cn(
                  "relative inline-flex h-10 items-center rounded-full border px-3 text-xs transition-colors xl:flex xl:h-9 xl:rounded-md xl:border-0 xl:text-sm",
                  active === s.id ? "border-purple bg-purple/20 text-ink xl:bg-transparent" : "border-line text-ink-2 hover:text-ink",
                )}
              >
                {active === s.id ? <motion.span layoutId="shipping-nav" aria-hidden className="absolute inset-y-1.5 left-0 hidden w-0.5 rounded-full bg-purple xl:block" transition={spring.indicator} /> : null}
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="grid min-w-0 gap-6">
        {!canManage && session ? (
          <p role="status" className="rounded-lg border border-line-soft bg-surface px-4 py-3 text-sm text-ink-2">
            {roleCantSentence(session.role, "shipping.manage")} You can read these settings.
          </p>
        ) : null}
        {submitted && summary ? (
          <p role="alert" className="rounded-lg border border-danger/40 bg-danger/5 px-4 py-3 text-sm text-ink">
            {summary === 1 ? "One field needs attention." : `${summary} fields need attention.`}
          </p>
        ) : null}

        <Panel id="dispatch" title="Dispatch" description="Where your parcels leave from. Shoppers see the city, never your address.">
          <fieldset disabled={disabled} className="grid gap-4 md:grid-cols-2">
            <Field id="f-originCountry" label="Ships from" error={err("originCountry")}>
              <Select value={form.originCountry} onValueChange={(v) => update({ originCountry: v as CountryCode })} disabled={disabled}>
                <SelectTrigger {...control("f-originCountry", err("originCountry"))} className={selectClass}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" className="max-h-72">
                  {countryCodes.map((c) => (
                    <SelectItem key={c} value={c}>
                      {countries[c].name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field id="f-originCity" label="City" error={err("originCity")}>
              <Input {...control("f-originCity", err("originCity"))} value={form.originCity} onChange={(e) => update({ originCity: e.target.value })} maxLength={60} className={inputClass} />
            </Field>
            <div className="grid gap-3 md:col-span-2">
              <div className="flex items-start gap-3">
                <Switch id="f-localPickup" checked={form.localPickup} onCheckedChange={(v) => update({ localPickup: v, pickupLocationId: v ? (form.pickupLocationId ?? data.pickupOptions[0]?.id ?? null) : form.pickupLocationId })} disabled={disabled || !data.pickupOptions.length} className="mt-0.5" />
                <Label htmlFor="f-localPickup" className="grid gap-0.5 font-normal">
                  <span className="text-sm text-ink">Free pickup from your store</span>
                  <span className="text-xs text-ink-3">
                    {data.pickupOptions.length ? "Offered to shoppers in the same city as the store, free, once the parcel is packed." : "Publish a store or showroom in Locations to offer pickup."}
                  </span>
                </Label>
              </div>
              {form.localPickup ? (
                <Field id="f-pickupLocationId" label="Pickup point" error={err("pickupLocationId")} hint="Only your published, approved stores and showrooms.">
                  <Select value={form.pickupLocationId ?? ""} onValueChange={(v) => update({ pickupLocationId: v || null })} disabled={disabled}>
                    <SelectTrigger {...control("f-pickupLocationId", err("pickupLocationId"), true)} className={selectClass}>
                      <SelectValue placeholder="Choose a store or showroom" />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      {data.pickupOptions.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}, {p.area}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              ) : null}
            </div>
          </fieldset>
        </Panel>

        <Panel id="handling" title="Handling time" description="Business days from an order to handing the parcel over. Weekends you don't ship on, public holidays and your closures don't count.">
          <fieldset disabled={disabled} className="grid gap-5">
            <div className="grid gap-1.5">
              <span className="text-[13px] text-ink">Dispatch within</span>
              <div className="flex flex-wrap items-center gap-2">
                <Input {...control("f-handlingMin", err("handlingMin"))} aria-label="Fewest business days" value={form.handlingMin} onChange={(e) => update({ handlingMin: e.target.value })} inputMode="numeric" className={cn(inputClass, "w-20 text-center tabular")} />
                <span className="text-ink-3">to</span>
                <Input {...control("f-handlingMax", err("handlingMax"))} aria-label="Most business days" value={form.handlingMax} onChange={(e) => update({ handlingMax: e.target.value })} inputMode="numeric" className={cn(inputClass, "w-20 text-center tabular")} />
                <span className="text-sm text-ink-2">business days</span>
              </div>
              <FieldMessage id="f-handlingMax" error={err("handlingMin") ?? err("handlingMax")} hint="Shoppers see “Usually dispatches in…” with these numbers." />
            </div>
            <Field id="f-cutoffLocal" label="Order cutoff" error={err("cutoffLocal")} hint={`Orders after this time (${data.profile.timeZone.split("/").pop()?.replace(/_/g, " ")} time) count from the next business day.`} className="max-w-48">
              <Input {...control("f-cutoffLocal", err("cutoffLocal"), true)} type="time" value={form.cutoffLocal} onChange={(e) => update({ cutoffLocal: e.target.value })} className={cn(inputClass, "tabular")} />
            </Field>
            <fieldset className="grid gap-1.5">
              <legend id="f-workdays" tabIndex={-1} className="mb-1.5 text-[13px] text-ink outline-none">
                Ships on
              </legend>
              <div className="flex flex-wrap gap-1.5">
                {DAYS.map((d, i) => {
                  const on = !!(form.workdays & (1 << i))
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={on}
                      disabled={disabled}
                      onClick={() => update({ workdays: form.workdays ^ (1 << i) })}
                      className={cn("inline-flex h-10 min-w-12 items-center justify-center rounded-md border px-3 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-violet disabled:opacity-60", on ? "border-purple bg-purple/20 text-ink" : "border-line text-ink-2 hover:text-ink")}
                    >
                      {d}
                    </button>
                  )
                })}
              </div>
              <FieldMessage id="f-workdays" error={err("workdays")} />
            </fieldset>
          </fieldset>
        </Panel>

        <Panel id="zones" title="Zones & rates" description={`Prices per order to your brand, in ${cur}. The first zone that lists a country prices it; International covers every market no other zone does.`}>
          <fieldset disabled={disabled} className="grid gap-3">
            {err("zones") ? (
              <p id="f-zones" tabIndex={-1} role="alert" className="text-xs text-danger outline-none">
                {err("zones")}
              </p>
            ) : null}
            {form.zones.map((z, i) => (
              <ZoneEditor key={z.key} zone={z} index={i} zones={form.zones} symbol={symbol} disabled={disabled} err={err} onZone={(p) => updateZone(i, p)} onMethod={(k, p) => updateMethod(i, k, p)} onRemove={z.kind === "custom" ? () => update({ zones: form.zones.filter((_, j) => j !== i) }) : undefined} />
            ))}
            {canManage && freeCountries(form.zones, -1).length ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="w-fit"
                onClick={() =>
                  update({
                    zones: [
                      ...form.zones.filter((z) => z.kind !== "international"),
                      {
                        key: newKey("z"),
                        name: `Custom zone ${form.zones.filter((z) => z.kind === "custom").length + 1}`,
                        kind: "custom",
                        countries: [],
                        enabled: true,
                        methods: [{ service: "standard", label: "Standard", enabled: true, transitMin: "3", transitMax: "7", price: "0", freeOver: "", carrierLabel: null, extraRates: [] }],
                      },
                      ...form.zones.filter((z) => z.kind === "international"),
                    ],
                  })
                }
              >
                <PlusIcon /> Add a custom zone
              </Button>
            ) : null}
          </fieldset>
        </Panel>

        <Panel id="holidays" title="Holidays & closures" description={`${countries[data.profile.originCountry as CountryCode]?.name ?? data.profile.originCountry}'s public holidays don't count as dispatch days. Add closures for days your studio is shut.`}>
          <div className="grid gap-5">
            <div>
              <h3 className="text-[13px] font-medium text-ink">Public holidays</h3>
              {data.holidays.length ? (
                <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                  {data.holidays.slice(0, 16).map((h) => (
                    <li key={`${h.date}-${h.name}`} className="flex min-h-7 items-center gap-2 text-sm">
                      <span className="w-24 shrink-0 text-ink-2 tabular">{formatDay(h.date)}</span>
                      <span className="min-w-0 truncate text-ink">{h.name}</span>
                      {h.estimated ? (
                        <StatusBadge tone="muted" className="shrink-0">
                          estimated
                        </StatusBadge>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-ink-2">No upcoming holidays on Yard&apos;s calendar for this country.</p>
              )}
              <p className="mt-2 text-xs text-ink-3">Yard keeps this calendar. Dates marked estimated depend on the moon or an official announcement.</p>
            </div>
            <fieldset disabled={disabled} className="grid gap-2">
              <legend className="mb-1 text-[13px] font-medium text-ink">Your closures</legend>
              {form.closures.length ? (
                <ul className="grid gap-2">
                  {form.closures.map((c, i) => (
                    <li key={c.key} className="grid gap-2 rounded-md border border-line-soft bg-surface/40 p-3 sm:grid-cols-[1fr_1fr_1.4fr_auto] sm:items-start">
                      <Field id={`f-closures.${i}.dateFrom`} label="From" error={err(`closures.${i}.dateFrom`)}>
                        <Input {...control(`f-closures.${i}.dateFrom`, err(`closures.${i}.dateFrom`))} type="date" value={c.dateFrom} onChange={(e) => update({ closures: form.closures.map((x, j) => (j === i ? { ...x, dateFrom: e.target.value } : x)) })} className={inputClass} />
                      </Field>
                      <Field id={`f-closures.${i}.dateTo`} label="To" error={err(`closures.${i}.dateTo`)}>
                        <Input {...control(`f-closures.${i}.dateTo`, err(`closures.${i}.dateTo`))} type="date" value={c.dateTo} onChange={(e) => update({ closures: form.closures.map((x, j) => (j === i ? { ...x, dateTo: e.target.value } : x)) })} className={inputClass} />
                      </Field>
                      <Field id={`f-closures.${i}.reason`} label="Reason" optional>
                        <Input id={`f-closures.${i}.reason`} value={c.reason} maxLength={80} onChange={(e) => update({ closures: form.closures.map((x, j) => (j === i ? { ...x, reason: e.target.value } : x)) })} className={inputClass} placeholder="Studio move" />
                      </Field>
                      <Button type="button" variant="ghost" size="icon" aria-label={`Remove the closure from ${c.dateFrom || "this date"}`} className="size-10 self-end" onClick={() => update({ closures: form.closures.filter((_, j) => j !== i) })}>
                        <TrashIcon />
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="flex items-center gap-2 text-sm text-ink-2">
                  <CalendarXIcon className="size-4 shrink-0" aria-hidden /> No closures. Every working day counts.
                </p>
              )}
              {canManage && form.closures.length < 20 ? (
                <Button type="button" variant="secondary" size="sm" className="w-fit" onClick={() => update({ closures: [...form.closures, { key: newKey("c"), dateFrom: "", dateTo: "", reason: "" }] })}>
                  <PlusIcon /> Add a closure
                </Button>
              ) : null}
            </fieldset>
          </div>
        </Panel>

        <Panel id="providers" title="Delivery providers" description="Where your rates and estimates come from.">
          <ul className="grid gap-3 text-sm">
            <li className="flex items-start gap-3">
              <TruckIcon className="mt-0.5 size-4 shrink-0 text-violet" aria-hidden />
              <span>
                <span className="text-ink">Manual rates — active.</span> <span className="text-ink-2">Prices and transit times come from the zones above. Never guaranteed: shoppers always see estimates.</span>
              </span>
            </li>
            <li className="flex items-start gap-3">
              <TruckIcon className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
              <span className="text-ink-2">Carrier integrations: none connected. Carrier rates, tracking and labels will plug in here.</span>
            </li>
          </ul>
        </Panel>

        {canManage ? (
          <div className="sticky bottom-0 z-10 -mx-4 border-t border-line-soft bg-obsidian/92 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-xl md:static md:mx-0 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
            <SaveRow
              dirty={dirty}
              savedAt={data.profile.updatedBy ? data.profile.updatedAt : undefined}
              onDiscard={() => {
                setForm(initial)
                setSubmitted(false)
                setServerErrors({})
              }}
              pending={saving}
              succeeded={justSaved && !dirty}
              saveLabel="Save shipping"
            />
          </div>
        ) : null}
      </div>

      <EstimatePreview form={form} data={data} />
    </form>
  )
}

function ZoneEditor({
  zone: z,
  index: i,
  zones,
  symbol,
  disabled,
  err,
  onZone,
  onMethod,
  onRemove,
}: {
  zone: ZoneForm
  index: number
  zones: ZoneForm[]
  symbol: string
  disabled: boolean
  err: (path: string) => string | undefined
  onZone: (p: Partial<ZoneForm>) => void
  onMethod: (k: number, p: Partial<MethodForm>) => void
  onRemove?: () => void
}) {
  const options = freeCountries(zones, i)
  return (
    <div className={cn("grid gap-3 rounded-md border p-3 transition-colors", z.enabled ? "border-line-soft bg-surface/40" : "border-line-soft/60")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Switch id={`f-zones.${i}.enabled`} checked={z.enabled} onCheckedChange={(v) => onZone({ enabled: v })} disabled={disabled} className="mt-0.5" aria-label={`Ship to ${z.name}`} />
          <div className="grid min-w-0 gap-0.5">
            {z.kind === "custom" ? (
              <Input {...control(`f-zones.${i}.name`, err(`zones.${i}.name`))} aria-label="Zone name" value={z.name} maxLength={40} onChange={(e) => onZone({ name: e.target.value })} className="h-9 w-56 max-w-full" />
            ) : (
              <span id={`f-zones.${i}.name`} className={cn("text-sm", z.enabled ? "text-ink" : "text-ink-2")}>
                {z.name}
              </span>
            )}
            <span className="text-xs text-ink-3">{countriesLabel(z.countries)}</span>
            <FieldMessage id={`f-zones.${i}.name`} error={err(`zones.${i}.name`)} />
          </div>
        </div>
        {onRemove ? (
          <Button type="button" variant="ghost" size="sm" onClick={onRemove} disabled={disabled}>
            <TrashIcon /> Remove zone
          </Button>
        ) : null}
      </div>
      {z.kind === "custom" ? (
        <div className="grid gap-1.5">
          <span className="text-xs text-ink-2">Countries</span>
          <div className="flex flex-wrap gap-1.5" id={`f-zones.${i}.countries`} tabIndex={-1}>
            {[...z.countries, ...options.filter((c) => !z.countries.includes(c))].map((c) => {
              const on = z.countries.includes(c)
              return (
                <button key={c} type="button" aria-pressed={on} disabled={disabled} onClick={() => onZone({ countries: on ? z.countries.filter((x) => x !== c) : [...z.countries, c] })} className={cn("inline-flex h-9 items-center rounded-full border px-3 text-xs transition-colors", on ? "border-purple bg-purple/20 text-ink" : "border-line text-ink-2 hover:text-ink")}>
                  {countries[c as CountryCode]?.name ?? c}
                </button>
              )
            })}
          </div>
          <FieldMessage id={`f-zones.${i}.countries`} error={err(`zones.${i}.countries`)} />
        </div>
      ) : null}
      {err(`zones.${i}.methods`) ? (
        <p role="alert" className="text-xs text-danger">
          {err(`zones.${i}.methods`)}
        </p>
      ) : null}
      {z.enabled ? (
        <ul className="grid gap-2">
          {z.methods.map((m, k) => {
            const at = `zones.${i}.methods.${k}`
            return (
              <li key={m.service} className="grid gap-3 border-t border-line-soft pt-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] md:items-start">
                <div className="flex items-start gap-3">
                  <Switch id={`f-${at}.enabled`} checked={m.enabled} onCheckedChange={(v) => onMethod(k, { enabled: v })} disabled={disabled} className="mt-2" aria-label={`Offer ${serviceName[m.service]} to ${z.name}`} />
                  <Field id={`f-${at}.label`} label={serviceName[m.service]} error={err(`${at}.label`)} className="flex-1">
                    <Input {...control(`f-${at}.label`, err(`${at}.label`))} value={m.label} maxLength={40} onChange={(e) => onMethod(k, { label: e.target.value })} disabled={disabled || !m.enabled} className={inputClass} />
                  </Field>
                </div>
                {m.enabled ? (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {m.service !== "pickup" ? (
                      <div className="col-span-2 grid gap-1.5 sm:col-span-1">
                        <span className="text-[13px] text-ink">In transit</span>
                        <div className="flex items-center gap-1.5">
                          <Input {...control(`f-${at}.transitMin`, err(`${at}.transitMin`))} aria-label="Fewest days in transit" value={m.transitMin} onChange={(e) => onMethod(k, { transitMin: e.target.value })} inputMode="numeric" className={cn(inputClass, "w-14 text-center tabular")} />
                          <span className="text-ink-3">to</span>
                          <Input {...control(`f-${at}.transitMax`, err(`${at}.transitMax`))} aria-label="Most days in transit" value={m.transitMax} onChange={(e) => onMethod(k, { transitMax: e.target.value })} inputMode="numeric" className={cn(inputClass, "w-14 text-center tabular")} />
                        </div>
                        <FieldMessage id={`f-${at}.transitMax`} error={err(`${at}.transitMin`) ?? err(`${at}.transitMax`)} hint="Business days" />
                      </div>
                    ) : null}
                    <Field id={`f-${at}.price`} label={`Price (${symbol})`} error={err(`${at}.price`)}>
                      <Input {...control(`f-${at}.price`, err(`${at}.price`))} value={m.price} onChange={(e) => onMethod(k, { price: e.target.value })} inputMode="decimal" className={cn(inputClass, "tabular")} />
                    </Field>
                    {m.service === "standard" ? (
                      <Field id={`f-${at}.freeOver`} label={`Free over (${symbol})`} optional error={err(`${at}.freeOver`)}>
                        <Input {...control(`f-${at}.freeOver`, err(`${at}.freeOver`))} value={m.freeOver} onChange={(e) => onMethod(k, { freeOver: e.target.value })} inputMode="decimal" className={cn(inputClass, "tabular")} />
                      </Field>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-xs text-ink-3 md:pt-8">Not offered to this zone.</p>
                )}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-xs text-ink-3">Shoppers here see &ldquo;Doesn&apos;t ship to {z.kind === "international" ? "their country" : countriesLabel(z.countries)}&rdquo;.</p>
      )}
    </div>
  )
}

/**
 * "An order placed now ships by Tue 10 Nov and is estimated to arrive Thu 12 – Mon 16 Nov in
 * Lagos", from the unsaved form values with the same engine and holidays as the server.
 */
function EstimatePreview({ form, data }: { form: ShippingForm; data: StudioShippingDto }) {
  const now = useNow(60_000)
  const [dest, setDest] = useState<CountryCode>(form.originCountry)
  const p = now === null ? null : previewEstimate(form, data, dest, now)
  const destLabel = (c: CountryCode) => (c === form.originCountry ? form.originCity.trim() || countries[c].name : countries[c].name)
  return (
    <aside aria-labelledby="ship-preview-title" className="rounded-lg border border-line-soft bg-card p-4 md:p-5 xl:sticky xl:top-24">
      <h2 id="ship-preview-title" className="text-sm font-medium text-ink">
        Estimate preview
      </h2>
      <div className="mt-3 text-sm leading-relaxed text-ink-2" aria-live="polite">
        {p === null ? (
          <Bone className="h-16 w-full" />
        ) : p.kind === "estimate" ? (
          <p>
            An order placed now ships by <span className="text-ink">{formatDay(p.shipBy)}</span> and is estimated to arrive <span className="text-ink">{formatRange(p.arrivalFrom, p.arrivalTo)}</span> in {destLabel(dest)}
            {p.service === "express" ? " (express, as standard is off)" : ""}.
          </p>
        ) : p.kind === "unavailable" ? (
          <p className="text-ink">{p.reason}</p>
        ) : (
          <p>Fix the highlighted fields to see an estimate.</p>
        )}
      </div>
      <div className="mt-3 grid gap-1.5">
        <Label htmlFor="ship-preview-dest" className="text-xs text-ink-2">
          Deliver to
        </Label>
        <Select value={dest} onValueChange={(v) => setDest(v as CountryCode)}>
          <SelectTrigger id="ship-preview-dest" className={selectClass}>
            <SelectValue>{destLabel(dest)}</SelectValue>
          </SelectTrigger>
          <SelectContent position="popper" className="max-h-72">
            {countryCodes.map((c) => (
              <SelectItem key={c} value={c}>
                {destLabel(c)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <p className="mt-3 text-xs text-ink-3">Updates as you edit, before you save. Estimates skip weekends and public holidays, and are never guaranteed.</p>
    </aside>
  )
}
