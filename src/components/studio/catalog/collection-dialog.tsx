"use client"

import { useMemo, useState } from "react"
import Image from "next/image"
import { CheckIcon as Check, MagnifyingGlassIcon as Search, TrashIcon as Trash2 } from "@phosphor-icons/react"
import { RadioGroup as RadioGroupPrimitive } from "radix-ui"
import { toast } from "sonner"
import { StatusBadge, productStatusMeta } from "@/components/dashboard/status-badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Textarea } from "@/components/ui/textarea"
import type { Collection, ImageAsset, Product } from "@/lib/data/types"
import { useStudio } from "@/lib/stores/studio"
import { cn } from "@/lib/utils"
import { ConfirmDialog, control, Field, FieldMessage, inputClass } from "./fields"
import { Thumb } from "./parts"
import { useCatalog } from "./store"
import { plural, slugify } from "./utils"

const NAME_MAX = 60
const DESCRIPTION_MAX = 280

/** Create (collection = null) or edit a collection. `open` is driven by the parent. */
export function CollectionDialog({ open, onOpenChange, collection, collections, brandId }: { open: boolean; onOpenChange: (o: boolean) => void; collection: Collection | null; collections: Collection[]; brandId: string }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 p-0 sm:max-w-2xl">
        {open ? <CollectionForm key={collection?.id ?? "new"} collection={collection} collections={collections} brandId={brandId} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function CollectionForm({ collection, collections, brandId, onDone }: { collection: Collection | null; collections: Collection[]; brandId: string; onDone: () => void }) {
  const products = useStudio((s) => s.products)
  const isNew = !collection

  const initialSelected = useMemo(() => {
    if (!collection) return [] as string[]
    const members = products.filter((p) => p.collectionIds.includes(collection.id)).map((p) => p.id)
    const ordered = collection.productIds.filter((id) => members.includes(id))
    return [...ordered, ...members.filter((id) => !ordered.includes(id))]
    // Only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collection])

  const [name, setName] = useState(collection?.name ?? "")
  const [description, setDescription] = useState(collection?.description ?? "")
  const [selected, setSelected] = useState<string[]>(initialSelected)
  const [cover, setCover] = useState<ImageAsset | null>(collection?.image ?? null)
  const [q, setQ] = useState("")
  const [submitted, setSubmitted] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const list = useMemo(() => {
    const term = q.trim().toLowerCase()
    return products.filter((p) => !term || [p.name, p.subcategory, ...p.tags].join(" ").toLowerCase().includes(term))
  }, [products, q])

  /** Photos from the chosen products first, then the rest of the catalogue, plus the current cover. */
  const covers = useMemo(() => {
    const seen = new Set<string>()
    const out: ImageAsset[] = []
    const add = (im?: ImageAsset | null) => {
      if (!im || seen.has(im.src)) return
      seen.add(im.src)
      out.push(im)
    }
    add(collection?.image)
    selected.forEach((id) => byId.get(id)?.images.forEach(add))
    products.forEach((p) => p.images.forEach(add))
    return out
  }, [collection, selected, byId, products])

  function toggle(p: Product, on: boolean) {
    setSelected((s) => (on ? [...s, p.id] : s.filter((x) => x !== p.id)))
    if (on && !cover && p.images[0]) setCover(p.images[0])
  }

  function check() {
    const n = name.trim()
    const errs: { name?: string; description?: string; cover?: string } = {}
    if (n.length < 2) errs.name = "Enter a collection name."
    else if (n.length > NAME_MAX) errs.name = `Keep the name to ${NAME_MAX} characters or fewer.`
    else if (collections.some((c) => c.id !== collection?.id && c.name.trim().toLowerCase() === n.toLowerCase())) errs.name = "You already have a collection with this name."
    if (description.trim().length > DESCRIPTION_MAX) errs.description = `Keep the description to ${DESCRIPTION_MAX} characters or fewer.`
    if (!cover) errs.cover = "Choose a cover photo."
    return errs
  }
  // Validate on submit, then keep messages in step with the fields.
  const errors = submitted ? check() : {}

  function save(e: React.FormEvent) {
    e.preventDefault()
    const n = name.trim()
    const errs = check()
    setSubmitted(true)
    if (Object.values(errs).some(Boolean) || !cover) {
      const first = errs.name ? "col-name" : errs.description ? "col-description" : "col-cover"
      document.getElementById(first)?.focus()
      return
    }

    const base = slugify(n) || "collection"
    const takenHandles = new Set(collections.filter((c) => c.id !== collection?.id).map((c) => c.handle))
    let handle = collection?.handle ?? base
    for (let i = 2; !collection && takenHandles.has(handle); i++) handle = `${base}-${i}`
    const id = collection?.id ?? `c_${brandId.replace(/^b_/, "")}_${handle.replace(/-/g, "_")}`

    useCatalog.getState().upsertCollection({ id, brandId, handle, name: n, description: description.trim(), image: cover, productIds: selected })

    // Membership lives on the product, so the catalogue and storefront agree.
    const studio = useStudio.getState()
    const want = new Set(selected)
    const changed: string[] = []
    for (const p of studio.products) {
      const has = p.collectionIds.includes(id)
      if (want.has(p.id) === has) continue
      studio.upsertProduct({ ...p, collectionIds: has ? p.collectionIds.filter((x) => x !== id) : [...p.collectionIds, id] })
      changed.push(p.id)
    }
    if (changed.length) useCatalog.getState().touchProducts(changed)

    toast.success(isNew ? "Collection created" : "Collection saved", { description: `${n}, ${plural(selected.length, "product")}.` })
    onDone()
  }

  function remove() {
    if (!collection) return
    const studio = useStudio.getState()
    for (const p of studio.products) {
      if (p.collectionIds.includes(collection.id)) studio.upsertProduct({ ...p, collectionIds: p.collectionIds.filter((x) => x !== collection.id) })
    }
    useCatalog.getState().removeCollection(collection.id)
    toast.success("Collection deleted", { description: "Its products are still in your catalogue." })
    onDone()
  }

  return (
    <form onSubmit={save} noValidate className="flex min-h-0 flex-1 flex-col">
      <DialogHeader className="p-6 pb-4">
        <DialogTitle>{isNew ? "Create collection" : "Edit collection"}</DialogTitle>
        <DialogDescription className="text-ink-2">Group products for your storefront, like a drop, a season or a fabric.</DialogDescription>
      </DialogHeader>

      <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto px-6 pb-6">
        <Field id="col-name" label="Name" error={errors.name} aside={<span className="text-xs text-ink-3 tabular">{name.length}/{NAME_MAX}</span>}>
          <Input {...control("col-name", errors.name)} value={name} onChange={(e) => setName(e.target.value)} maxLength={NAME_MAX} placeholder="Drop 08: Lagoon" className={inputClass} />
        </Field>
        <Field id="col-description" label="Description" optional error={errors.description} aside={<span className="text-xs text-ink-3 tabular">{description.length}/{DESCRIPTION_MAX}</span>}>
          <Textarea {...control("col-description", errors.description)} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={DESCRIPTION_MAX} rows={2} placeholder="What ties these pieces together." className="min-h-16" />
        </Field>

        <div className="grid gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <p id="col-products-label" className="text-[13px] text-ink">Products</p>
            <span className="text-xs text-ink-3 tabular">{selected.length} selected</span>
          </div>
          <InputGroup className={inputClass}>
            <InputGroupAddon><Search className="text-ink-3" /></InputGroupAddon>
            <InputGroupInput type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your products" aria-label="Search products to add" />
          </InputGroup>
          <ul aria-labelledby="col-products-label" className="max-h-60 divide-y divide-line-soft overflow-y-auto rounded-lg border border-line-soft">
            {list.length ? (
              list.map((p) => {
                const on = selected.includes(p.id)
                const meta = productStatusMeta[p.status]
                return (
                  <li key={p.id}>
                    <label className={cn("flex cursor-pointer items-center gap-3 px-3 py-2 transition-colors hover:bg-white/[0.03]", on && "bg-purple/[0.08]")}>
                      <Checkbox checked={on} onCheckedChange={(v) => toggle(p, v === true)} />
                      <Thumb image={p.images[0]} size={36} />
                      <span className="min-w-0 flex-1 truncate text-sm text-ink">{p.name}</span>
                      {p.status !== "published" ? <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge> : null}
                    </label>
                  </li>
                )
              })
            ) : (
              <li className="px-3 py-6 text-center text-sm text-ink-2">No products match &ldquo;{q}&rdquo;.</li>
            )}
          </ul>
        </div>

        <div className="grid gap-2">
          <p id="col-cover-label" className="text-[13px] text-ink">Cover</p>
          {/* Radix radio group: one Tab stop, arrow keys move between photos. */}
          <RadioGroupPrimitive.Root
            id="col-cover"
            value={cover?.src ?? ""}
            onValueChange={(src) => {
              const im = covers.find((c) => c.src === src)
              if (im) setCover(im)
            }}
            aria-labelledby="col-cover-label"
            aria-invalid={errors.cover ? true : undefined}
            aria-describedby={errors.cover ? "col-cover-error" : "col-cover-hint"}
            className="grid grid-cols-4 gap-2 rounded-md outline-none sm:grid-cols-6"
          >
            {covers.slice(0, 18).map((im, i) => (
                <RadioGroupPrimitive.Item
                  key={im.src}
                  value={im.src}
                  aria-label={im.alt || `Photo ${i + 1}`}
                  className="relative aspect-[4/5] overflow-hidden rounded-md bg-surface outline-none focus-visible:ring-2 focus-visible:ring-violet"
                >
                  <Image src={im.src} alt="" fill sizes="96px" className="object-cover" />
                  <RadioGroupPrimitive.Indicator className="absolute inset-0">
                    <span aria-hidden className="absolute inset-0 rounded-md border-2 border-purple" />
                    <span aria-hidden className="absolute top-1 right-1 inline-flex size-5 items-center justify-center rounded-full bg-purple"><Check className="size-3 text-ink" /></span>
                  </RadioGroupPrimitive.Indicator>
                </RadioGroupPrimitive.Item>
            ))}
          </RadioGroupPrimitive.Root>
          <FieldMessage id="col-cover" error={errors.cover} hint="Photos from the products you picked come first." />
        </div>
      </div>

      <DialogFooter className="m-0 sm:items-center sm:justify-between">
        {!isNew ? (
          <Button type="button" variant="destructive" onClick={() => setConfirmDelete(true)}><Trash2 /> Delete</Button>
        ) : <span className="hidden sm:block" />}
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
          <Button type="submit" variant="primary">{isNew ? "Create collection" : "Save collection"}</Button>
        </div>
      </DialogFooter>

      {collection ? (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={`Delete ${collection.name}?`}
          body="The collection is removed from your storefront. Its products stay in your catalogue."
          confirmLabel="Delete collection"
          onConfirm={remove}
        />
      ) : null}
    </form>
  )
}
