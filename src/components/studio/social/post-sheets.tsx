"use client"

import { useMemo, useState } from "react"
import Image from "next/image"
import { ArrowDownIcon, ArrowUpIcon, DotsSixVerticalIcon } from "@phosphor-icons/react"
import { Reorder, useDragControls } from "motion/react"
import { coverOf } from "@/components/storefront/social/post-tile"
import { ItemPicker } from "@/components/studio/storefront-editor/sections-controls"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useAsyncAction } from "@/hooks/use-async-action"
import { CAPTION_MAX, POST_PRODUCTS_MAX, type StudioSocialPostDto } from "@/lib/api/contracts/social"
import { errorMessage, fieldErrors } from "@/lib/api/errors"
import { patchPost, setFeaturedOrder } from "@/lib/api/social"
import { productsOf } from "@/lib/data"
import { formatMoney } from "@/lib/money"
import { cn } from "@/lib/utils"
import { StudioSheet, shortDate, sourceChip } from "./shared"

/** Tag up to 6 of the brand's own pieces on a post (ItemPicker over the brand's catalogue). */
export function TagProductsSheet({ post, brandId, onClose, onSaved }: { post: StudioSocialPostDto | null; brandId: string; onClose: () => void; onSaved: (p: StudioSocialPostDto) => void }) {
  const products = useMemo(() => productsOf(brandId), [brandId])
  const [ids, setIds] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  // Start from the post's own tags each time a post opens the sheet.
  const [forPost, setForPost] = useState<string | null>(null)
  if (post && post.id !== forPost) {
    setForPost(post.id)
    setIds(post.productIds)
    setError(null)
  }
  const save = useAsyncAction(() => patchPost(post!.id, { productIds: ids }), {
    success: "Tags saved",
    errorToast: false,
    onSuccess: (r) => {
      onSaved(r.post)
      onClose()
    },
    onError: (e) => setError(Object.values(fieldErrors(e))[0] ?? errorMessage(e)),
  })
  return (
    <StudioSheet
      open={!!post}
      onOpenChange={(o) => !o && onClose()}
      title="Tag products"
      description="Tagged pieces show under the post in its lightbox."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={save.pending} success={save.succeeded} onClick={() => void save.run()}>
            Save tags
          </Button>
        </>
      }
    >
      <ItemPicker
        id="tag-products"
        legend="Pieces in this post"
        max={POST_PRODUCTS_MAX}
        autoNote={`Nothing tagged. Pick up to ${POST_PRODUCTS_MAX}.`}
        empty="Publish a product to tag it here."
        items={products.map((p) => ({ id: p.id, name: p.name, image: p.images[0]?.src, meta: formatMoney(p.price, p.currency) }))}
        value={ids}
        onChange={setIds}
      />
      {error ? (
        <p role="alert" className="mt-3 text-xs text-danger">
          {error}
        </p>
      ) : null}
    </StudioSheet>
  )
}

