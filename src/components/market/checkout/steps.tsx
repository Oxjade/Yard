"use client"

import Image from "next/image"
import { AnimatePresence, motion } from "motion/react"
import { CreditCard, Hash, Landmark, ShieldCheck, Smartphone, Truck } from "lucide-react"
import { BrandMark } from "@/components/market/brand-mark"
import { Price } from "@/components/market/price"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { countries, countryCodes, type CountryCode, type CurrencyCode } from "@/config/markets"
import { cn } from "@/lib/utils"
import type { BrandGroup } from "@/lib/cart"
import { describedBy, Field, inputClass, Notice, OptionCard, OptionGroup } from "./fields"
import {
  cardBrand,
  cityLine,
  countryRules,
  formatCardNumber,
  formatExpiry,
  mobileMoneyNetworks,
  parsePhone,
  paymentMethodCopy,
  paymentSummary,
  ussdBanks,
  type AddressDraft,
  type ContactDraft,
  type FieldErrors,
  type PaymentDraft,
  type PaymentMethod,
} from "./rules"
import { arrivalRange, deliveryDays, shippingMethodLabel, shippingPrice, type ShippingMethod } from "./shipping"

const selectClass = "w-full data-[size=default]:h-11"
const dialPad: Record<number, string> = { 2: "pl-9", 3: "pl-11", 4: "pl-13" }

/* ---------- 1. Contact ---------- */

export function ContactStep({ value, onChange, errors, country }: { value: ContactDraft; onChange: (v: ContactDraft) => void; errors: FieldErrors; country: CountryCode }) {
  const rules = countryRules[country]
  const set = (k: keyof ContactDraft) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...value, [k]: e.target.value })
  const phoneHint = `For the couriers. Enter a ${countries[country].name} number or include the country code.`
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
      <Field id="co-name" label="Full name" error={errors["co-name"]} className="sm:col-span-2">
        <Input {...describedBy("co-name", errors["co-name"])} autoComplete="name" value={value.name} onChange={set("name")} className={inputClass} />
      </Field>
      <Field id="co-email" label="Email" hint="Your receipt and every brand's shipping updates go here." error={errors["co-email"]}>
        <Input {...describedBy("co-email", errors["co-email"], "hint")} type="email" inputMode="email" autoComplete="email" value={value.email} onChange={set("email")} className={inputClass} />
      </Field>
      <Field id="co-phone" label="Phone" hint={phoneHint} error={errors["co-phone"]}>
        <div className="relative">
          <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-ink-2 tabular">
            {rules.dial}
          </span>
          <Input
            {...describedBy("co-phone", errors["co-phone"], "hint")}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder={rules.phoneExample.replace(/^0/, "")}
            value={value.phone}
            onChange={set("phone")}
            className={cn(inputClass, dialPad[rules.dial.length] ?? "pl-13", "tabular")}
          />
        </div>
      </Field>
    </div>
  )
}

/* ---------- 2. Delivery address ---------- */

export function AddressStep({
  value,
  onChange,
  errors,
  country,
  onCountryChange,
}: {
  value: AddressDraft
  onChange: (v: AddressDraft) => void
  errors: FieldErrors
  country: CountryCode
  onCountryChange: (c: CountryCode) => void
}) {
  const rules = countryRules[country]
  const set = (k: keyof AddressDraft) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...value, [k]: e.target.value })
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
      <Field id="ad-country" label="Country" hint="Changing the country updates shipping prices and payment options." className="sm:col-span-2">
        <Select value={country} onValueChange={(v) => onCountryChange(v as CountryCode)}>
          <SelectTrigger id="ad-country" aria-describedby="ad-country-hint" className={selectClass}>
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
      <Field id="ad-line1" label="Street address" error={errors["ad-line1"]} className="sm:col-span-2">
        <Input {...describedBy("ad-line1", errors["ad-line1"])} autoComplete="address-line1" value={value.line1} onChange={set("line1")} className={inputClass} />
      </Field>
      <Field id="ad-line2" label="Apartment, suite or floor" optional className="sm:col-span-2">
        <Input id="ad-line2" autoComplete="address-line2" value={value.line2} onChange={set("line2")} className={inputClass} />
      </Field>
      <Field id="ad-city" label="City or town" error={errors["ad-city"]}>
        <Input {...describedBy("ad-city", errors["ad-city"])} autoComplete="address-level2" value={value.city} onChange={set("city")} className={inputClass} />
      </Field>
      <Field id="ad-region" label={rules.region.label} optional={!rules.region.required} error={errors["ad-region"]}>
        {rules.region.options ? (
          <Select value={rules.region.options.includes(value.region) ? value.region : ""} onValueChange={(v) => onChange({ ...value, region: v })}>
            <SelectTrigger {...describedBy("ad-region", errors["ad-region"])} className={selectClass}>
              <SelectValue placeholder={`Choose a ${rules.region.label.toLowerCase()}`} />
            </SelectTrigger>
            <SelectContent position="popper" className="max-h-72">
              {rules.region.options.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input {...describedBy("ad-region", errors["ad-region"])} autoComplete="address-level1" value={value.region} onChange={set("region")} className={inputClass} />
        )}
      </Field>
      <Field id="ad-postcode" label={rules.postcode.label} optional={!rules.postcode.required} hint={`For example ${rules.postcode.example}`} error={errors["ad-postcode"]}>
        <Input {...describedBy("ad-postcode", errors["ad-postcode"], "hint")} autoComplete="postal-code" value={value.postcode} onChange={set("postcode")} className={cn(inputClass, "uppercase placeholder:normal-case")} />
      </Field>
      {rules.landmark ? (
        <Field id="ad-landmark" label="Nearest landmark" optional hint="A bus stop, church or junction helps the courier find you.">
          <Input id="ad-landmark" aria-describedby="ad-landmark-hint" value={value.landmark} onChange={set("landmark")} className={inputClass} />
        </Field>
      ) : null}
    </div>
  )
}

