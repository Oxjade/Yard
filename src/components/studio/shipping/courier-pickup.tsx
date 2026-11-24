"use client"

import { useState } from "react"
import { CheckCircleIcon, TruckIcon, WarningCircleIcon } from "@phosphor-icons/react"
import { toast } from "sonner"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { Bone } from "@/components/feedback/skeletons"
import { Field, control, inputClass } from "@/components/studio/catalog/fields"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { countries, type CountryCode } from "@/config/markets"
import type { CourierSettingsBody, CourierSettingsDto } from "@/lib/api/contracts/shipping"
import { errorMessage, fieldErrors } from "@/lib/api/errors"
import { getCourierSettings, saveCourierSettings, STUDIO_COURIER_KEY } from "@/lib/api/shipping"
import { useApi } from "@/lib/api/use-api"

/**
 * Studio › Shipping › Delivery providers › Courier pickup (docs/SHIPPING.md): where the courier
 * collects, and the parcel used to price products without a weight. It sits inside the shipping
 * form, so it is a group with its own Save button (type="button") rather than a nested form, and
 * Enter in its fields saves it instead of the shipping settings.
 */

type Draft = { contactName: string; phone: string; email: string; address: string; city: string; state: string; country: string; weight: string; length: string; width: string; height: string }

const toDraft = (d: CourierSettingsDto | undefined): Draft => {
  const s = d?.settings
  return {
    contactName: s?.contactName ?? "",
    phone: s?.phone ?? "",
    email: s?.email ?? "",
    address: s?.address ?? "",
    city: s?.city ?? "",
    state: s?.state ?? "",
    country: s?.country ?? d?.originCountries[0] ?? "NG",
    weight: s ? String(s.parcelWeightGrams / 1000) : "0.5",
    length: String(s?.parcelLengthCm ?? 30),
    width: String(s?.parcelWidthCm ?? 25),
    height: String(s?.parcelHeightCm ?? 10),
  }
}

function toBody(d: Draft): { body: CourierSettingsBody | null; errors: Record<string, string> } {
  const errors: Record<string, string> = {}
  if (!d.contactName.trim()) errors.contactName = "Add a contact name."
  if (!/^\+?[0-9 ()-]{6,24}$/.test(d.phone.trim())) errors.phone = "Enter a phone number the courier can call."
  if (!/^\S+@\S+\.\S+$/.test(d.email.trim())) errors.email = "Enter an email address."
  if (d.address.trim().length < 5) errors.address = "Add the street address."
  if (!d.city.trim()) errors.city = "Add the city."
  const kg = Number(d.weight.replace(",", "."))
  if (!Number.isFinite(kg) || kg < 0.01 || kg > 70) errors.parcelWeightGrams = "Use a weight from 0.01 to 70 kg."
  const dims = [d.length, d.width, d.height].map((x) => Number(x))
  if (dims.some((n) => !Number.isInteger(n) || n < 1 || n > 300)) errors.dims = "Use whole centimetres from 1 to 300."
  if (Object.keys(errors).length) return { body: null, errors }
  return {
    body: {
      contactName: d.contactName.trim(),
      phone: d.phone.trim(),
      email: d.email.trim(),
      address: d.address.trim(),
      city: d.city.trim(),
      ...(d.state.trim() ? { state: d.state.trim() } : {}),
      country: d.country,
      parcelWeightGrams: Math.round(kg * 1000),
      parcelLengthCm: dims[0],
      parcelWidthCm: dims[1],
      parcelHeightCm: dims[2],
    },
    errors,
  }
}

