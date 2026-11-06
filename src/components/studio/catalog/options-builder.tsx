"use client"

import { useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { PlusIcon as Plus, TrashIcon as Trash2 } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { variantLabel } from "@/lib/data/products"
import { cn } from "@/lib/utils"
import { control, FieldMessage, inputClass, Panel } from "./fields"
import { Swatch } from "./parts"
import { activeColours, type Errors, type FormColour, type FormVariant, type ProductForm } from "./product-form-model"
import { ChipInput } from "./tag-input"
import { isWhole, MAX_VARIANTS, plural } from "./utils"

const sizePresets: { label: string; values: string[] }[] = [
  { label: "Apparel XS to XL", values: ["XS", "S", "M", "L", "XL"] },
  { label: "Shoes EU 39 to 45", values: ["39", "40", "41", "42", "43", "44", "45"] },
  { label: "Rings 6 to 10", values: ["6", "7", "8", "9", "10"] },
]

export function OptionsBuilder({
  form,
  errors,
  onOptions,
  onVariant,
  onAllStock,
  onAddColour,
}: {
  form: ProductForm
  errors: Errors
  /** Change sizes or colours; the variant matrix is rebuilt from the result. */
  onOptions: (patch: Partial<Pick<ProductForm, "hasSizes" | "sizes" | "hasColours" | "colours">>) => void
  onVariant: (key: string, patch: Partial<FormVariant>) => void
  onAllStock: (stock: string) => void
  onAddColour: () => void
}) {
  const [sizeMessage, setSizeMessage] = useState<string | null>(null)
  const [fillAll, setFillAll] = useState("")
  const hex = new Map(activeColours(form).map((c) => [c.name, c.hex]))
  const total = form.variants.reduce((n, v) => n + (isWhole(v.stock) ? Number(v.stock) : 0), 0)

  function setColour(key: string, patch: Partial<FormColour>) {
    onOptions({ colours: form.colours.map((c) => (c.key === key ? { ...c, ...patch } : c)) })
  }

  return (
    <Panel
      id="variants-panel"
      title="Options and variants"
      description="Add the sizes and colours you sell. Every combination becomes a variant with its own SKU and stock."
      action={<span className="text-xs whitespace-nowrap text-ink-3 tabular">{plural(form.variants.length, "variant")}</span>}
    >
      <div className="grid gap-5">
        {/* Sizes */}
        <div className="grid gap-3">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="pf-has-sizes" className="text-[13px] text-ink">Sizes</Label>
            <Switch id="pf-has-sizes" checked={form.hasSizes} onCheckedChange={(on) => onOptions({ hasSizes: on, sizes: on && form.sizes.length === 0 ? [] : form.sizes })} aria-label="This product comes in sizes" />
          </div>
          <AnimatePresence initial={false}>
            {form.hasSizes ? (
              <motion.div key="sizes" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                <div className="grid gap-2 pb-1">
                  <ChipInput
                    id="pf-sizes"
                    values={form.sizes}
                    onChange={(sizes) => onOptions({ sizes })}
                    placeholder="Type a size and press Enter, for example M or 42"
                    maxLength={12}
                    max={30}
                    itemLabel="size"
                    invalid={!!(errors.sizes || sizeMessage)}
                    describedBy={errors.sizes || sizeMessage ? "pf-sizes-error" : undefined}
                    onMessage={setSizeMessage}
                  />
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-ink-3">Presets</span>
                    {sizePresets.map((p) => (
                      <button key={p.label} type="button" onClick={() => onOptions({ sizes: p.values })} className="inline-flex h-9 items-center rounded-full border border-line px-3 text-[11px] text-ink-2 transition-colors hover:border-violet/60 hover:text-ink md:h-7 md:px-2.5">
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <FieldMessage id="pf-sizes" error={sizeMessage ?? errors.sizes} />
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>

        <div className="h-px bg-line-soft" />

        {/* Colours */}
        <div className="grid gap-3">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="pf-has-colours" className="text-[13px] text-ink">Colours</Label>
            <Switch
              id="pf-has-colours"
              checked={form.hasColours}
              onCheckedChange={(on) => {
                onOptions({ hasColours: on })
                if (on && form.colours.length === 0) onAddColour()
              }}
              aria-label="This product comes in colours"
            />
          </div>
          <AnimatePresence initial={false}>
            {form.hasColours ? (
              <motion.div key="colours" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                <ul className="grid gap-2 pb-1">
                  {form.colours.map((c, i) => {
                    const nameErr = errors[`colour-${c.key}-name`]
                    const hexErr = errors[`colour-${c.key}-hex`]
                    const validHex = /^#[0-9a-f]{6}$/i.test(c.hex)
                    return (
                      <li key={c.key} className="grid gap-1">
                        <div className="flex items-center gap-2">
                          <label className="relative inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md border border-line md:size-9" title="Pick a colour">
                            <span aria-hidden className="size-6 rounded-full border border-white/20 md:size-5" style={{ background: validHex ? c.hex : "transparent" }} />
                            <input type="color" value={validHex ? c.hex.toLowerCase() : "#000000"} onChange={(e) => setColour(c.key, { hex: e.target.value.toUpperCase() })} className="absolute inset-0 cursor-pointer opacity-0" aria-label={`Pick colour ${i + 1}`} />
                          </label>
                          <Input {...control(`pf-colour-${c.key}-name`, nameErr)} value={c.name} onChange={(e) => setColour(c.key, { name: e.target.value })} placeholder="Colour name, for example Washed black" maxLength={30} aria-label={`Colour ${i + 1} name`} className={cn(inputClass, "min-w-0 flex-1")} />
                          <Input {...control(`pf-colour-${c.key}-hex`, hexErr)} value={c.hex} onChange={(e) => setColour(c.key, { hex: e.target.value.trim() })} maxLength={7} aria-label={`Colour ${i + 1} hex value`} className={cn(inputClass, "w-24 shrink-0 text-xs uppercase tabular md:text-xs")} />
                          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove colour ${c.name || i + 1}`} onClick={() => onOptions({ colours: form.colours.filter((x) => x.key !== c.key) })} className="shrink-0">
                            <Trash2 />
                          </Button>
                        </div>
                        {nameErr ? <FieldMessage id={`pf-colour-${c.key}-name`} error={nameErr} /> : null}
                        {hexErr ? <FieldMessage id={`pf-colour-${c.key}-hex`} error={hexErr} /> : null}
                      </li>
                    )
                  })}
                </ul>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button id="pf-add-colour" type="button" variant="secondary" size="sm" onClick={onAddColour} disabled={form.colours.length >= 20} aria-invalid={errors.colours ? true : undefined} aria-describedby={errors.colours ? "pf-add-colour-error" : undefined}>
                    <Plus /> Add colour
                  </Button>
                  <FieldMessage id="pf-add-colour" error={errors.colours} />
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>

        {errors.variants ? <p id="variants-error" role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">{errors.variants}</p> : null}

        {/* Variant matrix */}
        <div className="overflow-hidden rounded-lg border border-line-soft">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft bg-surface/60 px-3 py-2.5 md:px-4">
            <p className="text-xs text-ink-3">
              {form.variants.length === 1 && !form.variants[0].key ? "One variant" : plural(form.variants.length, "variant")}, <span className="tabular">{total.toLocaleString("en-US")}</span> in stock
            </p>
            {form.variants.length > 1 ? (
              <div className="flex items-center gap-1.5">
                <Input value={fillAll} onChange={(e) => setFillAll(e.target.value.replace(/\D/g, "").slice(0, 5))} inputMode="numeric" placeholder="Qty" aria-label="Stock for every variant" className="h-10 w-16 text-xs tabular md:h-8 md:text-xs" />
                <Button
                  type="button"
                  size="xs"
                  variant="secondary"
                  className="h-10 md:h-8"
                  disabled={!isWhole(fillAll)}
                  onClick={() => {
                    onAllStock(String(Number(fillAll)))
                    setFillAll("")
                  }}
                >
                  Set for all
                </Button>
              </div>
            ) : null}
          </div>
          <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,220px)_112px] gap-3 border-b border-line-soft px-3 py-2 text-xs text-ink-3 sm:grid md:px-4">
            <span>Variant</span>
            <span>SKU</span>
            <span>Stock</span>
          </div>
          <ul className="divide-y divide-line-soft">
            {form.variants.map((v) => {
              const label = variantLabel(v.options) || "Default variant"
              const skuErr = errors[`sku-${v.key}`]
              const stockErr = errors[`stock-${v.key}`]
              return (
                <li key={v.key || "default"} className="grid gap-2 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,220px)_112px] sm:items-start sm:gap-3 md:px-4">
                  <div className="flex min-h-9 items-center gap-2 text-sm text-ink">
                    <Swatch hex={v.options.Colour ? hex.get(v.options.Colour) : undefined} />
                    <span className="truncate">{label}</span>
                    {!v.id ? <span className="rounded-[4px] border border-white/10 px-1.5 text-[10px] text-ink-3">New</span> : null}
                  </div>
                  <div className="grid grid-cols-[minmax(0,1fr)_112px] gap-2 sm:contents">
                    <div className="grid gap-1">
                      <Label htmlFor={`pf-sku-${v.key}`} className="text-[11px] text-ink-3 sm:sr-only">SKU</Label>
                      <Input {...control(`pf-sku-${v.key}`, skuErr)} value={v.sku} onChange={(e) => onVariant(v.key, { sku: e.target.value.toUpperCase(), skuAuto: false })} maxLength={40} className={cn(inputClass, "text-xs tabular md:text-xs")} />
                      <FieldMessage id={`pf-sku-${v.key}`} error={skuErr} />
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor={`pf-stock-${v.key}`} className="text-[11px] text-ink-3 sm:sr-only">Stock</Label>
                      <Input {...control(`pf-stock-${v.key}`, stockErr, v.reserved > 0)} value={v.stock} onChange={(e) => onVariant(v.key, { stock: e.target.value.replace(/[^\d]/g, "").slice(0, 6) })} inputMode="numeric" className={cn(inputClass, "tabular")} />
                      <FieldMessage id={`pf-stock-${v.key}`} error={stockErr} hint={v.reserved > 0 ? `${v.reserved} reserved` : undefined} />
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
        <p className="text-xs text-ink-3">Up to {MAX_VARIANTS} variants. Stock changes on existing variants are logged in your inventory history.</p>
      </div>
    </Panel>
  )
}