/* ---------- 3. Shipping per brand ---------- */

export function ShippingStep({
  groups,
  currency,
  country,
  methodFor,
  onChange,
  today,
}: {
  groups: BrandGroup[]
  currency: CurrencyCode
  country: CountryCode
  methodFor: (brandId: string) => ShippingMethod
  onChange: (brandId: string, method: ShippingMethod) => void
  today: Date
}) {
  return (
    <div className="grid grid-cols-1 gap-4">
      {groups.map((g) => {
        const method = methodFor(g.brand.id)
        return (
          <section key={g.brand.id} aria-labelledby={`ship-${g.brand.id}`} className="rounded-lg border border-line-soft bg-card p-4 md:p-5">
            <header className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <BrandMark brand={g.brand} size="sm" />
                <div className="min-w-0">
                  <h3 id={`ship-${g.brand.id}`} className="truncate text-sm text-ink">
                    Shipping from {g.brand.name}
                  </h3>
                  <p className="truncate text-xs text-ink-2">
                    {g.brand.city}, {countries[g.brand.shipsFrom].name}. Packed in {g.brand.processingDays[0]}–{g.brand.processingDays[1]} business days.
                  </p>
                </div>
              </div>
              <div role="img" className="flex -space-x-2" aria-label={`${g.lines.length} ${g.lines.length === 1 ? "piece" : "pieces"}: ${g.lines.map((l) => l.product.name).join(", ")}`}>
                {g.lines.slice(0, 4).map((l) => (
                  <span key={l.variant.id} className="relative size-9 overflow-hidden rounded-md border-2 border-card bg-surface">
                    <Image src={l.product.images[0].src} alt="" fill sizes="36px" className="object-cover" />
                  </span>
                ))}
              </div>
            </header>
            <OptionGroup value={method} onValueChange={(v) => onChange(g.brand.id, v as ShippingMethod)} label={`Shipping speed for ${g.brand.name}`} className="mt-4 sm:grid-cols-2">
              {(["standard", "express"] as const).map((m) => {
                const price = shippingPrice(g, m)
                const days = deliveryDays(g.brand, country, m)
                return (
                  <OptionCard
                    key={m}
                    value={m}
                    checked={method === m}
                    ringId={`ship-ring-${g.brand.id}`}
                    title={shippingMethodLabel[m]}
                    description={
                      <>
                        Arrives {arrivalRange(today, days)}
                        <span className="block text-ink-3">
                          {days[0]}–{days[1]} business days
                        </span>
                      </>
                    }
                    aside={price === 0 ? "Free" : <Price amount={price} currency={currency} />}
                  />
                )
              })}
            </OptionGroup>
            {!g.freeShipping && g.toFreeShipping > 0 ? (
              <p className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-ink-2">
                <Truck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span className="min-w-0">
                  Add <Price amount={g.toFreeShipping} currency={currency} className="text-xs text-ink" /> more from {g.brand.name} for free standard shipping.
                </span>
              </p>
            ) : null}
          </section>
        )
      })}
    </div>
  )
}

/* ---------- 4. Payment ---------- */

