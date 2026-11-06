"use client"

import { useEffect, useMemo, useState } from "react"
import Image from "next/image"
import { CheckIcon as Check, CircleNotchIcon as Loader2, UploadSimpleIcon as Upload } from "@phosphor-icons/react"
import { ChoiceCard, ChoiceGroup, FieldMessage, Panel } from "@/components/studio/growth/form"
import { TemplateThumb } from "@/components/studio/storefront-editor/template-thumb"
import { storefrontAccents, storefrontTemplates, storefrontType } from "@/components/storefront/theme"
import { categoryBySlug } from "@/lib/data/catalog"
import type { ImageAsset, StorefrontAccent, StorefrontTemplate, StorefrontTypePreset } from "@/lib/data/types"
import { cn } from "@/lib/utils"
import { ImagePicker } from "../image-picker"
import { readImage } from "../image-utils"
import { coverOptions, suggestedTemplate, suggestedType } from "../options"
import { StepForm, useStepForm, type StepProps } from "../step-form"
import { useOnboarding, type ImageRef } from "../store"
import { validateStorefront } from "../validation"

const accentKeys = Object.keys(storefrontAccents) as StorefrontAccent[]
const typeKeys = Object.keys(storefrontType) as StorefrontTypePreset[]
const templateKeys = Object.keys(storefrontTemplates) as StorefrontTemplate[]

/** TemplateThumb draws with an image asset; only its src is used. */
const asAsset = (ref: ImageRef): ImageAsset => ({ src: ref.src, alt: ref.alt, width: 1600, height: 1200 })