/** Edit an upload's caption (imports keep the original's caption). */
export function CaptionSheet({ post, onClose, onSaved }: { post: StudioSocialPostDto | null; onClose: () => void; onSaved: (p: StudioSocialPostDto) => void }) {
  const [caption, setCaption] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [forPost, setForPost] = useState<string | null>(null)
  if (post && post.id !== forPost) {
    setForPost(post.id)
    setCaption(post.caption)
    setError(null)
  }
  const over = caption.length > CAPTION_MAX
  const save = useAsyncAction(() => patchPost(post!.id, { caption }), {
    success: "Caption saved",
    errorToast: false,
    onSuccess: (r) => {
      onSaved(r.post)
      onClose()
    },
    onError: (e) => setError(fieldErrors(e).caption ?? errorMessage(e)),
  })
  return (
    <StudioSheet
      open={!!post}
      onOpenChange={(o) => !o && onClose()}
      title="Edit caption"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={over} loading={save.pending} success={save.succeeded} onClick={() => void save.run()}>
            Save caption
          </Button>
        </>
      }
    >
      <div className="grid gap-1.5">
        <div className="flex items-baseline justify-between">
          <Label htmlFor="post-caption" className="text-[13px] text-ink">
            Caption
          </Label>
          <span className={cn("text-xs tabular", over ? "text-danger" : "text-ink-3")}>
            {caption.length}/{CAPTION_MAX}
          </span>
        </div>
        <Textarea id="post-caption" value={caption} onChange={(e) => setCaption(e.target.value)} rows={8} aria-invalid={over || !!error || undefined} aria-describedby={error ? "post-caption-error" : undefined} />
        {error ? (
          <p id="post-caption-error" role="alert" className="text-xs text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </StudioSheet>
  )
}

function FeaturedRow({ post, index, count, onMove }: { post: StudioSocialPostDto; index: number; count: number; onMove: (by: -1 | 1) => void }) {
  const drag = useDragControls()
  const cover = coverOf(post)
  return (
    <Reorder.Item value={post} dragListener={false} dragControls={drag} as="li" className="flex min-w-0 list-none items-center gap-2 rounded-md border border-line-soft bg-card p-2" whileDrag={{ scale: 1.02 }}>
      <span
        aria-hidden
        onPointerDown={(e) => {
          e.preventDefault()
          drag.start(e)
        }}
        style={{ touchAction: "none" }}
        className="inline-flex h-10 w-6 shrink-0 cursor-grab items-center justify-center text-ink-3 hover:text-ink active:cursor-grabbing"
      >
        <DotsSixVerticalIcon className="size-4" />
      </span>
      <span className="relative size-10 shrink-0 overflow-hidden rounded-[4px] bg-surface">
        <Image src={cover.src} alt="" fill unoptimized sizes="40px" className="object-cover" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-ink">{post.caption || "Untitled post"}</span>
        <span className="block text-[11px] text-ink-3">
          {sourceChip(post)}, {shortDate(post.postedAt)}
        </span>
      </span>
      <Button type="button" variant="ghost" size="icon" className="size-10 md:size-8" aria-label="Move up" disabled={index === 0} onClick={() => onMove(-1)}>
        <ArrowUpIcon />
      </Button>
      <Button type="button" variant="ghost" size="icon" className="size-10 md:size-8" aria-label="Move down" disabled={index === count - 1} onClick={() => onMove(1)}>
        <ArrowDownIcon />
      </Button>
    </Reorder.Item>
  )
}

/** Arrange featured: drag or use the arrows; featured posts lead the storefront feed in this order. */
export function FeaturedSheet({ open, posts, onOpenChange, onSaved }: { open: boolean; posts: StudioSocialPostDto[]; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
  const [order, setOrder] = useState<StudioSocialPostDto[]>([])
  const [said, setSaid] = useState("")
  // Each time the sheet opens, start from the saved order.
  const [wasOpen, setWasOpen] = useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setOrder([...posts].sort((a, b) => (a.featureOrder ?? 999) - (b.featureOrder ?? 999)))
  }
  const save = useAsyncAction(() => setFeaturedOrder(order.map((p) => p.id)), {
    success: "Featured order saved",
    error: "Couldn't save the order. Try again.",
    onSuccess: () => {
      onSaved()
      onOpenChange(false)
    },
  })
  function move(i: number, by: -1 | 1) {
    const to = i + by
    if (to < 0 || to >= order.length) return
    const next = [...order]
    const [item] = next.splice(i, 1)
    next.splice(to, 0, item)
    setOrder(next)
    setSaid(`Moved to position ${to + 1} of ${next.length}.`)
  }
  return (
    <StudioSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Arrange featured posts"
      description="Featured posts on your storefront lead its Social feed, in this order, after any posts pinned in the storefront editor."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!order.length} loading={save.pending} success={save.succeeded} onClick={() => void save.run()}>
            Save order
          </Button>
        </>
      }
    >
      <p className="sr-only" aria-live="polite">
        {said}
      </p>
      {order.length ? (
        <Reorder.Group axis="y" values={order} onReorder={setOrder} as="ol" aria-label="Featured order" className="grid grid-cols-[minmax(0,1fr)] gap-2">
          {order.map((p, i) => (
            <FeaturedRow key={p.id} post={p} index={i} count={order.length} onMove={(by) => move(i, by)} />
          ))}
        </Reorder.Group>
      ) : (
        <p className="rounded-md border border-dashed border-line px-3 py-6 text-center text-sm text-ink-2">Nothing on your storefront is featured yet. Use Feature in a post&apos;s menu.</p>
      )}
    </StudioSheet>
  )
}