const methodIcon: Record<PaymentMethod, React.ReactNode> = {
  card: <CreditCard className="size-[18px]" />,
  bank_transfer: <Landmark className="size-[18px]" />,
  ussd: <Hash className="size-[18px]" />,
  mobile_money: <Smartphone className="size-[18px]" />,
}

export function PaymentStep({
  value,
  method,
  methods,
  onChange,
  onMethodChange,
  errors,
  country,
}: {
  value: PaymentDraft
  method: PaymentMethod
  methods: PaymentMethod[]
  onChange: (v: PaymentDraft) => void
  onMethodChange: (m: PaymentMethod) => void
  errors: FieldErrors
  country: CountryCode
}) {
  const set = (k: keyof PaymentDraft, format?: (v: string) => string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...value, [k]: format ? format(e.target.value) : e.target.value })
  const brand = cardBrand(value.cardNumber)
  const networks = mobileMoneyNetworks[country] ?? []

  return (
    <div className="grid grid-cols-1 gap-5">
      <Notice icon={ShieldCheck}>
        <span className="text-ink">Payments are simulated in this development build.</span> Nothing is charged. Card details are checked for format only, then discarded.
      </Notice>

      <OptionGroup value={method} onValueChange={(v) => onMethodChange(v as PaymentMethod)} label="Payment method" className={cn(methods.length === 2 && "sm:grid-cols-2", methods.length === 3 && "md:grid-cols-3")}>
        {methods.map((m) => {
          const copy = paymentMethodCopy(m, country)
          return <OptionCard key={m} value={m} checked={method === m} ringId="pay-ring" icon={methodIcon[m]} title={copy.title} description={copy.body} />
        })}
      </OptionGroup>
      {methods.length === 1 ? (
        <p className="-mt-2 text-xs text-ink-3">Bank transfer, USSD and mobile money appear for addresses in the countries that use them.</p>
      ) : null}

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={method} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }} className="rounded-lg border border-line-soft bg-card p-4 md:p-5">
          {method === "card" ? (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Field id="pay-number" label="Card number" hint="To test, use 4242 4242 4242 4242 with any future date." error={errors["pay-number"]} className="sm:col-span-2">
                <div className="relative">
                  <Input
                    {...describedBy("pay-number", errors["pay-number"], "hint")}
                    inputMode="numeric"
                    autoComplete="cc-number"
                    placeholder="1234 5678 9012 3456"
                    value={value.cardNumber}
                    onChange={set("cardNumber", formatCardNumber)}
                    className={cn(inputClass, "pr-36 tabular")}
                  />
                  {brand ? <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-ink-2">{brand}</span> : null}
                </div>
              </Field>
              <Field id="pay-expiry" label="Expiry date" error={errors["pay-expiry"]}>
                <Input {...describedBy("pay-expiry", errors["pay-expiry"])} inputMode="numeric" autoComplete="cc-exp" placeholder="MM/YY" value={value.expiry} onChange={set("expiry", formatExpiry)} className={cn(inputClass, "tabular")} />
              </Field>
              <Field id="pay-cvc" label="Security code" hint="The 3 digits on the back, or 4 on the front for American Express." error={errors["pay-cvc"]}>
                <Input
                  {...describedBy("pay-cvc", errors["pay-cvc"], "hint")}
                  inputMode="numeric"
                  autoComplete="cc-csc"
                  placeholder="123"
                  value={value.cvc}
                  onChange={set("cvc", (v) => v.replace(/\D/g, "").slice(0, 4))}
                  className={cn(inputClass, "tabular")}
                />
              </Field>
              <Field id="pay-name" label="Name on card" error={errors["pay-name"]} className="sm:col-span-2">
                <Input {...describedBy("pay-name", errors["pay-name"])} autoComplete="cc-name" value={value.cardName} onChange={set("cardName")} className={inputClass} />
              </Field>
            </div>
          ) : method === "bank_transfer" ? (
            <div className="grid gap-2 text-sm leading-relaxed text-ink-2">
              <p className="text-ink">{country === "ZA" ? "Pay by Instant EFT" : "Pay into a one-time account"}</p>
              <p>
                {country === "ZA"
                  ? "After you place the order, you choose your bank and approve the payment in its app. The brands are paid only once it clears."
                  : "After you place the order, you get an account number and the exact amount to send from your banking app. The account expires after 30 minutes."}
              </p>
              <p className="text-xs text-ink-3">In this development build the transfer is confirmed straight away.</p>
            </div>
          ) : method === "ussd" ? (
            <div className="grid gap-4">
              <Field id="pay-bank" label="Your bank" hint="We show the code to dial once the order is placed." error={errors["pay-bank"]}>
                <Select value={value.ussdBank || undefined} onValueChange={(v) => onChange({ ...value, ussdBank: v })}>
                  <SelectTrigger {...describedBy("pay-bank", errors["pay-bank"], "hint")} className={selectClass}>
                    <SelectValue placeholder="Choose your bank" />
                  </SelectTrigger>
                  <SelectContent position="popper" className="max-h-72">
                    {ussdBanks.map((b) => (
                      <SelectItem key={b} value={b}>
                        {b}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <p className="text-xs leading-relaxed text-ink-3">Dial from the phone number linked to your account. No data connection needed.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Field id="pay-network" label="Network" error={errors["pay-network"]}>
                <Select value={value.momoNetwork || undefined} onValueChange={(v) => onChange({ ...value, momoNetwork: v })}>
                  <SelectTrigger {...describedBy("pay-network", errors["pay-network"])} className={selectClass}>
                    <SelectValue placeholder="Choose a network" />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    {networks.map((n) => (
                      <SelectItem key={n} value={n}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field id="pay-momo" label="Mobile money number" hint="You approve the payment on this phone." error={errors["pay-momo"]}>
                <div className="relative">
                  <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-ink-2 tabular">
                    {countryRules[country].dial}
                  </span>
                  <Input
                    {...describedBy("pay-momo", errors["pay-momo"], "hint")}
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder={countryRules[country].phoneExample.replace(/^0/, "")}
                    value={value.momoNumber}
                    onChange={set("momoNumber")}
                    className={cn(inputClass, dialPad[countryRules[country].dial.length] ?? "pl-13", "tabular")}
                  />
                </div>
              </Field>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

/* ---------- 5. Review ---------- */

function ReviewBlock({ title, onChange, children }: { title: string; onChange: () => void; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex items-start justify-between gap-4 px-4 py-4 md:px-5">
      <div className="min-w-0">
        <h3 className="text-xs text-ink-3">{title}</h3>
        <div className="mt-1.5 text-sm leading-relaxed text-ink">{children}</div>
      </div>
      <Button type="button" variant="link" size="sm" onClick={onChange} className="h-auto shrink-0 py-0.5" aria-label={`Change ${title.toLowerCase()}`}>
        Change
      </Button>
    </section>
  )
}

export function ReviewStep({
  contact,
  address,
  payment,
  method,
  groups,
  currency,
  country,
  methodFor,
  onEdit,
  today,
}: {
  contact: ContactDraft
  address: AddressDraft
  payment: PaymentDraft
  method: PaymentMethod
  groups: BrandGroup[]
  currency: CurrencyCode
  country: CountryCode
  methodFor: (brandId: string) => ShippingMethod
  onEdit: (step: number) => void
  today: Date
}) {
  const rules = countryRules[country]
  return (
    <div className="divide-y divide-line-soft overflow-hidden rounded-lg border border-line-soft bg-card">
      <ReviewBlock title="Contact" onChange={() => onEdit(0)}>
        <p>{contact.name.trim()}</p>
        <p className="text-ink-2">{contact.email.trim()}</p>
        <p className="text-ink-2 tabular">{parsePhone(contact.phone, country) ?? contact.phone}</p>
      </ReviewBlock>
      <ReviewBlock title="Delivery address" onChange={() => onEdit(1)}>
        <p>{[address.line1.trim(), address.line2.trim()].filter(Boolean).join(", ")}</p>
        <p className="text-ink-2">{[cityLine(address.city, address.region), address.postcode.trim().toUpperCase()].filter(Boolean).join(", ")}</p>
        <p className="text-ink-2">{countries[country].name}</p>
        {rules.landmark && address.landmark.trim() ? <p className="text-ink-3">{address.landmark.trim()}</p> : null}
      </ReviewBlock>
      <ReviewBlock title="Shipping" onChange={() => onEdit(2)}>
        <ul className="grid gap-2">
          {groups.map((g) => {
            const m = methodFor(g.brand.id)
            const price = shippingPrice(g, m)
            return (
              <li key={g.brand.id} className="flex flex-wrap items-baseline gap-x-3">
                <span>{g.brand.name}</span>
                <span className="text-ink-2">
                  {shippingMethodLabel[m]}, arrives {arrivalRange(today, deliveryDays(g.brand, country, m))},{" "}
                  {price === 0 ? "free" : <Price amount={price} currency={currency} className="text-ink-2" />}
                </span>
              </li>
            )
          })}
        </ul>
      </ReviewBlock>
      <ReviewBlock title="Payment" onChange={() => onEdit(3)}>
        <p>{paymentSummary(payment, method, country)}</p>
      </ReviewBlock>
    </div>
  )
}
