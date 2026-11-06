"use client"

import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { countries, countryCodes, type CountryCode, type CurrencyCode } from "@/config/markets"
import { control, Field, inputClass, Panel, Segmented, selectClass } from "@/components/studio/growth/form"
import { currencyOptions, dialCodes } from "../options"
import { StepForm, useStepForm, type StepProps } from "../step-form"
import { useOnboarding } from "../store"
import { validateBusiness } from "../validation"

export function BusinessStep({ onNext }: StepProps) {
  const business = useOnboarding((s) => s.data.business)
  const update = useOnboarding((s) => s.update)
  const set = (patch: Partial<typeof business>) => update("business", patch)

  const form = useStepForm(() => validateBusiness(useOnboarding.getState().data.business), onNext)
  const e = form.errors

  const suggested = business.country ? (countries[business.country].currency as CurrencyCode) : null

  function onCountry(country: CountryCode) {
    const next = countries[country].currency as CurrencyCode
    const phone = business.phone.trim()
    const prefill = !phone || (business.country && phone === dialCodes[business.country])
    set({ country, ...(business.currencyEdited ? {} : { currency: next }), ...(prefill ? { phone: `${dialCodes[country]} ` } : {}) })
    // Payout details are country-specific; ask again if the country changes.
    const payments = useOnboarding.getState().data.payments
    if (payments.accountSaved && country !== business.country) {
      update("payments", { method: null, accountSaved: false, accountLast4: "", bankName: "" })
    }
  }

  const currencyHint = !suggested ? (
    "Prices are set in this currency. Shoppers see them converted to theirs."
  ) : business.currency === suggested ? (
    `Suggested for ${countries[business.country!].name}. Shoppers see prices converted to their currency.`
  ) : (
    <>
      Most brands in {countries[business.country!].name} price in {suggested}.{" "}
      <button type="button" className="text-violet hover:underline" onClick={() => set({ currency: suggested, currencyEdited: false })}>
        Use {suggested}
      </button>
    </>
  )

  return (
    <StepForm formRef={form.formRef} onSubmit={form.onSubmit} errors={e}>
      <Panel title="Location" description="Where orders ship from. Your city shows on your storefront.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="ob-country" label="Country" error={e.country}>
            <Select value={business.country ?? ""} onValueChange={(v) => onCountry(v as CountryCode)}>
              <SelectTrigger {...control("ob-country", e.country)} className={selectClass}>
                <SelectValue placeholder="Choose a country" />
              </SelectTrigger>
              <SelectContent position="popper">
                {countryCodes.map((c) => (
                  <SelectItem key={c} value={c}>{countries[c].name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field id="ob-city" label="City" error={e.city}>
            <Input {...control("ob-city", e.city)} value={business.city} onChange={(ev) => set({ city: ev.target.value })} autoComplete="address-level2" className={inputClass} />
          </Field>
          <Field id="ob-address" label="Studio or warehouse address" optional hint="Used for returns and pickups. Never shown on your storefront." className="sm:col-span-2">
            <Input {...control("ob-address", undefined, true)} value={business.address} onChange={(ev) => set({ address: ev.target.value })} autoComplete="street-address" className={inputClass} />
          </Field>
        </div>
      </Panel>

      <Panel title="Currency" description="The currency you set prices in and get paid in.">
        <Field id="ob-currency" label="Store currency" error={e.currency} hint={currencyHint}>
          <Select value={business.currency ?? ""} onValueChange={(v) => set({ currency: v as CurrencyCode, currencyEdited: v !== suggested })}>
            <SelectTrigger {...control("ob-currency", e.currency, true)} className={`${selectClass} sm:max-w-xs`}>
              <SelectValue placeholder="Choose a currency" />
            </SelectTrigger>
            <SelectContent position="popper">
              {currencyOptions.map((c) => (
                <SelectItem key={c.code} value={c.code}>
                  <span className="w-10 text-ink-3 tabular">{c.symbol}</span>
                  {c.code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </Panel>

      <Panel title="Business contact" description="For orders, payouts and anything urgent. Shoppers never see these.">
        <div className="grid gap-4">
          <Field id="ob-seller-type" label="Selling as" as="legend">
            <Segmented
              id="ob-seller-type"
              label="Selling as"
              value={business.sellerType}
              onChange={(v) => set({ sellerType: v })}
              options={[{ value: "individual", label: "An individual" }, { value: "company", label: "A registered business" }]}
            />
          </Field>
          {business.sellerType === "company" ? (
            <Field id="ob-legal-name" label="Registered business name" error={e.legalName} hint="As it appears on your registration documents.">
              <Input {...control("ob-legal-name", e.legalName, true)} value={business.legalName} onChange={(ev) => set({ legalName: ev.target.value })} autoComplete="organization" className={inputClass} />
            </Field>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="ob-contact-email" label="Contact email" error={e.contactEmail}>
              <Input {...control("ob-contact-email", e.contactEmail)} type="email" inputMode="email" autoComplete="email" value={business.contactEmail} onChange={(ev) => set({ contactEmail: ev.target.value })} className={inputClass} />
            </Field>
            <Field id="ob-phone" label="Phone" error={e.phone} hint="With country code.">
              <Input {...control("ob-phone", e.phone, true)} type="tel" inputMode="tel" autoComplete="tel" placeholder={business.country ? `${dialCodes[business.country]} ` : "+"} value={business.phone} onChange={(ev) => set({ phone: ev.target.value })} className={inputClass} />
            </Field>
          </div>
        </div>
      </Panel>
    </StepForm>
  )
}