export function StorefrontStep({ onNext }: StepProps) {
  const data = useOnboarding((s) => s.data)
  const update = useOnboarding((s) => s.update)
  const { storefront, brand } = data
  const set = (patch: Partial<typeof storefront>) => update("storefront", patch)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [reading, setReading] = useState(false)

  const form = useStepForm(() => validateStorefront(useOnboarding.getState().data.storefront), onNext)
  const e = form.errors

  const suggestion = brand.category ? suggestedTemplate[brand.category] : "editorial"
  const library = useMemo(() => coverOptions(brand.category), [brand.category])
  // Two rows of four. A cover from elsewhere (an upload) takes the first slot.
  const chosen = storefront.cover
  const covers: ImageRef[] = chosen && !library.slice(0, 8).some((c) => c.src === chosen.src) ? [chosen, ...library.filter((c) => c.src !== chosen.src).slice(0, 7)] : library.slice(0, 8)
  // Template thumbnails use the chosen cover, or the first library photo until one is chosen.
  const thumbCover = asAsset(chosen ?? library[0])
  const chosenAccent = storefrontAccents[storefront.accent] ?? storefrontAccents.violet
  const accentValue = chosenAccent.rule
  const specimen = brand.name.trim() ? brand.name.trim().split(" ")[0] : "Aa"

  // Start from the template that suits the category, so a first storefront takes one look, not four decisions.
  useEffect(() => {
    const s = useOnboarding.getState().data.storefront
    if (!s.template && !s.templateEdited) update("storefront", { template: suggestion, typePreset: suggestedType[suggestion] })
  }, [suggestion, update])

  async function onUpload(files: File[]) {
    setUploadError(null)
    setReading(true)
    try {
      const src = await readImage(files[0], { max: 1600, quality: 0.8 })
      set({ cover: { src, alt: `${brand.name.trim() || "Brand"} storefront cover`, source: "upload" } })
    } catch {
      setUploadError("We couldn't read that image. Try a JPG or PNG.")
    } finally {
      setReading(false)
    }
  }

  return (
    <StepForm formRef={form.formRef} onSubmit={form.onSubmit} errors={e}>
      <Panel title="Cover photo" description="The first thing shoppers see. Wide photos work best, at least 1600 px across.">
        <div className="grid gap-2">
          <ChoiceGroup
            id="ob-cover"
            label="Cover photo"
            value={storefront.cover?.src ?? null}
            onValueChange={(src) => {
              const pick = covers.find((c) => c.src === src)
              if (pick) set({ cover: pick })
            }}
            error={e.cover}
            className="grid-cols-4"
          >
            {covers.map((c, i) => (
              <ChoiceCard key={c.src} value={c.src} aria-label={c.source === "upload" ? "Your uploaded cover" : `Library photo ${i + 1}: ${c.alt}`} className="overflow-hidden border-transparent p-0">
                <span className="relative block aspect-[4/3]">
                  <Image src={c.src} alt="" fill sizes="(min-width: 640px) 140px, 22vw" className="object-cover" />
                  {c.source === "upload" ? <span className="glass absolute bottom-1.5 left-1.5 rounded-[4px] px-1.5 py-0.5 text-[10px] text-ink">Yours</span> : null}
                </span>
              </ChoiceCard>
            ))}
          </ChoiceGroup>
          <ImagePicker
            id="ob-cover-upload"
            label="Upload your own cover photo"
            onFiles={onUpload}
            onError={setUploadError}
            invalid={!!uploadError}
            describedBy={uploadError ? "ob-cover-error" : "ob-cover-hint"}
            className="flex h-12 items-center justify-center gap-2 rounded-lg border border-dashed border-line bg-surface/40 px-3 text-[13px] text-ink-2 hover:border-violet/60 hover:text-ink"
          >
            {reading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Upload className="size-4" aria-hidden />}
            <span>{reading ? "Adding your cover" : "Upload your own"}</span>
            <span className="hidden text-xs text-ink-3 sm:inline">or drop it here</span>
          </ImagePicker>
          <FieldMessage id="ob-cover" error={uploadError ?? e.cover} hint="Sample photos are placeholders. Swap in your own any time from Storefront." />
        </div>
      </Panel>

      <Panel title="Brand colour" description={chosenAccent.reserved ?? "Used for links, rules and section marks on your storefront. Every colour here stays readable on dark."}>
        <ChoiceGroup id="ob-accent" label="Brand colour" value={storefront.accent} onValueChange={(v) => set({ accent: v as StorefrontAccent })} className="grid-cols-6 gap-2">
          {accentKeys.map((key) => {
            const a = storefrontAccents[key]
            return (
              <ChoiceCard key={key} value={key} aria-label={a.label} className="flex flex-col items-center gap-2 border-transparent bg-transparent px-0 py-2 hover:bg-white/[0.03]">
                <span className="relative inline-flex size-9 items-center justify-center rounded-full border border-white/10" style={{ backgroundColor: a.value }}>
                  {storefront.accent === key ? <Check className="size-4" style={{ color: a.on }} aria-hidden /> : null}
                </span>
                <span className="text-[11px] text-ink-2">{a.label}</span>
              </ChoiceCard>
            )
          })}
        </ChoiceGroup>
      </Panel>

      <Panel title="Typography" description="The headline type for your name and section titles. Body text stays the same.">
        <ChoiceGroup id="ob-type" label="Typography" value={storefront.typePreset} onValueChange={(v) => set({ typePreset: v as StorefrontTypePreset })} className="grid-cols-1 sm:grid-cols-3">
          {typeKeys.map((key) => {
            const t = storefrontType[key]
            return (
              <ChoiceCard key={key} value={key} className="flex flex-row items-center gap-3 p-3 sm:flex-col sm:items-stretch sm:gap-2">
                {/* A specimen of the storefront's own headline type, set in the brand's name. */}
                <span aria-hidden className={cn("block w-24 shrink-0 truncate text-xl leading-none text-ink sm:w-auto sm:text-2xl", t.family)}>{specimen}</span>
                <span className="min-w-0">
                  <span className="block text-[13px] text-ink">{t.label}</span>
                  <span className="block text-[11px] leading-snug text-ink-3">{t.description}</span>
                </span>
              </ChoiceCard>
            )
          })}
        </ChoiceGroup>
      </Panel>

      <Panel title="Template" description="The layout of your storefront. You can rearrange its sections later in the editor.">
        <ChoiceGroup
          id="ob-template"
          label="Template"
          value={storefront.template}
          onValueChange={(v) => set({ template: v as StorefrontTemplate, templateEdited: true })}
          error={e.template}
          className="grid-cols-2 gap-3"
        >
          {templateKeys.map((key) => {
            const t = storefrontTemplates[key]
            return (
              <ChoiceCard key={key} value={key} className="flex flex-col gap-2.5 p-2 sm:p-2.5">
                <TemplateThumb template={key} cover={thumbCover} accent={accentValue} />
                <span className="px-0.5 pb-0.5">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-[13px] font-medium text-ink">{t.label}</span>
                    {key === suggestion && brand.category ? <span className="rounded-[4px] bg-white/6 px-1.5 py-0.5 text-[10px] text-ink-2">Suits {categoryBySlug.get(brand.category)?.name.toLowerCase()}</span> : null}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-ink-3">{t.description}</span>
                </span>
              </ChoiceCard>
            )
          })}
        </ChoiceGroup>
        <div className="mt-2"><FieldMessage id="ob-template" error={e.template} /></div>
      </Panel>
    </StepForm>
  )
}
