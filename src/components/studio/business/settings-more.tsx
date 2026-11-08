"use client"

import { useEffect, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import Link from "next/link"
import { CheckIcon as Check, PercentIcon as Percent, TrashIcon as Trash2, TruckIcon as Truck, UserPlusIcon as UserPlus } from "@phosphor-icons/react"
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
import { site } from "@/config/site"
import { useAsyncAction } from "@/hooks/use-async-action"
import { convert, formatMoney } from "@/lib/money"
import { duration, ease, spring } from "@/lib/motion"
import { cn } from "@/lib/utils"
import { EMAIL_RE, invitableRoles, roleMeta } from "./settings-model"
import { SaveRow } from "./settings-parts"
import { useBrandSettings, type ReturnsSettings, type TeamMember, type TeamRole } from "./settings-store"
import { Field, Panel, control, inputClass, selectClass } from "@/components/studio/catalog/fields"
import { Initials, useFocusReturn } from "./shared"

/* ---------- Shipping ---------- */

/**
 * Shipping moved to its own server-backed page (§6.5, §1.11): Settings keeps a link card. The old
 * browser-only fields in useBrandSettings().shipping stay for compatibility, but nothing reads them
 * for estimates or prices any more.
 */
export function ShippingSection() {
  return (
    <Panel id="shipping" title="Shipping" description="Zones, rates, handling time, pickup and closures now live in Shipping & fulfilment, where shoppers' delivery estimates and shipping prices come from.">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line-soft bg-surface/40 px-3 py-3">
        <p className="flex items-center gap-2 text-sm text-ink-2">
          <Truck className="size-4 shrink-0 text-ink-3" aria-hidden />
          Product pages, the cart and checkout use those settings.
        </p>
        <Button asChild variant="secondary" size="sm">
          <Link href="/studio/shipping">Open Shipping &amp; fulfilment</Link>
        </Button>
      </div>
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

  const save = useAsyncAction((next: ReturnsSettings) => {
    saveReturns(next)
    setForm(next)
    setSubmitted(false)
  })

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!dirty) return
    setSubmitted(true)
    if (error) {
      document.getElementById("returns-conditions")?.focus()
      return
    }
    void save.run({ ...form, conditions: form.conditions.trim() })
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
            <motion.div key="policy" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }} transition={{ duration: duration.dropdown, ease: ease.out }}>
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
          pending={save.pending}
          succeeded={save.succeeded}
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
  // The dialog keeps the member while it animates closed.
  const [lastRemoving, setLastRemoving] = useState<TeamMember | null>(null)
  if (removing && removing !== lastRemoving) setLastRemoving(removing)
  const asked = removing ?? lastRemoving
  // Escape returns to the row's remove button; once the row is gone, to the invite field.
  const removeFocus = useFocusReturn(() => document.getElementById("invite-email"))
  // A role change saves at once; the row says so, with a way back.
  const [roleSaved, setRoleSaved] = useState<{ id: string; from: TeamRole } | null>(null)
  useEffect(() => {
    if (!roleSaved) return
    const t = window.setTimeout(() => setRoleSaved(null), 6000)
    return () => window.clearTimeout(t)
  }, [roleSaved])

  const sendInvite = useAsyncAction((to: string, as: TeamRole) => {
    invite(to, as)
    setEmail("")
    setInviteRole("")
    setSubmitted(false)
  })

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
    void sendInvite.run(clean, role as TeamRole)
  }

  return (
    <Panel id="team" title="Team" description="Invite people to work in Studio. Each role only sees what it needs. Invites are saved here; the invite email isn't sent in this development build.">
      <ul className="divide-y divide-line-soft rounded-md border border-line-soft">
        <AnimatePresence initial={false}>
          {team.map((m) => (
            <motion.li key={m.id} layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 16, transition: { duration: 0.16 } }} transition={spring.layout} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3">
              <Initials name={m.name ?? m.email} />
              <span className="grid min-w-[10rem] flex-1 gap-0.5">
                <span className="truncate text-sm text-ink">{m.name ?? m.email}</span>
                <span className="truncate text-xs text-ink-3">{m.name ? m.email : "Invite saved. The email isn't sent in this development build."}</span>
              </span>
              <span className="ml-11 flex items-center gap-2 sm:ml-0">
                {m.status === "invited" ? <StatusBadge tone="muted">Invited</StatusBadge> : null}
                {m.role === "owner" ? (
                  <span className="inline-flex h-11 w-36 items-center px-2.5 text-sm text-ink-2 md:h-9">Owner</span>
                ) : (
                  <Select
                    value={m.role}
                    onValueChange={(v) => {
                      if (v === m.role) return
                      setRoleSaved({ id: m.id, from: m.role })
                      setRole(m.id, v as TeamRole)
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
              {/* Its own line under the row, so the role control never moves under the cursor. Polite, so
                  screen readers hear the save without losing their place. */}
              <span aria-live="polite" className="basis-full pl-11 text-xs empty:hidden">
                {roleSaved?.id === m.id ? (
                  <span className="inline-flex items-center gap-2 text-ink-2">
                    <Check className="size-3.5 text-violet" aria-hidden /> Role saved
                    <button type="button" className="rounded-sm text-violet underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-violet" onClick={() => { setRole(m.id, roleSaved.from); setRoleSaved(null) }}>
                      Undo
                    </button>
                  </span>
                ) : null}
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
          <Button type="submit" size="sm" variant="secondary" className="h-11 md:h-9" loading={sendInvite.pending} success={sendInvite.succeeded}>
            <UserPlus /> Add invite
          </Button>
        </div>
      </form>
      {role ? <p className="mt-2 text-xs text-ink-3">{roleMeta[role].label}: {roleMeta[role].can.toLowerCase()}.</p> : null}

      <Dialog open={!!removing} onOpenChange={(v) => (!v ? setRemoving(null) : undefined)}>
        <DialogContent className="sm:max-w-[420px]" {...removeFocus}>
          <DialogHeader>
            <DialogTitle>{asked?.status === "invited" ? "Cancel this invite?" : `Remove ${asked?.name ?? asked?.email}?`}</DialogTitle>
            <DialogDescription>{asked?.status === "invited" ? `The invite for ${asked?.email} is removed. No email was sent in this development build.` : "They're taken off your team. Their past actions stay in the order timelines."}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setRemoving(null)}>Keep</Button>
            <Button
              type="button"
              variant="destructive-solid"
              onClick={() => {
                if (!removing) return
                removeMember(removing.id)
                setRemoving(null)
              }}
            >
              {asked?.status === "invited" ? "Cancel invite" : "Remove"}
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
