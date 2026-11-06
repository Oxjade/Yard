"use client"

import { CheckIcon as Check } from "@phosphor-icons/react"
import { storefrontAccents, storefrontTemplates, storefrontType } from "@/components/storefront/theme"
import { ChoiceCard, ChoiceGroup } from "@/components/studio/growth/form"
import type { ImageAsset, StorefrontAccent, StorefrontTemplate, StorefrontTypePreset } from "@/lib/data/types"
import { cn } from "@/lib/utils"
import { ControlGroup } from "./parts"
import { TemplateThumb } from "./template-thumb"
import type { EditorConfig } from "./model"

/** Specimen sizes, on the type scale, that give each preset about the same width in the panel. */
const specimenSize: Record<StorefrontTypePreset, string> = {
  condensed: "text-3xl",
  grotesk: "text-2xl",
  expanded: "text-xl",
}

/**
 * Template, brand colour and typography: the same three choices as onboarding's storefront
 * step, drawn with the same Studio choice cards so a selection reads the same everywhere.
 */
export function DesignControls({
  config,
  brandName,
  cover,
  onChange,
}: {
  config: EditorConfig
  brandName: string
  cover: ImageAsset
  onChange: (patch: Partial<EditorConfig>) => void
}) {
  const accent = storefrontAccents[config.accent] ?? storefrontAccents.violet

  return (
    <>
      <ControlGroup id="sf-template" title="Template" description="The layout of your storefront. Your sections, products and words carry over.">
        <ChoiceGroup id="sf-template" label="Template" value={config.template} onValueChange={(v) => onChange({ template: v as StorefrontTemplate })} className="grid-cols-2 gap-3">
          {(Object.keys(storefrontTemplates) as StorefrontTemplate[]).map((t) => (
            <ChoiceCard key={t} value={t} className="gap-2 p-1.5">
              <TemplateThumb template={t} cover={cover} accent={accent.rule} />
              <span className="block px-1 pb-1">
                <span className="block text-[13px] text-ink">{storefrontTemplates[t].label}</span>
                <span className="sr-only">. {storefrontTemplates[t].description}</span>
              </span>
            </ChoiceCard>
          ))}
        </ChoiceGroup>
        <p className="mt-3 text-xs text-ink-2" aria-hidden>
          {storefrontTemplates[config.template].description}
        </p>
      </ControlGroup>

      <ControlGroup id="sf-accent" title="Brand colour" description={accent.reserved ?? "Used for links, rules and your announcement bar."}>
        <ChoiceGroup id="sf-accent" label="Brand colour" value={config.accent} onValueChange={(v) => onChange({ accent: v as StorefrontAccent })} className="grid-cols-6 gap-1.5">
          {(Object.keys(storefrontAccents) as StorefrontAccent[]).map((key) => {
            const a = storefrontAccents[key]
            return (
              <ChoiceCard key={key} value={key} aria-label={a.label} className="flex flex-col items-center gap-2 border-transparent bg-transparent px-0 py-2 hover:bg-white/[0.03]">
                <span className="relative inline-flex size-8 items-center justify-center rounded-full border border-white/10" style={{ backgroundColor: a.value }}>
                  {config.accent === key ? <Check className="size-4" style={{ color: a.on }} aria-hidden /> : null}
                </span>
                <span className="text-[11px] text-ink-2">{a.label}</span>
              </ChoiceCard>
            )
          })}
        </ChoiceGroup>
      </ControlGroup>

      <ControlGroup id="sf-type" title="Typography" description="The headline type for your name and section titles. Body text stays the same.">
        <ChoiceGroup id="sf-type" label="Typography" value={config.typePreset} onValueChange={(v) => onChange({ typePreset: v as StorefrontTypePreset })}>
          {(Object.keys(storefrontType) as StorefrontTypePreset[]).map((key) => {
            const t = storefrontType[key]
            return (
              <ChoiceCard key={key} value={key} className="grid gap-2 px-3.5 pt-3.5 pb-3">
                {/* A specimen of the storefront's own headline type, set in the brand's name. */}
                <span aria-hidden className={cn("block truncate leading-none text-ink", t.family, specimenSize[key])}>{brandName}</span>
                <span className="block">
                  <span className="block text-[13px] text-ink">{t.label}</span>
                  <span className="mt-0.5 block text-xs text-ink-3">{t.description}</span>
                </span>
              </ChoiceCard>
            )
          })}
        </ChoiceGroup>
      </ControlGroup>
    </>
  )
}
