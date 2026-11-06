"use client"

import { useEffect, useMemo, useState } from "react"
import Image from "next/image"
import { CheckIcon as Check, ImageSquareIcon as ImagePlus, CircleNotchIcon as Loader2, PlusIcon as Plus, StarIcon as Star, UploadSimpleIcon as Upload, XIcon as X } from "@phosphor-icons/react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Textarea } from "@/components/ui/textarea"
import { currencies } from "@/config/markets"
import { site } from "@/config/site"
import { formatMoney, formatNumber } from "@/lib/money"
import { cn } from "@/lib/utils"
import { control, Field, FieldMessage, inputClass, Panel, Segmented } from "@/components/studio/growth/form"
import { ImagePicker } from "../image-picker"
import { useFocusReturn } from "@/components/studio/business/shared"
import { readImage } from "../image-utils"
import { sampleProductPhotos, sizeSystems, suggestedSizeSystem } from "../options"
import { StepForm, useStepForm, type StepProps } from "../step-form"
import { useOnboarding, type ImageRef, type SizeSystem } from "../store"
import { isWhole, parsePrice, validateProduct } from "../validation"

const MAX_PHOTOS = 4

export function ProductStep({ onNext }: StepProps) {
  const product = useOnboarding((s) => s.data.product)
  const category = useOnboarding((s) => s.data.brand.category)
  const currency = useOnboarding((s) => s.data.business.currency) ?? "USD"
  const update = useOnboarding((s) => s.update)
  const set = (patch: Partial<typeof product>) => update("product", patch)

  const [uploadError, setUploadError] = useState<string | null>(null)
  const [reading, setReading] = useState(0)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [newSize, setNewSize] = useState("")
  const [newSizeError, setNewSizeError] = useState<string | null>(null)
  const [fillAll, setFillAll] = useState("")

  const form = useStepForm(() => validateProduct(useOnboarding.getState().data.product, currency), onNext)
  const e = form.errors

  // Start with the size range that suits the brand's category.
  useEffect(() => {
    const p = useOnboarding.getState().data.product
    if (p.sizeSystem) return
    const system = suggestedSizeSystem(category)
    update("product", { sizeSystem: system, sizes: sizeSystems.find((s) => s.id === system)!.sizes.map((label) => ({ label, stock: "" })) })
  }, [category, update])

  const left = MAX_PHOTOS - product.images.length
  const preset = sizeSystems.find((s) => s.id === product.sizeSystem)
  const missing = preset && preset.id !== "custom" ? preset.sizes.filter((s) => !product.sizes.some((x) => x.label === s)) : []
  const total = product.sizes.reduce((n, s) => n + (isWhole(s.stock) ? Number(s.stock) : 0), 0)
  const price = parsePrice(product.price, currency)
  const symbol = currencies[currency].symbol

  async function addFiles(files: File[]) {
    setUploadError(null)
    const take = files.slice(0, left)
    if (files.length > left) toast(`Only ${MAX_PHOTOS} photos fit`, { description: `Added the first ${take.length}. Add more from Brand Studio later.` })
    if (!take.length) return
    setReading(take.length)
    try {
      const read = await Promise.all(take.map((f) => readImage(f, { max: 1200, quality: 0.8 })))
      const current = useOnboarding.getState().data.product
      const name = current.name.trim() || "Product"
      update("product", { images: [...current.images, ...read.map((src, i) => ({ src, alt: `${name}, photo ${current.images.length + i + 1}`, source: "upload" as const }))].slice(0, MAX_PHOTOS) })
    } catch {
      setUploadError("We couldn't read one of those images. Try JPG or PNG files.")
    } finally {
      setReading(0)
    }
  }

  function removeImage(i: number) {
    set({ images: product.images.filter((_, j) => j !== i) })
  }

  function makeCover(i: number) {
    const list = [...product.images]
    const [im] = list.splice(i, 1)
    set({ images: [im, ...list] })
  }

  function setSystem(system: SizeSystem) {
    const p = sizeSystems.find((s) => s.id === system)!
    const stockOf = (label: string) => product.sizes.find((s) => s.label === label)?.stock ?? ""
    set({ sizeSystem: system, sizes: system === "custom" ? product.sizes : p.sizes.map((label) => ({ label, stock: stockOf(label) })) })
  }

  function addSize() {
    const label = newSize.trim()
    if (!label) return setNewSizeError("Type a size first, for example 'S/M' or '50 ml'.")
    if (label.length > 12) return setNewSizeError("Keep sizes to 12 characters or fewer.")
    if (product.sizes.some((s) => s.label.toLowerCase() === label.toLowerCase())) return setNewSizeError("That size is already in the list.")
    setNewSizeError(null)
    setNewSize("")
    set({ sizes: [...product.sizes, { label, stock: "" }] })
  }

  function applyAll() {
    if (!isWhole(fillAll)) return
    set({ sizes: product.sizes.map((s) => ({ ...s, stock: String(Number(fillAll)) })) })
    setFillAll("")
  }

  const enter = (fn: () => void) => (ev: React.KeyboardEvent) => {
    if (ev.key === "Enter") {
      ev.preventDefault()
      fn()
    }
  }

  return (
    <StepForm formRef={form.formRef} onSubmit={form.onSubmit} errors={e}>
      <Panel title="Photos" description="The first photo is the cover in your storefront and in search. Portrait 4:5 works best." action={<span className="text-xs text-ink-3 tabular">{product.images.length}/{MAX_PHOTOS}</span>}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {product.images.map((im, i) => (
            <div key={`${im.src.slice(-24)}-${i}`} className="relative aspect-[4/5] overflow-hidden rounded-lg bg-surface">
              <Image src={im.src} alt={im.alt} fill sizes="(min-width: 640px) 140px, 45vw" loading={i === 0 ? "eager" : undefined} className="object-cover" />
              {i === 0 ? <span className="glass absolute top-2 left-2 rounded-[4px] px-1.5 py-0.5 text-[10px] text-ink">Cover</span> : null}
              <div className="absolute right-2 bottom-2 flex gap-1">
                {i > 0 ? (
                  <Button type="button" variant="glass" size="icon-sm" aria-label={`Make photo ${i + 1} the cover`} onClick={() => makeCover(i)}>
                    <Star />
                  </Button>
                ) : null}
                <Button type="button" variant="glass" size="icon-sm" aria-label={`Remove photo ${i + 1}`} onClick={() => removeImage(i)}>
                  <X />
                </Button>
              </div>
            </div>
          ))}
          {left > 0 ? (
            <ImagePicker
              id="ob-photos"
              multiple
              label="Add photos"
              onFiles={addFiles}
              onError={setUploadError}
              invalid={!!(e.images || uploadError)}
              describedBy={e.images || uploadError ? "ob-photos-error" : "ob-photos-hint"}
              className="flex aspect-[4/5] flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-line bg-surface/40 px-2 text-center text-ink-2 hover:border-violet/60 hover:text-ink"
            >
              {reading ? <Loader2 className="size-5 animate-spin" /> : <Upload className="size-5" />}
              <span className="text-xs text-ink">{reading ? "Adding" : "Add photos"}</span>
              <span className="text-[11px] text-ink-3">or drop them here</span>
            </ImagePicker>
          ) : null}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <FieldMessage id="ob-photos" error={uploadError ?? e.images} hint="JPG, PNG or WebP." />
          <Button type="button" variant="ghost" size="sm" className="-mr-2" disabled={left === 0} onClick={() => setLibraryOpen(true)}>
            <ImagePlus /> Use sample photos
          </Button>
        </div>
        <SampleLibrary open={libraryOpen} onOpenChange={setLibraryOpen} photos={sampleProductPhotos(category)} slots={left} name={product.name} onAdd={(list) => set({ images: [...product.images, ...list].slice(0, MAX_PHOTOS) })} />
      </Panel>

      <Panel title="Details" description="Say what it is, what it's made of and how it fits.">
        <div className="grid gap-4">
          <Field id="ob-product-name" label="Product name" error={e.name}>
            <Input {...control("ob-product-name", e.name)} value={product.name} onChange={(ev) => set({ name: ev.target.value })} maxLength={80} placeholder="e.g. Heavyweight hoodie" className={inputClass} />
          </Field>
          <Field id="ob-product-description" label="Description" error={e.description} hint="For example: 480gsm loopback fleece with a puff-printed back graphic. Dropped shoulders, double-layer hood.">
            <Textarea
              {...control("ob-product-description", e.description, true)}
              value={product.description}
              onChange={(ev) => set({ description: ev.target.value })}
              rows={4}
              maxLength={1200}
              placeholder="e.g. Fabric, fit and care"
              className="min-h-24"
            />
          </Field>
          <Field
            id="ob-price"
            label="Price"
            error={e.price}
            hint={price !== null ? `You receive ${formatMoney(Math.round(price * (1 - site.commissionRate)), currency)} per sale, after the ${Math.round(site.commissionRate * 100)}% commission.` : `In ${currency}. Shoppers see it converted to their currency.`}
          >
            <InputGroup className={cn(inputClass, "sm:max-w-xs")}>
              <InputGroupAddon className="font-normal text-ink-3">{symbol}</InputGroupAddon>
              <InputGroupInput {...control("ob-price", e.price, true)} inputMode="decimal" value={product.price} onChange={(ev) => set({ price: ev.target.value })} className="tabular" />
              <InputGroupAddon align="inline-end" className="font-normal text-ink-3">{currency}</InputGroupAddon>
            </InputGroup>
          </Field>
        </div>
      </Panel>

      <Panel title="Sizes and stock" description="One row per size you sell. Leave a size at 0 if it's sold out.">
        <div className="grid gap-4">
          <Segmented id="ob-size-system" label="Size range" value={product.sizeSystem} onChange={setSystem} options={sizeSystems.map((s) => ({ value: s.id, label: s.label }))} error={e.sizes} className="grid grid-cols-2 sm:flex sm:w-fit" />

          {product.sizes.length ? (
            <div className="overflow-hidden rounded-lg border border-line-soft">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft bg-surface/60 px-4 py-2.5 md:px-5">
                <p className="text-xs text-ink-3">
                  {product.sizes.length === 1 ? "1 size" : `${product.sizes.length} sizes`}, <span className="tabular">{formatNumber(total)}</span> in stock
                </p>
                {product.sizes.length > 1 ? (
                  <div className="flex items-center gap-1.5">
                    <Input value={fillAll} onChange={(ev) => setFillAll(ev.target.value.replace(/[^\d]/g, "").slice(0, 5))} onKeyDown={enter(applyAll)} inputMode="numeric" placeholder="Qty" aria-label="Stock for every size" className="h-8 w-16 text-xs tabular md:text-xs" />
                    <Button type="button" variant="secondary" size="xs" disabled={!isWhole(fillAll)} onClick={applyAll}>
                      Set for all
                    </Button>
                  </div>
                ) : null}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[280px] text-left text-sm">
                  <thead className="border-b border-line-soft text-xs text-ink-3">
                    <tr>
                      <th scope="col" className="px-4 py-2.5 font-normal md:px-5">Size</th>
                      <th scope="col" className="px-3 py-2.5 font-normal">Stock</th>
                      <th scope="col" className="px-4 py-2.5 font-normal md:px-5"><span className="sr-only">Remove</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-soft">
                    {product.sizes.map((s, i) => {
                      const bad = (s.stock.trim() !== "" && !isWhole(s.stock)) || (!!e.stock && total === 0 && i === 0)
                      return (
                        <tr key={s.label} className="transition-colors hover:bg-white/[0.02]">
                          <td className="px-4 py-2 whitespace-nowrap text-ink md:px-5">{s.label}</td>
                          <td className="px-3 py-2">
                            <Input
                              aria-label={`Stock for ${s.label}`}
                              aria-invalid={bad || undefined}
                              aria-describedby={bad ? "ob-stock-error" : undefined}
                              inputMode="numeric"
                              value={s.stock}
                              placeholder="0"
                              onChange={(ev) => set({ sizes: product.sizes.map((x, j) => (j === i ? { ...x, stock: ev.target.value.replace(/[^\d]/g, "").slice(0, 5) } : x)) })}
                              className="h-9 w-24 tabular"
                            />
                          </td>
                          <td className="px-4 py-2 text-right md:px-5">
                            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove size ${s.label}`} onClick={() => set({ sizes: product.sizes.filter((_, j) => j !== i) })}>
                              <X />
                            </Button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
          <FieldMessage id="ob-stock" error={e.stock} />
          {!e.stock && e.sizes ? <FieldMessage id="ob-size-system" error={e.sizes} /> : null}

          {product.sizeSystem === "custom" ? (
            <Field id="ob-new-size" label="Add a size" error={newSizeError ?? undefined}>
              <div className="flex gap-2">
                <Input {...control("ob-new-size", newSizeError ?? undefined)} value={newSize} onChange={(ev) => setNewSize(ev.target.value)} onKeyDown={enter(addSize)} placeholder="50 ml" maxLength={14} className="h-9 w-32" />
                <Button type="button" variant="secondary" size="sm" className="h-9" onClick={addSize}><Plus /> Add</Button>
              </div>
            </Field>
          ) : missing.length ? (
            <div>
              <Button type="button" variant="ghost" size="sm" className="-ml-2" onClick={() => setSystem(product.sizeSystem!)}>
                <Plus /> Add back {missing.join(", ")}
              </Button>
            </div>
          ) : null}
        </div>
      </Panel>
    </StepForm>
  )
}

function SampleLibrary({ open, onOpenChange, photos, slots, name, onAdd }: { open: boolean; onOpenChange: (o: boolean) => void; photos: ImageRef[]; slots: number; name: string; onAdd: (list: ImageRef[]) => void }) {
  const [picked, setPicked] = useState<string[]>([])
  const byId = useMemo(() => new Map(photos.map((p) => [p.src, p])), [photos])
  const focus = useFocusReturn()

  function toggle(src: string) {
    setPicked((list) => (list.includes(src) ? list.filter((s) => s !== src) : list.length >= slots ? list : [...list, src]))
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) setPicked([])
      }}
    >
      <DialogContent className="sm:max-w-[600px]" {...focus}>
        <DialogHeader>
          <DialogTitle>Sample photos</DialogTitle>
          <DialogDescription>Placeholders to get your storefront open. Swap in your own photos before you promote it.</DialogDescription>
        </DialogHeader>
        <div className="-mx-1 grid max-h-[52dvh] grid-cols-3 gap-2 overflow-y-auto px-1 py-1 sm:grid-cols-4">
          {photos.map((p, i) => {
            const on = picked.includes(p.src)
            const full = !on && picked.length >= slots
            return (
              <button
                key={p.src}
                type="button"
                aria-pressed={on}
                aria-label={`Sample photo ${i + 1}: ${p.alt}`}
                disabled={full}
                onClick={() => toggle(p.src)}
                className={cn("relative aspect-[4/5] overflow-hidden rounded-md bg-surface outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-violet disabled:opacity-40", on && "ring-2 ring-purple")}
              >
                <Image src={p.src} alt="" fill sizes="140px" className="object-cover" />
                {on ? (
                  <span className="absolute top-1.5 right-1.5 inline-flex size-5 items-center justify-center rounded-full bg-purple text-ink">
                    <Check className="size-3" aria-hidden />
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
        <p className="text-xs text-ink-3">{slots - picked.length > 0 ? `You can pick ${slots - picked.length} more.` : "That's the most that fit."}</p>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            type="button"
            variant="primary"
            disabled={!picked.length}
            onClick={() => {
              const base = name.trim() || "Product"
              onAdd(picked.map((src, i) => ({ ...byId.get(src)!, alt: `${base}, photo ${i + 1}` })))
              setPicked([])
              onOpenChange(false)
            }}
          >
            {picked.length ? `Add ${picked.length} ${picked.length === 1 ? "photo" : "photos"}` : "Add photos"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
