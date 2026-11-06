"use client"

import { useEffect, useState } from "react"
import { Landmark, ShieldCheck, Smartphone } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { countries } from "@/config/markets"
import { formatMoney } from "@/lib/money"
import { cn } from "@/lib/utils"
import { ChoiceCard, ChoiceGroup, control, Field, FieldMessage, inputClass, Panel, selectClass } from "@/components/studio/growth/form"
import { deliveryOptions, payoutMethodsFor, type PayoutFormat } from "../options"
import { StepForm, useStepForm, type StepProps } from "../step-form"
import { useOnboarding, type DeliveryId } from "../store"
import { validatePayoutAccount, validatePayments, validateShipping, type PayoutInput } from "../validation"

const accountCopy: Record<Exclude<PayoutFormat, "mobile">, { account: string; routing?: string; placeholder?: string }> = {
  nuban: { account: "Account number (NUBAN)", placeholder: "10 digits" },
  uk: { account: "Account number", routing: "Sort code", placeholder: "8 digits" },
  iban: { account: "IBAN" },
  aba: { account: "Account number", routing: "Routing number", placeholder: "4 to 17 digits" },
  clabe: { account: "CLABE", placeholder: "18 digits" },
  local: { account: "Account number" },
}

export function PaymentsStep({ onNext }: StepProps) {
  const payments = useOnboarding((s) => s.data.payments)
  const business = useOnboarding((s) => s.data.business)
  const account = useOnboarding((s) => s.data.account)
  const update = useOnboarding((s) => s.update)
  const set = (patch: Partial<typeof payments>) => update("payments", patch)

  const country = business.country ?? "NG"
  const currency = business.currency ?? countries[country].currency
  const methods = payoutMethodsFor(country)
  const method = methods.find((m) => m.id === payments.method) ?? null
  const soleMethod = methods.length === 1 ? methods[0].id : null

  // With a single payout route for the country, choose it so the merchant goes straight to the details.
  useEffect(() => {
    if (!useOnboarding.getState().data.payments.method && soleMethod) update("payments", { method: soleMethod })
  }, [soleMethod, update])

  // Account numbers live only in this component: we keep the last four digits, never the number.
  const [input, setInput] = useState<PayoutInput>({ holder: payments.holder || business.legalName || account.name, bankName: payments.bankName, account: "", routing: "", phone: "" })
  const patchInput = (p: Partial<PayoutInput>) => setInput((v) => ({ ...v, ...p }))

  const needsDetails = !!method && !payments.accountSaved
  const validate = () => {
    const p = useOnboarding.getState().data.payments
    const base = validatePayments(p)
    if (!method || p.accountSaved) return base
    return { ...validateShipping(p), method: undefined, ...validatePayoutAccount(method.format, country, input) }
  }

  const form = useStepForm(validate, () => {
    if (needsDetails && method) {
      const digits = (method.format === "mobile" ? input.phone : input.account).replace(/[^\dA-Za-z]/g, "")
      set({ accountSaved: true, accountLast4: digits.slice(-4), holder: input.holder.trim(), bankName: method.format === "iban" ? "" : input.bankName.trim() })
      toast.success("Payout details saved", { description: `Payouts in ${currency} to the account ending ${digits.slice(-4)}.` })
    }
    onNext()
  })
  const e = form.errors

  const options = deliveryOptions(business.country, business.city, currency)
  const toggleDelivery = (id: DeliveryId, on: boolean) => set({ delivery: on ? [...payments.delivery, id] : payments.delivery.filter((d) => d !== id) })

  return (
    <StepForm formRef={form.formRef} onSubmit={form.onSubmit} errors={e}>
      <Panel title="Payouts" description={`How you get paid for orders from shoppers in every market, in ${currency}.`}>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <ChoiceGroup
              id="ob-payout-method"
              label="Payout method"
              value={payments.method}
              onValueChange={(v) => set({ method: v as typeof payments.method, accountSaved: false, accountLast4: "" })}
              error={e.method}
              className={cn(methods.length > 1 && "sm:grid-cols-2")}
            >
              {methods.map((m) => {
                const Icon = m.format === "mobile" ? Smartphone : Landmark
                return (
                  <ChoiceCard key={m.id} value={m.id} className="flex-row items-start gap-3 p-3.5">
                    <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-line bg-obsidian"><Icon className="size-4 text-ink-2" /></span>
                    <span className="min-w-0">
                      <span className="block text-sm text-ink">{m.label}</span>
                      <span className="mt-0.5 block text-xs text-ink-3">{m.description}</span>
                    </span>
                  </ChoiceCard>
                )
              })}
            </ChoiceGroup>
            <FieldMessage id="ob-payout-method" error={e.method} />
          </div>

          {method && payments.accountSaved ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line-soft bg-surface/50 p-3">
              <div className="min-w-0">
                <p className="text-sm text-ink">
                  {method.format === "mobile" ? "Wallet" : payments.bankName || "Account"} ending <span className="tabular">{payments.accountLast4}</span>
                </p>
                <p className="text-xs text-ink-3">{payments.holder}</p>
              </div>
              <Button type="button" variant="secondary" size="sm" onClick={() => set({ accountSaved: false, accountLast4: "" })}>Change</Button>
            </div>
          ) : null}

          {needsDetails && method ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="ob-holder" label={method.format === "mobile" ? "Wallet name" : "Account holder"} error={e.holder} className="sm:col-span-2" hint="Must match your ID or business registration. We check it before your first payout.">
                <Input {...control("ob-holder", e.holder, true)} value={input.holder} onChange={(ev) => patchInput({ holder: ev.target.value })} autoComplete="name" className={inputClass} />
              </Field>
              {method.format === "mobile" ? (
                <Field id="ob-wallet-phone" label="Wallet phone number" error={e.phone} className="sm:col-span-2">
                  <Input {...control("ob-wallet-phone", e.phone)} type="tel" inputMode="tel" value={input.phone} onChange={(ev) => patchInput({ phone: ev.target.value })} placeholder={business.phone.trim() || undefined} className={inputClass} />
                </Field>
              ) : (
                <>
                  {method.format !== "iban" ? (
                    <Field id="ob-bank-name" label="Bank" error={e.bankName} className={cn(method.format !== "uk" && method.format !== "aba" && "sm:col-span-2")}>
                      <Input {...control("ob-bank-name", e.bankName)} value={input.bankName} onChange={(ev) => patchInput({ bankName: ev.target.value })} className={inputClass} />
                    </Field>
                  ) : null}
                  {accountCopy[method.format].routing ? (
                    <Field id="ob-routing" label={accountCopy[method.format].routing!} error={e.routing}>
                      <Input {...control("ob-routing", e.routing)} inputMode="numeric" autoComplete="off" value={input.routing} onChange={(ev) => patchInput({ routing: ev.target.value })} placeholder={method.format === "uk" ? "12-34-56" : "9 digits"} className={cn(inputClass, "tabular")} />
                    </Field>
                  ) : null}
                  <Field id="ob-account" label={accountCopy[method.format].account} error={e.account} className={cn((method.format === "iban" || method.format === "nuban" || method.format === "clabe" || method.format === "local") && "sm:col-span-2")}>
                    <Input
                      {...control("ob-account", e.account)}
                      inputMode={method.format === "iban" ? "text" : "numeric"}
                      autoComplete="off"
                      autoCapitalize={method.format === "iban" ? "characters" : "none"}
                      value={input.account}
                      onChange={(ev) => patchInput({ account: ev.target.value })}
                      placeholder={method.format === "iban" ? `${country}76 …` : accountCopy[method.format].placeholder}
                      className={cn(inputClass, "tabular")}
                    />
                  </Field>
                </>
              )}
              <p className="text-xs text-ink-3 sm:col-span-2">We keep only the last four digits on this device. The full details go to our payments partner in the backend phase.</p>
            </div>
          ) : null}
          {e.payout && !needsDetails ? <FieldMessage id="ob-payout" error={e.payout} /> : null}

          <div className="flex gap-3 rounded-md border border-violet/25 bg-purple/8 p-3">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-violet" aria-hidden />
            <div>
              <p className="text-sm text-ink">No documents needed to publish</p>
              <p className="mt-0.5 text-xs text-ink-2">We only ask for identity and business verification when your payouts require it, usually before your first payout is released. Building, previewing and publishing never wait on it.</p>
            </div>
          </div>
        </div>
      </Panel>

      <Panel title="Delivery" description="Where you'll ship. Rates use the platform shipping table for now; set your own in Settings later.">
        <div className="grid gap-2" role="group" aria-labelledby="ob-delivery-label" data-invalid={e.delivery ? true : undefined} aria-describedby={e.delivery ? "ob-delivery-error" : undefined}>
          <span id="ob-delivery-label" className="sr-only">Delivery options</span>
          {options.map((o) => {
            const on = payments.delivery.includes(o.id)
            return (
              <label key={o.id} htmlFor={`ob-delivery-${o.id}`} className={cn("flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors", on ? "border-violet/40 bg-purple/8" : "border-line hover:bg-white/[0.02]")}>
                <Checkbox id={`ob-delivery-${o.id}`} checked={on} onCheckedChange={(c) => toggleDelivery(o.id, c === true)} className="mt-0.5" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-ink">{o.label}</span>
                  <span className="mt-0.5 block text-xs text-ink-3">{o.description}</span>
                </span>
                {o.rate ? (
                  <span className="shrink-0 text-right">
                    <span className="block text-sm text-ink tabular">{formatMoney(o.rate.amount, currency)}</span>
                    <span className="block text-[11px] text-ink-3 tabular">{o.rate.days[0]}–{o.rate.days[1]} days</span>
                  </span>
                ) : (
                  <span className="shrink-0 text-sm text-ink-2">Free</span>
                )}
              </label>
            )
          })}
        </div>
        <div className="mt-2"><FieldMessage id="ob-delivery" error={e.delivery} /></div>
      </Panel>

      <Panel title="Processing and returns" description="Shown on every product page, so shoppers know when to expect their order.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="ob-processing" label="Processing time" as="legend" error={e.processing} hint="How long you take to pack an order before it ships.">
            <div className="flex items-center gap-2 text-sm text-ink-2">
              <Input aria-label="Fewest working days to ship" aria-invalid={e.processing ? true : undefined} aria-describedby={e.processing ? "ob-processing-error" : "ob-processing-hint"} inputMode="numeric" value={payments.processingMin} onChange={(ev) => set({ processingMin: ev.target.value.replace(/[^\d]/g, "").slice(0, 2) })} className="h-10 w-16 text-center tabular" />
              <span>to</span>
              <Input aria-label="Most working days to ship" aria-invalid={e.processing ? true : undefined} aria-describedby={e.processing ? "ob-processing-error" : "ob-processing-hint"} inputMode="numeric" value={payments.processingMax} onChange={(ev) => set({ processingMax: ev.target.value.replace(/[^\d]/g, "").slice(0, 2) })} className="h-10 w-16 text-center tabular" />
              <span>working days</span>
            </div>
          </Field>
          <Field id="ob-returns" label="Returns window" hint="Faulty or wrong items can always be returned within 7 days.">
            <Select value={payments.returnsDays} onValueChange={(v) => set({ returnsDays: v as typeof payments.returnsDays })}>
              <SelectTrigger {...control("ob-returns", undefined, true)} className={selectClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value="14">14 days</SelectItem>
                <SelectItem value="30">30 days</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
      </Panel>
    </StepForm>
  )
}

