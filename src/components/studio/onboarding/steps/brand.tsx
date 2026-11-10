"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import { CheckIcon as Check, CircleNotchIcon as Loader2, UploadSimpleIcon as Upload, XIcon as X } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Textarea } from "@/components/ui/textarea"
import { BrandMark } from "@/components/market/brand-mark"
import { categories } from "@/lib/data/catalog"
import type { BrandMark as BrandMarkType } from "@/lib/data/types"
import { cn } from "@/lib/utils"
import { errorMessage } from "@/lib/api/errors"
import { ChoiceCard, ChoiceGroup, control, Field, FieldMessage, inputClass, Panel, Segmented } from "@/components/studio/growth/form"
import { ImagePicker } from "../image-picker"
import { handleMessage, handleStatus, handleSuggestions, initials, slugify, type HandleStatus } from "../options"
import { StepForm, useStepForm, type StepProps } from "../step-form"
import { BrandLogo } from "../storefront-preview"
import { checkOnboardingHandle, uploadOnboardingImage } from "../remote"
import { useOnboarding } from "../store"
import { validateBrand } from "../validation"

const markStyles: { id: BrandMarkType["style"]; label: string }[] = [
  { id: "condensed", label: "Condensed" },
  { id: "expanded", label: "Expanded" },
  { id: "grotesk", label: "Grotesk" },
]

