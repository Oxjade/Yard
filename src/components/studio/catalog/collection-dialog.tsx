"use client"

import { useMemo, useRef, useState } from "react"
import Image from "next/image"
import { CaretDownIcon, CaretUpIcon, CheckIcon, MagnifyingGlassIcon, TrashIcon } from "@phosphor-icons/react"
import { RadioGroup as RadioGroupPrimitive } from "radix-ui"
import { toast } from "sonner"
import { StatusBadge, productStatusMeta } from "@/components/dashboard/status-badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Textarea } from "@/components/ui/textarea"
import { ApiError } from "@/lib/api/client"
import { errorMessage } from "@/lib/api/errors"
import type { Collection, ImageAsset, Product } from "@/lib/data/types"
import { cn } from "@/lib/utils"
import { Segmented, control, Field, FieldMessage, inputClass } from "./fields"
import { Thumb } from "./parts"

const NAME_MAX = 60
const DESCRIPTION_MAX = 280

export type CollectionDraft = {
  name: string
  description: string
  productIds: string[]
  image: ImageAsset | null
  status: "draft" | "published"
}

type CollectionDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  collection: Collection | null
  collections: Collection[]
  products: Product[]
  /** Live brands: only uploaded photos (with a media id) can be saved as a cover. */
  uploadedCoversOnly?: boolean
  onSave: (draft: CollectionDraft, idempotencyKey?: string) => Promise<void>
  onDelete: (collection: Collection) => Promise<void>
  onConflict: () => void
}

/**
 * Create (collection = null) or edit a collection in a tray. The form only mounts while the
 * tray is open and is keyed by collection + version, so every open starts from that collection.
 */
export function CollectionDialog(props: CollectionDialogProps) {
  const [pending, setPending] = useState(false)
  const { open, onOpenChange, collection } = props
  return (
    <Sheet open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <SheetContent side="right" className="gap-0 border-line-soft bg-surface p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[560px]">
        {open ? <CollectionForm key={`${collection?.id ?? "new"}:${collection?.version ?? 0}`} {...props} pending={pending} setPending={setPending} /> : null}
      </SheetContent>
    </Sheet>
  )
}

