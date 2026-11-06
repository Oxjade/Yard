"use client"

import { useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { PercentIcon as Percent, TrashIcon as Trash2, UserPlusIcon as UserPlus } from "@phosphor-icons/react"
import { toast } from "sonner"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { InfoTip } from "@/components/feedback/info-tip"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { countries, currencies, shippingRatesUsd, type ShippingZone } from "@/config/markets"
import { site } from "@/config/site"
import { convert, formatMoney } from "@/lib/money"
import { spring } from "@/lib/motion"
import { cn } from "@/lib/utils"
import { EMAIL_RE, invitableRoles, parseAmount, roleMeta, toInput } from "./settings-model"
import { SaveRow } from "./settings-parts"
import { useBrandSettings, type ReturnsSettings, type TeamMember, type TeamRole } from "./settings-store"
import { Field, Panel, control, inputClass, selectClass } from "@/components/studio/catalog/fields"
import { Initials } from "./shared"

/* ---------- Shipping ---------- */

type ZoneForm = { zone: ShippingZone; enabled: boolean; standard: string; express: string }
type ShipForm = { min: string; max: string; zones: ZoneForm[]; freeEnabled: boolean; threshold: string }

export function ShippingSection() {
  const profile = useBrandSettings((s) => s.profile)
  const saved = useBrandSettings((s) => s.shipping)
  const savedAt = useBrandSettings((s) => s.savedAt.shipping)
  const saveShipping = useBrandSettings((s) => s.saveShipping)
  const cur = profile.currency
  const symbol = currencies[cur].symbol

  const fromSaved = (): ShipForm => ({
    min: String(saved.processingDays[0]),
    max: String(saved.processingDays[1]),
    zones: saved.zones.map((z) => ({ zone: z.zone, enabled: z.enabled, standard: toInput(z.standard, cur), express: toInput(z.express, cur) })),
    freeEnabled: saved.freeShipping.enabled,
    threshold: toInput(saved.freeShipping.threshold, cur),
  })
  const [form, setForm] = useState<ShipForm>(fromSaved)
  const [base, setBase] = useState(saved)
  const [submitted, setSubmitted] = useState(false)
  // The store converts amounts when the currency changes; follow it.
  if (base !== saved) {
    setBase(saved)
    setForm(fromSaved())
  }

  const dirty = JSON.stringify(form) !== JSON.stringify(fromSaved())
  const min = Number(form.min)
  const max = Number(form.max)
  const whole = (s: string) => /^\d+$/.test(s.trim())

  const zoneLabel: Record<ShippingZone, { title: string; where: string }> = {
    domestic: { title: "Domestic", where: countries[profile.country].name },
    regional: { title: "Regional", where: `Rest of ${countries[profile.country].region}` },
    international: { title: "International", where: "Everywhere else we ship" },
  }

  const zoneErrors = form.zones.map((z) => {
    if (!z.enabled) return {}
    const std = parseAmount(z.standard, cur)
    const exp = z.express.trim() ? parseAmount(z.express, cur) : null
    return {
      standard: std === null ? `Enter a rate in ${cur}, or 0 for free.` : undefined,
      express: z.express.trim() && exp === null ? `Enter a rate in ${cur}, or leave it empty.` : exp !== null && std !== null && exp < std ? "Express should cost at least as much as standard." : undefined,
    }
  })
  const errors = {
    days: !whole(form.min) || !whole(form.max) ? "Use whole days." : min < 1 || max > 30 ? "Use 1 to 30 days." : min > max ? "The first number should be the shorter time." : undefined,
    zones: form.zones.every((z) => !z.enabled) ? "Turn on at least one zone, or shoppers can't check out." : undefined,
    threshold: form.freeEnabled && !(parseAmount(form.threshold, cur) ?? 0) ? `Enter an order amount in ${cur}.` : undefined,
  }
  const invalid = !!(errors.days || errors.zones || errors.threshold || zoneErrors.some((z) => z.standard || z.express))
  const show = submitted

  function setZone(i: number, patch: Partial<ZoneForm>) {
    setForm((f) => ({ ...f, zones: f.zones.map((z, j) => (j === i ? { ...z, ...patch } : z)) }))
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitted(true)
    if (invalid) {
      const badZone = zoneErrors.findIndex((z) => z.standard || z.express)
      const target = errors.days
        ? "ship-min"
        : errors.zones
          ? `zone-${form.zones[0].zone}`
          : badZone >= 0
            ? `zone-${form.zones[badZone].zone}-${zoneErrors[badZone].standard ? "standard" : "express"}`
            : errors.threshold
              ? "ship-threshold"
              : null
      if (target) document.getElementById(target)?.focus()
      return
    }
    saveShipping({
      processingDays: [min, max],
      zones: form.zones.map((z) => ({ zone: z.zone, enabled: z.enabled, standard: parseAmount(z.standard, cur) ?? 0, express: z.express.trim() ? parseAmount(z.express, cur) : null })),
      freeShipping: { enabled: form.freeEnabled, threshold: parseAmount(form.threshold, cur) ?? 0 },
    })
    setSubmitted(false)
    // Settings keeps its own copy until the backend exists; say exactly where the change shows.
    toast.success("Shipping saved in Settings", { description: `Ship-by dates on your orders now use ${min}–${max} business days. Checkout and product pages switch to these rates and times once the backend is connected.` })
  }

  return (
    <Panel id="shipping" title="Shipping" description={`Rates are per order to your brand, in ${cur}. Checkout uses them once the backend is connected; until then shoppers see the platform's standard rates.`}>
      <form noValidate onSubmit={submit} className="grid gap-5">
        <fieldset className="grid gap-1.5">
          <legend className="mb-1.5 text-[13px] font-medium text-ink">Processing time</legend>
          <div className="flex items-center gap-2">
            <Input id="ship-min" aria-label="Fewest business days" aria-invalid={show && errors.days ? true : undefined} aria-describedby="ship-days-msg" value={form.min} onChange={(e) => setForm((f) => ({ ...f, min: e.target.value }))} inputMode="numeric" className={cn(inputClass, "w-20 text-center tabular")} />
            <span className="text-ink-3">to</span>
            <Input id="ship-max" aria-label="Most business days" aria-invalid={show && errors.days ? true : undefined} aria-describedby="ship-days-msg" value={form.max} onChange={(e) => setForm((f) => ({ ...f, max: e.target.value }))} inputMode="numeric" className={cn(inputClass, "w-20 text-center tabular")} />
            <span className="text-sm text-ink-2">business days</span>
          </div>
          <p id="ship-days-msg" className={show && errors.days ? "text-xs text-danger" : "text-xs text-ink-3"}>{show && errors.days ? errors.days : "From payment to handing the parcel to the carrier. Your orders in Studio show a ship-by date from the longer time."}</p>
        </fieldset>

        <fieldset className="grid gap-2">
          <legend className="mb-1.5 text-[13px] font-medium text-ink">Zones and rates</legend>
          <ul className="grid gap-2">
            {form.zones.map((z, i) => {
              const ze = show ? zoneErrors[i] : {}
              const days = shippingRatesUsd[z.zone].days
              return (
                <li key={z.zone} className={cn("grid gap-3 rounded-md border p-3 transition-colors md:grid-cols-[minmax(0,1fr)_160px_160px] md:items-start", z.enabled ? "border-line-soft bg-surface/40" : "border-line-soft/60")}>
                  <div className="flex items-start gap-3">
                    <Switch
                      id={`zone-${z.zone}`}
                      checked={z.enabled}
                      onCheckedChange={(v) => setZone(i, { enabled: v })}
                      aria-invalid={show && errors.zones ? true : undefined}
                      aria-describedby={show && errors.zones ? "ship-zones-error" : undefined}
                      className="mt-0.5"
                    />
                    <Label htmlFor={`zone-${z.zone}`} className="grid gap-0.5 font-normal">
                      <span className={cn("text-sm", z.enabled ? "text-ink" : "text-ink-2")}>{zoneLabel[z.zone].title}</span>
                      <span className="text-xs text-ink-3">{zoneLabel[z.zone].where}. {days[0]}–{days[1]} days in transit.</span>
                    </Label>
                  </div>
                  {z.enabled ? (
                    <div className="grid grid-cols-2 gap-3 md:contents">
                      <Field id={`zone-${z.zone}-standard`} label={`Standard (${symbol})`} error={ze.standard}>
                        <Input {...control(`zone-${z.zone}-standard`, ze.standard)} value={z.standard} onChange={(e) => setZone(i, { standard: e.target.value })} inputMode="decimal" className={cn(inputClass, "tabular")} />
                      </Field>
                      <Field id={`zone-${z.zone}-express`} label={`Express (${symbol})`} optional error={ze.express}>
                        <Input {...control(`zone-${z.zone}-express`, ze.express)} value={z.express} onChange={(e) => setZone(i, { express: e.target.value })} inputMode="decimal" className={cn(inputClass, "tabular")} placeholder="Not offered" />
                      </Field>
                    </div>
                  ) : (
                    <p className="text-xs text-ink-3 md:col-span-2 md:self-center">Not shipping here. Shoppers in this zone can still browse and save.</p>
                  )}
                </li>
              )
            })}
          </ul>
          {show && errors.zones ? <p id="ship-zones-error" role="alert" className="text-xs text-danger">{errors.zones}</p> : null}
        </fieldset>

        <div className="grid gap-3 rounded-md border border-line-soft p-3 md:grid-cols-[minmax(0,1fr)_200px] md:items-start">
          <div className="flex items-start gap-3">
            <Switch id="ship-free" checked={form.freeEnabled} onCheckedChange={(v) => setForm((f) => ({ ...f, freeEnabled: v }))} className="mt-0.5" />
            <Label htmlFor="ship-free" className="grid gap-0.5 font-normal">
              <span className="text-sm text-ink">Free standard shipping over a set amount</span>
              <span className="text-xs text-ink-3">Counted on the items from your brand in the bag.</span>
            </Label>
          </div>
          {form.freeEnabled ? (
            <Field id="ship-threshold" label={`Orders over (${symbol})`} error={show ? errors.threshold : undefined}>
              <Input {...control("ship-threshold", show ? errors.threshold : undefined)} value={form.threshold} onChange={(e) => setForm((f) => ({ ...f, threshold: e.target.value }))} inputMode="decimal" className={cn(inputClass, "tabular")} />
            </Field>
          ) : null}
        </div>

        <SaveRow
          dirty={dirty}
          savedAt={savedAt}
          onDiscard={() => {
            setForm(fromSaved())
            setSubmitted(false)
          }}
          saveLabel="Save shipping"
        />
      </form>
    </Panel>
  )
}

/* ---------- Returns ---------- */

export function ReturnsSection() {
  const saved = useBrandSettings((s) => s.returns)
  const savedAt = useBrandSettings((s) => s.savedAt.returns)
  const saveReturns = useBrandSettings((s) => s.saveReturns)
  const [form, setForm] = useState<ReturnsSettings>(saved)
  const [submitted, setSubmitted] = useState(false)
  const set = <K extends keyof ReturnsSettings>(k: K, v: ReturnsSettings[K]) => setForm((f) => ({ ...f, [k]: v }))
  const dirty = JSON.stringify(form) !== JSON.stringify(saved)
  const len = form.conditions.trim().length
  const error = form.accepts && len < 20 ? "Describe the condition items must be in (20 characters or more)." : len > 600 ? "Keep it to 600 characters." : undefined
  const shown = submitted ? error : undefined

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitted(true)
    if (error) {
      document.getElementById("returns-conditions")?.focus()
      return
    }
    const next = { ...form, conditions: form.conditions.trim() }
    saveReturns(next)
    setForm(next)
    setSubmitted(false)
    // Product pages and checkout read the brand profile until the backend exists.
    toast.success("Returns policy saved in Settings", {
      description: next.accepts
        ? `${next.windowDays}-day returns. Product pages and checkout show it once the backend is connected.`
        : "Final sale, except faulty or wrong items. Product pages and checkout show it once the backend is connected.",
    })
  }

  return (
    <Panel id="returns" title="Returns" description="Shoppers see your policy on product pages and at checkout. Changes saved here reach them once the backend is connected.">
      <form noValidate onSubmit={submit} className="grid gap-5">
        <div className="flex items-start gap-3">
          <Switch id="returns-accepts" checked={form.accepts} onCheckedChange={(v) => set("accepts", v)} className="mt-0.5" />
          <Label htmlFor="returns-accepts" className="grid gap-0.5 font-normal">
            <span className="text-sm text-ink">Accept returns</span>
            <span className="text-xs text-ink-3">Faulty, wrong or not-as-described items can always be returned, whatever you choose here.</span>
          </Label>
        </div>

        <AnimatePresence initial={false}>
          {form.accepts ? (
            <motion.div key="policy" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden">
              <div className="grid gap-5 md:grid-cols-2">
                <Field id="returns-window" label="Return window" hint="Counted from delivery. Payouts are released after it closes.">
                  <Select value={String(form.windowDays)} onValueChange={(v) => set("windowDays", Number(v))}>
                    <SelectTrigger id="returns-window" aria-describedby="returns-window-hint" className={selectClass}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      {[7, 14, 21, 30].map((d) => (
                        <SelectItem key={d} value={String(d)}>{d} days</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <fieldset className="grid content-start gap-2">
                  <legend className="mb-1.5 text-[13px] font-medium text-ink">Return shipping</legend>
                  <RadioGroup value={form.returnShipping} onValueChange={(v) => set("returnShipping", v as ReturnsSettings["returnShipping"])} className="gap-2.5">
                    <div className="flex items-center gap-2.5">
                      <RadioGroupItem id="ret-customer" value="customer" />
                      <Label htmlFor="ret-customer" className="text-sm font-normal text-ink">The customer pays</Label>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <RadioGroupItem id="ret-brand" value="brand" />
                      <Label htmlFor="ret-brand" className="text-sm font-normal text-ink">We pay</Label>
                    </div>
                  </RadioGroup>
                </fieldset>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <Field id="returns-conditions" label={form.accepts ? "Condition for returns" : "Note to shoppers"} optional={!form.accepts} error={shown} hint={`${len}/600`}>
          <Textarea {...control("returns-conditions", shown, true)} value={form.conditions} onChange={(e) => set("conditions", e.target.value)} rows={3} maxLength={620} />
        </Field>

        <div className="flex items-start gap-2.5">
          <Checkbox id="returns-drops" checked={form.dropsFinalSale} onCheckedChange={(v) => set("dropsFinalSale", v === true)} className="mt-0.5" />
          <Label htmlFor="returns-drops" className="grid gap-0.5 text-[13px] font-normal text-ink">
            Drop pieces are final sale
            <span className="text-xs text-ink-3">Once the backend is connected, drop pages say so before release, so shoppers know before they buy.</span>
          </Label>
        </div>

        <SaveRow
          dirty={dirty}
          savedAt={savedAt}
          onDiscard={() => {
            setForm(saved)
            setSubmitted(false)
          }}
          saveLabel="Save returns"
        />
      </form>
    </Panel>
  )
}

/* ---------- Team ---------- */

export function TeamSection() {
  const team = useBrandSettings((s) => s.team)
  const invite = useBrandSettings((s) => s.invite)
  const setRole = useBrandSettings((s) => s.setRole)
  const removeMember = useBrandSettings((s) => s.removeMember)
  const [email, setEmail] = useState("")
  const [role, setInviteRole] = useState<TeamRole | "">("")
  const [submitted, setSubmitted] = useState(false)
  const [removing, setRemoving] = useState<TeamMember | null>(null)

  const clean = email.trim().toLowerCase()
  const errors = {
    email: !clean ? "Enter their email address." : !EMAIL_RE.test(clean) ? "Enter a valid email address, like name@studio.com." : team.some((m) => m.email === clean) ? "They're already on your team." : undefined,
    role: !role ? "Choose what they can do." : undefined,
  }
  const shown: Partial<typeof errors> = submitted ? errors : {}

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitted(true)
    if (errors.email || errors.role) {
      document.getElementById(errors.email ? "invite-email" : "invite-role")?.focus()
      return
    }
    invite(clean, role as TeamRole)
    setEmail("")
    setInviteRole("")
    setSubmitted(false)
    toast.success(`Invite created for ${clean}`, { description: `They join as ${roleMeta[role as TeamRole].label.toLowerCase()}. The email goes out once the backend is connected.` })
  }

  return (
    <Panel id="team" title="Team" description="Invite people to work in Studio. Each role only sees what it needs.">
      <ul className="divide-y divide-line-soft rounded-md border border-line-soft">
        <AnimatePresence initial={false}>
          {team.map((m) => (
            <motion.li key={m.id} layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 16, transition: { duration: 0.16 } }} transition={spring.layout} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3">
              <Initials name={m.name ?? m.email} />
              <span className="grid min-w-[10rem] flex-1 gap-0.5">
                <span className="truncate text-sm text-ink">{m.name ?? m.email}</span>
                <span className="truncate text-xs text-ink-3">{m.name ? m.email : "Invite pending"}</span>
              </span>
              <span className="ml-11 flex items-center gap-2 sm:ml-0">
                {m.status === "invited" ? <StatusBadge tone="muted">Invited</StatusBadge> : null}
                {m.role === "owner" ? (
                  <span className="inline-flex h-11 w-36 items-center px-2.5 text-sm text-ink-2 md:h-9">Owner</span>
                ) : (
                  <Select
                    value={m.role}
                    onValueChange={(v) => {
                      setRole(m.id, v as TeamRole)
                      toast.success(`${m.name ?? m.email} is now ${roleMeta[v as TeamRole].label.toLowerCase()}`, { description: roleMeta[v as TeamRole].can })
                    }}
                  >
                    <SelectTrigger aria-label={`Role for ${m.name ?? m.email}`} className={cn(selectClass, "w-36")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper" align="end">
                      {invitableRoles.map((r) => (
                        <SelectItem key={r} value={r}>{roleMeta[r].label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {m.role === "owner" ? (
                  <span className="size-11 md:size-8" aria-hidden />
                ) : (
                  <Button type="button" size="icon-sm" variant="ghost" aria-label={m.status === "invited" ? `Cancel invite for ${m.email}` : `Remove ${m.name ?? m.email}`} onClick={() => setRemoving(m)} className="size-11 text-ink-2 hover:text-danger md:size-8">
                    <Trash2 />
                  </Button>
                )}
              </span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>

      <form noValidate onSubmit={submit} className="mt-5 grid gap-3 border-t border-line-soft pt-5 md:grid-cols-[minmax(0,1fr)_200px_auto] md:items-start">
        <Field id="invite-email" label="Invite by email" error={shown.email}>
          <Input {...control("invite-email", shown.email)} type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} placeholder="name@studio.com" autoComplete="off" />
        </Field>
        <Field
          id="invite-role"
          label="Role"
          error={shown.role}
          aside={
            <InfoTip label="What each role can do" side="left" className="-my-1 size-4">
              {(Object.keys(roleMeta) as TeamRole[]).map((r) => (
                <span key={r} className="block">
                  <span className="text-ink">{roleMeta[r].label}:</span> {roleMeta[r].can}
                </span>
              ))}
            </InfoTip>
          }
        >
          <Select value={role} onValueChange={(v) => setInviteRole(v as TeamRole)}>
            <SelectTrigger {...control("invite-role", shown.role)} className={selectClass}>
              <SelectValue placeholder="Choose a role" />
            </SelectTrigger>
            <SelectContent position="popper">
              {invitableRoles.map((r) => (
                <SelectItem key={r} value={r}>{roleMeta[r].label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {/* An empty label row lines the button up with the inputs beside it. */}
        <div className="grid gap-1.5">
          <span aria-hidden className="hidden min-h-4 md:block" />
          <Button type="submit" size="sm" variant="secondary" className="h-11 md:h-9">
            <UserPlus /> Send invite
          </Button>
        </div>
      </form>
      {role ? <p className="mt-2 text-xs text-ink-3">{roleMeta[role].label}: {roleMeta[role].can.toLowerCase()}.</p> : null}

      <Dialog open={!!removing} onOpenChange={(v) => (!v ? setRemoving(null) : undefined)}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>{removing?.status === "invited" ? "Cancel this invite?" : `Remove ${removing?.name ?? removing?.email}?`}</DialogTitle>
            <DialogDescription>{removing?.status === "invited" ? `The invite link for ${removing?.email} stops working.` : "They lose access to Studio straight away. Their past actions stay in the order timelines."}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setRemoving(null)}>Keep</Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                if (!removing) return
                removeMember(removing.id)
                toast.success(removing.status === "invited" ? "Invite cancelled" : `${removing.name ?? removing.email} removed`)
                setRemoving(null)
              }}
            >
              {removing?.status === "invited" ? "Cancel invite" : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  )
}

/* ---------- Fees ---------- */

export function FeesPanel() {
  const cur = useBrandSettings((s) => s.profile.currency)
  const example = convert(10_000, "USD", cur)
  const pct = `${Math.round(site.commissionRate * 100)}%`
  return (
    <Panel id="fees" title="Fees" description={`What selling on ${site.name} costs.`}>
      <div className="grid gap-4 md:grid-cols-[auto_1fr] md:items-center">
        <span className="inline-flex size-12 items-center justify-center rounded-full border border-line">
          <Percent className="size-5 text-violet" aria-hidden />
        </span>
        <div>
          <p className="text-sm text-ink">{pct} commission on completed sales. No monthly fees, no listing fees.</p>
          <p className="mt-1 text-xs text-ink-2">
            Commission is taken from the item subtotal when an order completes, and returned if it&apos;s cancelled or refunded. On a {formatMoney(example, cur)} sale you keep {formatMoney(example - Math.round(example * site.commissionRate), cur)}. Advertising is optional and billed separately.
          </p>
        </div>
      </div>
    </Panel>
  )
}