export function BrandStep({ onNext }: StepProps) {
  const brand = useOnboarding((s) => s.data.brand)
  const city = useOnboarding((s) => s.data.business.city)
  const update = useOnboarding((s) => s.update)
  const set = (patch: Partial<typeof brand>) => update("brand", patch)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [retryCheck, setRetryCheck] = useState(0)
  const [serverCheck, setServerCheck] = useState<{ handle: string; status: HandleStatus | "error" }>({ handle: "", status: "error" })

  const localStatus = handleStatus(brand.handle)
  const needsServerCheck = localStatus === "available" || localStatus === "taken"
  const check = needsServerCheck ? (serverCheck.handle === brand.handle ? serverCheck.status : "checking") : localStatus

  useEffect(() => {
    if (!needsServerCheck) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void checkOnboardingHandle(brand.handle, controller.signal)
        .then((result) => setServerCheck({ handle: brand.handle, status: result.status as HandleStatus }))
        .catch(() => {
          if (!controller.signal.aborted) setServerCheck({ handle: brand.handle, status: "error" })
        })
    }, 300)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [brand.handle, needsServerCheck, retryCheck])

  const form = useStepForm(() => {
    const errors = validateBrand(useOnboarding.getState().data.brand)
    return { ...errors, handle: check === "available" ? undefined : check === "checking" ? "Wait for the availability check to finish." : check === "error" ? "Check handle availability before continuing." : handleMessage[check] }
  }, onNext)
  const e = form.errors
  const suggestions = check === "taken" || check === "reserved" ? handleSuggestions(brand.handle, city) : []

  function onName(name: string) {
    set({
      name,
      ...(brand.handleEdited ? {} : { handle: slugify(name) }),
      ...(brand.markEdited ? {} : { markText: initials(name) }),
    })
  }

  async function onLogo(files: File[]) {
    setUploadError(null)
    setReading(true)
    try {
      const image = await uploadOnboardingImage(files[0])
      set({ logo: { ...image, alt: `${brand.name.trim() || "Brand"} logo` }, logoMode: "upload" })
    } catch (error) {
      setUploadError(errorMessage(error, "We couldn't upload that image. Try a PNG or JPG."))
    } finally {
      setReading(false)
    }
  }

  const handleInvalid = !!e.handle || (check !== "checking" && check !== "available" && check !== "empty")

  return (
    <StepForm formRef={form.formRef} onSubmit={form.onSubmit} errors={e}>
      <Panel title="Name and address" description="Shoppers search by name. The handle is your storefront address.">
        <div className="grid gap-4">
          <Field id="ob-brand-name" label="Brand name" error={e.name}>
            <Input {...control("ob-brand-name", e.name)} value={brand.name} onChange={(ev) => onName(ev.target.value)} maxLength={40} autoComplete="organization" className={inputClass} />
          </Field>
          {/* The status line below is this field's message: it reports the live availability check. */}
          <Field id="ob-handle" label="Handle">
            <InputGroup className={inputClass}>
              <InputGroupAddon className="pr-0 font-normal text-ink-3">/brands/</InputGroupAddon>
              <InputGroupInput
                id="ob-handle"
                aria-invalid={handleInvalid || undefined}
                aria-describedby="ob-handle-status"
                value={brand.handle}
                onChange={(ev) => set({ handle: ev.target.value.toLowerCase().replace(/\s+/g, "-").slice(0, 32), handleEdited: true })}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="pl-0.5"
              />
              <InputGroupAddon align="inline-end" aria-hidden>
                {check === "checking" ? <Loader2 className="size-4 animate-spin text-ink-3" /> : check === "available" ? <Check className="size-4 text-violet" /> : null}
              </InputGroupAddon>
            </InputGroup>
            <div id="ob-handle-status" role="status" aria-live="polite" className="min-h-4 text-xs">
              {check === "checking" ? (
                <span className="text-ink-3">Checking availability</span>
              ) : check === "available" ? (
                <span className="text-violet">Available. Your storefront will live at /brands/{brand.handle}.</span>
              ) : check === "error" ? (
                <span className="text-danger">We couldn&apos;t check that handle. <button type="button" className="underline underline-offset-2" onClick={() => setRetryCheck((value) => value + 1)}>Try again</button></span>
              ) : check === "empty" ? (
                e.handle ? <span className="text-danger">{e.handle}</span> : <span className="text-ink-3">Lowercase letters, numbers and hyphens, 3 to 30 characters.</span>
              ) : (
                <span className="text-danger">{handleMessage[check]}</span>
              )}
            </div>
            {suggestions.length ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-ink-3">Try</span>
                {suggestions.map((s) => (
                  <button key={s} type="button" onClick={() => set({ handle: s, handleEdited: true })} className="h-7 rounded-full border border-line px-2.5 text-xs text-ink-2 transition-colors hover:border-violet/60 hover:text-ink">
                    {s}
                  </button>
                ))}
              </div>
            ) : null}
          </Field>
        </div>
      </Panel>

      <Panel title="What you make" description="Your main category decides where you appear first. Add more categories later.">
        <div className="grid gap-4">
          <Field id="ob-category" label="Category" as="legend" error={e.category}>
            <ChoiceGroup id="ob-category" label="Category" value={brand.category} onValueChange={(v) => set({ category: v as typeof brand.category })} error={e.category} className="flex flex-wrap gap-1.5">
              {categories.map((c) => (
                <ChoiceCard key={c.slug} value={c.slug} className="inline-flex h-9 flex-row items-center rounded-full px-3.5 text-[13px] text-ink">
                  {c.name}
                </ChoiceCard>
              ))}
            </ChoiceGroup>
          </Field>
          <Field
            id="ob-description"
            label="Short description"
            error={e.description}
            hint="Shown under your name on your storefront and in search."
            aside={<span className={cn("text-xs tabular", brand.description.length > 150 ? "text-acid" : "text-ink-3")}>{brand.description.length}/160</span>}
          >
            <Textarea
              {...control("ob-description", e.description, true)}
              value={brand.description}
              onChange={(ev) => set({ description: ev.target.value })}
              maxLength={160}
              rows={3}
              placeholder="e.g. Heavyweight streetwear, printed in small runs"
              className="min-h-20 resize-none"
            />
          </Field>
        </div>
      </Panel>

      <Panel title="Logo" description="Upload yours, or start with a generated mark and swap it later.">
        <Segmented id="ob-logo-mode" label="Logo type" value={brand.logoMode} onChange={(v) => set({ logoMode: v })} options={[{ value: "mark", label: "Generated mark" }, { value: "upload", label: "Upload logo" }]} className="mb-5" />
        {brand.logoMode === "mark" ? (
          <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-start">
            <BrandLogo brand={brand} size="xl" />
            <div className="grid gap-4">
              <Field id="ob-mark-text" label="Mark letters" error={e.markText} hint="1 to 3 letters or numbers.">
                <Input
                  {...control("ob-mark-text", e.markText, true)}
                  value={brand.markText}
                  onChange={(ev) => set({ markText: ev.target.value.toUpperCase().slice(0, 3), markEdited: true })}
                  maxLength={3}
                  className={cn(inputClass, "w-28 uppercase")}
                />
              </Field>
              <Field id="ob-mark-style" label="Style" as="legend">
                <ChoiceGroup id="ob-mark-style" label="Mark style" value={brand.markStyle} onValueChange={(v) => set({ markStyle: v as BrandMarkType["style"] })} className="grid-cols-3">
                  {markStyles.map((m) => (
                    <ChoiceCard key={m.id} value={m.id} className="items-center gap-2 p-3">
                      <BrandMark brand={{ name: brand.name, mark: { text: brand.markText.trim() || initials(brand.name) || "AB", style: m.id } }} size="md" />
                      <span className="text-xs text-ink-2">{m.label}</span>
                    </ChoiceCard>
                  ))}
                </ChoiceGroup>
              </Field>
            </div>
          </div>
        ) : (
          <div className="grid gap-3">
            <div className="flex items-center gap-4">
              <ImagePicker
                id="ob-logo"
                label={brand.logo ? "Replace logo" : "Upload logo"}
                onFiles={onLogo}
                onError={setUploadError}
                invalid={!!(e.logo || uploadError)}
                describedBy={e.logo || uploadError ? "ob-logo-error" : "ob-logo-hint"}
                className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed border-line bg-surface/50 hover:border-violet/60"
              >
                {reading ? (
                  <Loader2 className="size-5 animate-spin text-ink-3" />
                ) : brand.logo ? (
                  <Image src={brand.logo.src} alt={brand.logo.alt} fill sizes="96px" className="object-contain p-2" />
                ) : (
                  <Upload className="size-5 text-ink-3" />
                )}
              </ImagePicker>
              <div className="min-w-0">
                <p className="text-sm text-ink">{brand.logo ? "Logo added" : "Drop a file here or choose one"}</p>
                <p className="mt-0.5 text-xs text-ink-3">Square PNG, JPG or WebP, at least 512 px.</p>
                {brand.logo ? (
                  <Button type="button" variant="ghost" size="xs" className="mt-2 -ml-2" onClick={() => set({ logo: null })}>
                    <X /> Remove
                  </Button>
                ) : null}
              </div>
            </div>
            <FieldMessage id="ob-logo" error={uploadError ?? e.logo} hint="Shown on your storefront, products and order emails." />
          </div>
        )}
      </Panel>
    </StepForm>
  )
}