function CollectionForm({
  onOpenChange,
  collection,
  collections,
  products,
  uploadedCoversOnly = false,
  onSave,
  onDelete,
  onConflict,
  pending,
  setPending,
}: CollectionDialogProps & { pending: boolean; setPending: (pending: boolean) => void }) {
  const isNew = !collection
  const [name, setName] = useState(collection?.name ?? "")
  const [description, setDescription] = useState(collection?.description ?? "")
  const [selected, setSelected] = useState<string[]>(collection?.productIds ?? [])
  const [cover, setCover] = useState<ImageAsset | null>(collection?.image ?? null)
  const [status, setStatus] = useState<"draft" | "published">(collection?.status ?? "published")
  const [query, setQuery] = useState("")
  const [submitted, setSubmitted] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const createRequest = useRef<{ signature: string; key: string } | null>(null)

  const byId = useMemo(() => new Map(products.map((product) => [product.id, product])), [products])
  const term = query.trim().toLowerCase()
  const availableProducts = useMemo(
    () => products.filter((product) => !term || [product.name, product.subcategory, ...product.tags].join(" ").toLowerCase().includes(term)),
    [products, term],
  )
  const selectedProducts = selected.flatMap((id) => {
    const product = byId.get(id)
    return product ? [product] : []
  })
  const covers = useMemo(() => {
    const seen = new Set<string>()
    const result: ImageAsset[] = []
    const add = (image?: ImageAsset | null) => {
      if (!image || seen.has(image.src)) return
      if (uploadedCoversOnly && !image.mediaId && image.src !== collection?.image.src) return
      seen.add(image.src)
      result.push(image)
    }
    add(collection?.image)
    selectedProducts.forEach((product) => product.images.forEach(add))
    products.forEach((product) => product.images.forEach(add))
    return result
  }, [collection, products, selectedProducts, uploadedCoversOnly])

  const errors = submitted
    ? {
        name: name.trim().length < 2 ? "Enter a collection name." : name.trim().length > NAME_MAX ? `Keep the name to ${NAME_MAX} characters or fewer.` : collections.some((item) => item.id !== collection?.id && item.name.trim().toLowerCase() === name.trim().toLowerCase()) ? "You already have a collection with this name." : undefined,
        description: description.trim().length > DESCRIPTION_MAX ? `Keep the description to ${DESCRIPTION_MAX} characters or fewer.` : undefined,
      }
    : {}

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setSubmitted(true)
    if (pending || errors.name || errors.description || name.trim().length < 2 || name.trim().length > NAME_MAX || description.trim().length > DESCRIPTION_MAX) return
    setPending(true)
    setFailure(null)
    try {
      const draft = { name: name.trim(), description: description.trim(), productIds: selected, image: cover, status }
      const signature = JSON.stringify(draft)
      if (isNew && (!createRequest.current || createRequest.current.signature !== signature)) createRequest.current = { signature, key: crypto.randomUUID() }
      await onSave(draft, createRequest.current?.key)
      createRequest.current = null
      toast.success(isNew ? "Collection created" : "Collection saved")
      onOpenChange(false)
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        toast.error("Someone else changed this collection", {
          description: "Reload to see their changes. Your edits in this tray will be replaced.",
          duration: Infinity,
          action: { label: "Reload", onClick: onConflict },
        })
      } else {
        const fields = error instanceof ApiError && error.fields ? Object.values(error.fields).filter(Boolean) : []
        setFailure([errorMessage(error, "The collection couldn't be saved. Check your connection and try again."), ...fields].join(" "))
      }
    } finally {
      setPending(false)
    }
  }

  async function remove() {
    if (!collection || pending) return
    setPending(true)
    setFailure(null)
    try {
      await onDelete(collection)
      toast.success("Collection deleted", { description: "Its products are still in your catalogue." })
      onOpenChange(false)
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        toast.error("Someone else changed this collection", {
          description: "Reload to see their changes before deleting it.",
          duration: Infinity,
          action: { label: "Reload", onClick: onConflict },
        })
      } else {
        setFailure(errorMessage(error, "The collection couldn't be deleted. Check your connection and try again."))
      }
    } finally {
      setPending(false)
    }
  }

  function toggleProduct(id: string, checked: boolean) {
    setSelected((current) => {
      if (checked) return current.includes(id) ? current : [...current, id]
      return current.filter((productId) => productId !== id)
    })
    if (checked && !cover) setCover(byId.get(id)?.images.find((image) => !uploadedCoversOnly || image.mediaId) ?? null)
  }

  function moveProduct(index: number, direction: -1 | 1) {
    setSelected((current) => {
      const target = index + direction
      if (target < 0 || target >= current.length) return current
      const next = [...current]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  return (
    <form onSubmit={save} noValidate className="flex min-h-0 flex-1 flex-col">
      <SheetHeader className="shrink-0 border-b border-line-soft p-4 pr-12 md:p-5 md:pr-12">
        <SheetTitle className="text-[15px] text-ink">{isNew ? "Create collection" : "Edit collection"}</SheetTitle>
        <SheetDescription className="text-xs text-ink-2">Group products into a drop, season or edit for your storefront.</SheetDescription>
      </SheetHeader>

      <div className="grid min-h-0 flex-1 content-start gap-5 overflow-y-auto overscroll-contain p-4 md:p-5">
        <Field id="col-name" label="Name" error={errors.name} aside={<span className="text-xs text-ink-3 tabular">{name.length}/{NAME_MAX}</span>}>
          <Input {...control("col-name", errors.name)} value={name} onChange={(event) => setName(event.target.value)} maxLength={NAME_MAX} placeholder="e.g. Drop 08: Lagoon" className={inputClass} />
        </Field>
        <Field id="col-description" label="Description" optional error={errors.description} aside={<span className="text-xs text-ink-3 tabular">{description.length}/{DESCRIPTION_MAX}</span>}>
          <Textarea {...control("col-description", errors.description)} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={DESCRIPTION_MAX} rows={2} placeholder="What ties these pieces together." className="min-h-16" />
        </Field>

        <div className="grid gap-2">
          <p className="text-[13px] text-ink">Storefront visibility</p>
          <Segmented id="collection-status" label="Storefront visibility" value={status} onChange={setStatus} options={[{ value: "draft", label: "Draft" }, { value: "published", label: "Published" }]} />
        </div>

        <section aria-labelledby="col-selected-label" className="grid min-w-0 gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="col-selected-label" className="text-[13px] text-ink">Product order</h2>
            <span className="text-xs text-ink-3 tabular">{selected.length} selected</span>
          </div>
          {selectedProducts.length ? (
            <ol className="divide-y divide-line-soft rounded-lg border border-line-soft">
              {selectedProducts.map((product, index) => (
                <li key={product.id} className="flex min-w-0 items-center gap-2 px-2 py-2">
                  <span className="w-6 shrink-0 text-center text-xs text-ink-3 tabular">{index + 1}</span>
                  <Thumb image={product.images[0]} size={36} />
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{product.name}</span>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move ${product.name} up`} disabled={index === 0 || pending} onClick={() => moveProduct(index, -1)}><CaretUpIcon /></Button>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move ${product.name} down`} disabled={index === selectedProducts.length - 1 || pending} onClick={() => moveProduct(index, 1)}><CaretDownIcon /></Button>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${product.name}`} disabled={pending} onClick={() => toggleProduct(product.id, false)}><TrashIcon /></Button>
                </li>
              ))}
            </ol>
          ) : <p className="text-sm text-ink-3">No products selected yet.</p>}
          <InputGroup className={inputClass}>
            <InputGroupAddon><MagnifyingGlassIcon className="text-ink-3" /></InputGroupAddon>
            <InputGroupInput type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your products" aria-label="Search products to add" />
          </InputGroup>
          <ul aria-label="Products to add" className="max-h-56 divide-y divide-line-soft overflow-y-auto rounded-lg border border-line-soft">
            {availableProducts.length ? availableProducts.map((product) => {
              const checked = selected.includes(product.id)
              const meta = productStatusMeta[product.status]
              return (
                <li key={product.id}>
                  <label className={cn("flex min-w-0 cursor-pointer items-center gap-3 px-3 py-2 transition-colors hover:bg-white/[0.03]", checked && "bg-purple/[0.08]")}>
                    <Checkbox checked={checked} onCheckedChange={(value) => toggleProduct(product.id, value === true)} />
                    <Thumb image={product.images[0]} size={36} />
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{product.name}</span>
                    {product.status !== "published" ? <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge> : null}
                  </label>
                </li>
              )
            }) : <li className="px-3 py-6 text-center text-sm text-ink-2">No products match &ldquo;{query}&rdquo;.</li>}
          </ul>
        </section>

        <section aria-labelledby="col-cover-label" className="grid gap-2">
          <h2 id="col-cover-label" className="text-[13px] text-ink">Cover image</h2>
          <RadioGroupPrimitive.Root
            value={cover?.src ?? ""}
            onValueChange={(src) => setCover(covers.find((image) => image.src === src) ?? null)}
            aria-label="Cover image"
            className="grid grid-cols-4 gap-2 rounded-md outline-none sm:grid-cols-6"
          >
            {covers.slice(0, 18).map((image, index) => (
              <RadioGroupPrimitive.Item key={image.src} value={image.src} aria-label={image.alt || `Photo ${index + 1}`} className="relative aspect-[4/5] overflow-hidden rounded-md bg-surface outline-none focus-visible:ring-2 focus-visible:ring-violet">
                <Image src={image.src} alt="" fill sizes="96px" unoptimized={image.src.startsWith("/api/")} className="object-cover" />
                <RadioGroupPrimitive.Indicator className="absolute inset-0">
                  <span aria-hidden className="absolute inset-0 rounded-md border-2 border-purple" />
                  <span aria-hidden className="absolute top-1 right-1 inline-flex size-5 items-center justify-center rounded-full bg-purple"><CheckIcon className="size-3 text-ink" /></span>
                </RadioGroupPrimitive.Indicator>
              </RadioGroupPrimitive.Item>
            ))}
          </RadioGroupPrimitive.Root>
          <FieldMessage id="col-cover" hint={uploadedCoversOnly ? "Photos you uploaded to your products can be used as the collection cover." : "Product photos can be used as the collection cover."} />
        </section>

        {failure ? <p role="alert" className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{failure}</p> : null}
        {confirmDelete && collection ? (
          <div role="group" aria-label="Confirm collection deletion" className="grid gap-3 rounded-md border border-danger/30 bg-danger/5 p-3">
            <p className="text-sm text-ink">Delete {collection.name}? Its products will stay in your catalogue.</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => setConfirmDelete(false)}>Keep collection</Button>
              <Button type="button" variant="destructive" size="sm" loading={pending} onClick={() => void remove()}>Delete collection</Button>
            </div>
          </div>
        ) : null}
      </div>

      <SheetFooter className="mt-0 flex-row items-center justify-between border-t border-line-soft p-4 md:px-5">
        {collection ? <Button type="button" variant="destructive" onClick={() => setConfirmDelete((value) => !value)} disabled={pending}><TrashIcon /> Delete</Button> : <span />}
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button type="submit" variant="primary" loading={pending}>{isNew ? "Create collection" : "Save collection"}</Button>
        </div>
      </SheetFooter>
    </form>
  )
}