export function CourierPickup({ brandId, canManage }: { brandId: string | null; canManage: boolean }) {
  const q = useApi<CourierSettingsDto>(brandId ? `${STUDIO_COURIER_KEY}:${brandId}` : null, () => getCourierSettings(), { revalidateOnFocus: false })
  const [draft, setDraft] = useState<Draft>(() => toDraft(undefined))
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  // The saved values fill the fields once (and again after each save).
  const stamp = q.data ? `${brandId}:${q.data.settings?.updatedAt ?? "none"}` : null
  if (stamp && stamp !== loadedFor) {
    setDraft(toDraft(q.data))
    setLoadedFor(stamp)
  }

  if (!q.data) {
    if (q.error) return <p className="text-sm text-ink-2">{errorMessage(q.error, "Couldn't load the courier settings.")}</p>
    return (
      <div role="status" aria-label="Loading courier settings" className="grid gap-2">
        <Bone className="h-4 w-48" />
        <Bone className="h-9 w-full" />
      </div>
    )
  }
  const d = q.data
  const set = (patch: Partial<Draft>) => setDraft((x) => ({ ...x, ...patch }))
  const disabled = !canManage || saving

  async function save() {
    if (disabled) return
    const { body, errors: local } = toBody(draft)
    setErrors(local)
    if (!body) {
      const first = Object.keys(local)[0]
      document.getElementById(`cp-${first === "dims" ? "length" : first === "parcelWeightGrams" ? "weight" : first}`)?.focus()
      return
    }
    setSaving(true)
    try {
      const r = await saveCourierSettings(body)
      q.mutate(r)
      if (r.notice) toast.warning("Pickup address saved, not verified yet", { description: r.notice })
      else toast.success(r.settings?.verified ? `Pickup address verified with ${r.provider?.label ?? "the courier service"}` : "Pickup address saved")
    } catch (e) {
      const f = fieldErrors(e)
      if (Object.keys(f).length) setErrors(f)
      toast.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault()
      void save()
    }
  }
  const s = d.settings

  return (
    <div role="group" aria-labelledby="courier-pickup-title" className="grid gap-4 border-t border-line-soft pt-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <TruckIcon className={d.available ? "mt-0.5 size-4 shrink-0 text-violet" : "mt-0.5 size-4 shrink-0 text-ink-3"} aria-hidden />
          <div className="min-w-0">
            <h3 id="courier-pickup-title" className="text-sm text-ink">
              Courier pickup{d.provider ? ` with ${d.provider.label}` : ""}
            </h3>
            <p className="text-xs text-ink-2">
              {d.available
                ? `Shoppers paying in ${d.currency} see live courier prices at checkout. You book the pickup from the order; Yard pays the courier, and the shipping the shopper paid never counts toward your earnings.`
                : "No courier service is connected on Yard yet. Save your pickup address now and it's checked when one is."}
            </p>
          </div>
        </div>
        {s ? s.verified ? <StatusBadge tone="success">Verified</StatusBadge> : <StatusBadge tone="attention">Not verified</StatusBadge> : <StatusBadge tone="muted">Not set</StatusBadge>}
      </div>
      {d.provider?.sandbox ? <p className="rounded-md border border-line-soft bg-surface px-3 py-2 text-xs text-ink-2">Test mode: bookings go to the courier service&apos;s sandbox. No courier collects and nothing is charged.</p> : null}
      {d.blocker && d.available ? (
        <p role="status" className="flex items-start gap-2 text-xs text-ink-2">
          <WarningCircleIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {d.blocker}
        </p>
      ) : s?.verified && s.formattedAddress ? (
        <p className="flex items-start gap-2 text-xs text-ink-2">
          <CheckCircleIcon className="mt-0.5 size-3.5 shrink-0 text-violet" aria-hidden />
          Couriers collect from {s.formattedAddress}.
        </p>
      ) : null}
      <fieldset disabled={disabled} className="grid gap-4 md:grid-cols-2" onKeyDown={onKey}>
        <Field id="cp-contactName" label="Contact name" error={errors.contactName}>
          <Input {...control("cp-contactName", errors.contactName)} value={draft.contactName} onChange={(e) => set({ contactName: e.target.value })} maxLength={120} autoComplete="name" className={inputClass} />
        </Field>
        <Field id="cp-phone" label="Phone" error={errors.phone} hint="The courier calls this number on pickup day.">
          <Input {...control("cp-phone", errors.phone, true)} value={draft.phone} onChange={(e) => set({ phone: e.target.value })} inputMode="tel" maxLength={24} autoComplete="tel" className={inputClass} />
        </Field>
        <Field id="cp-email" label="Email" error={errors.email}>
          <Input {...control("cp-email", errors.email)} type="email" value={draft.email} onChange={(e) => set({ email: e.target.value })} maxLength={200} autoComplete="email" className={inputClass} />
        </Field>
        <Field id="cp-country" label="Country" hint={`Couriers collect in ${d.originCountries.map((c) => countries[c as CountryCode]?.name ?? c).join(", ")}.`}>
          <Input id="cp-country" value={countries[draft.country as CountryCode]?.name ?? draft.country} readOnly className={inputClass} />
        </Field>
        <Field id="cp-address" label="Street address" error={errors.address} className="md:col-span-2" hint="Street, number and area, as a courier would find it. Shoppers never see it.">
          <Input {...control("cp-address", errors.address, true)} value={draft.address} onChange={(e) => set({ address: e.target.value })} maxLength={300} autoComplete="street-address" className={inputClass} />
        </Field>
        <Field id="cp-city" label="City" error={errors.city}>
          <Input {...control("cp-city", errors.city)} value={draft.city} onChange={(e) => set({ city: e.target.value })} maxLength={80} className={inputClass} />
        </Field>
        <Field id="cp-state" label="State" optional>
          <Input id="cp-state" value={draft.state} onChange={(e) => set({ state: e.target.value })} maxLength={80} className={inputClass} />
        </Field>
        <Field id="cp-weight" label="Weight per piece (kg)" error={errors.parcelWeightGrams} hint="Packed, for products without their own weight.">
          <Input {...control("cp-weight", errors.parcelWeightGrams, true)} value={draft.weight} onChange={(e) => set({ weight: e.target.value.replace(/[^\d.,]/g, "").slice(0, 6) })} inputMode="decimal" className={`${inputClass} tabular`} />
        </Field>
        <div className="grid min-w-0 content-start gap-1.5">
          <span className="text-[13px] text-ink" id="cp-dims-label">
            Box size (cm)
          </span>
          <div className="flex items-center gap-2" role="group" aria-labelledby="cp-dims-label">
            <Input id="cp-length" aria-label="Length in cm" aria-invalid={errors.dims ? true : undefined} value={draft.length} onChange={(e) => set({ length: e.target.value.replace(/\D/g, "").slice(0, 3) })} inputMode="numeric" className={`${inputClass} min-w-0 flex-1 tabular`} />
            <span aria-hidden className="text-ink-3">×</span>
            <Input id="cp-width" aria-label="Width in cm" aria-invalid={errors.dims ? true : undefined} value={draft.width} onChange={(e) => set({ width: e.target.value.replace(/\D/g, "").slice(0, 3) })} inputMode="numeric" className={`${inputClass} min-w-0 flex-1 tabular`} />
            <span aria-hidden className="text-ink-3">×</span>
            <Input id="cp-height" aria-label="Height in cm" aria-invalid={errors.dims ? true : undefined} value={draft.height} onChange={(e) => set({ height: e.target.value.replace(/\D/g, "").slice(0, 3) })} inputMode="numeric" className={`${inputClass} min-w-0 flex-1 tabular`} />
          </div>
          {errors.dims ? <p className="text-xs text-danger">{errors.dims}</p> : <p className="text-xs text-ink-3">Length × width × height of your usual box.</p>}
        </div>
      </fieldset>
      {canManage ? (
        <div className="flex justify-end">
          <Button type="button" size="sm" variant="secondary" loading={saving} onClick={() => void save()}>
            {d.available ? "Save and verify pickup address" : "Save pickup address"}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
