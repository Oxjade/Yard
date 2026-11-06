"use client"

import { useEffect, useRef, useState } from "react"
import Image from "next/image"
import { motion } from "motion/react"
import { ArrowLeftIcon as ArrowLeft, ArrowRightIcon as ArrowRight, CheckIcon as Check, ImageSquareIcon as ImagePlus, CircleNotchIcon as Loader2, UploadSimpleIcon as Upload, XIcon as X } from "@phosphor-icons/react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { ImageAsset } from "@/lib/data/types"
import { cn } from "@/lib/utils"
import { FieldMessage, Panel } from "./fields"
import { MAX_IMAGES } from "./utils"

export type FormImage = ImageAsset & { key: string; processing?: boolean }

const MAX_BYTES = 15 * 1024 * 1024
let seq = 0
const nextKey = () => `img-${++seq}`

export const toFormImages = (list: ImageAsset[]): FormImage[] => list.map((im) => ({ ...im, key: nextKey() }))

function fileError(file: File) {
  if (!file.type.startsWith("image/")) return `${file.name} isn't an image. Use JPG, PNG or WebP files.`
  if (file.size > MAX_BYTES) return `${file.name} is over 15 MB. Use a smaller file.`
  return null
}

/**
 * Scales an upload down in the browser and returns a data URL, so the preview survives a
 * reload in this frontend phase. The backend phase uploads the original to storage instead.
 */
function compress(file: File, max = 1100, quality = 0.8) {
  return new Promise<{ src: string; width: number; height: number }>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new window.Image()
    image.onload = () => {
      try {
        const w = image.naturalWidth || max
        const h = image.naturalHeight || max
        const scale = Math.min(1, max / Math.max(w, h))
        const canvas = document.createElement("canvas")
        canvas.width = Math.max(1, Math.round(w * scale))
        canvas.height = Math.max(1, Math.round(h * scale))
        const ctx = canvas.getContext("2d")
        if (!ctx) throw new Error("canvas")
        ctx.fillStyle = "#080808"
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
        resolve({ src: canvas.toDataURL("image/jpeg", quality), width: canvas.width, height: canvas.height })
      } catch (e) {
        reject(e)
      } finally {
        URL.revokeObjectURL(url)
      }
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error("decode"))
    }
    image.src = url
  })
}

const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files")

export function ImageManager({
  images,
  onChange,
  error,
  productName,
  library,
}: {
  images: FormImage[]
  onChange: (update: (prev: FormImage[]) => FormImage[]) => void
  error?: string
  productName: string
  library: ImageAsset[]
}) {
  const input = useRef<HTMLInputElement>(null)
  const objectUrls = useRef(new Set<string>())
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [overKey, setOverKey] = useState<string | null>(null)
  const [fileOver, setFileOver] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const left = MAX_IMAGES - images.length
  const name = productName.trim() || "Product"

  useEffect(() => {
    const urls = objectUrls.current
    return () => urls.forEach((u) => URL.revokeObjectURL(u))
  }, [])

  function addFiles(list: FileList | File[] | null) {
    const files = Array.from(list ?? [])
    if (!files.length) return
    const bad = files.map(fileError).find(Boolean)
    if (bad) {
      setUploadError(bad)
      return
    }
    setUploadError(null)
    const take = files.slice(0, Math.max(0, left))
    if (files.length > take.length) toast(`Only ${MAX_IMAGES} photos fit`, { description: take.length ? `Added the first ${take.length}.` : "Remove a photo to add another." })
    if (!take.length) return

    // Instant preview from an object URL, then swap in the compressed copy when it's ready.
    const pending = take.map((file) => {
      const src = URL.createObjectURL(file)
      objectUrls.current.add(src)
      return { file, item: { key: nextKey(), src, alt: "", width: 1200, height: 1500, processing: true } satisfies FormImage }
    })
    onChange((prev) => [...prev, ...pending.map((p) => p.item)])
    for (const { file, item } of pending) {
      compress(file)
        .then((out) => {
          onChange((prev) => prev.map((im) => (im.key === item.key ? { ...im, ...out, processing: false } : im)))
        })
        .catch(() => {
          onChange((prev) => prev.filter((im) => im.key !== item.key))
          setUploadError(`We couldn't read ${file.name}. Try a JPG or PNG.`)
        })
        .finally(() => {
          URL.revokeObjectURL(item.src)
          objectUrls.current.delete(item.src)
        })
    }
    toast.success(take.length === 1 ? "Photo added" : `${take.length} photos added`)
  }

  function move(from: number, to: number) {
    onChange((prev) => {
      if (to < 0 || to >= prev.length || from === to) return prev
      const list = [...prev]
      const [im] = list.splice(from, 1)
      list.splice(to, 0, im)
      return list
    })
  }

  function moveKey(fromKey: string, toKey: string) {
    onChange((prev) => {
      const from = prev.findIndex((im) => im.key === fromKey)
      const to = prev.findIndex((im) => im.key === toKey)
      if (from < 0 || to < 0 || from === to) return prev
      const list = [...prev]
      const [im] = list.splice(from, 1)
      list.splice(to, 0, im)
      return list
    })
  }

  function remove(key: string) {
    onChange((prev) => prev.filter((im) => im.key !== key))
  }

  const describedBy = error || uploadError ? "photos-error" : "photos-hint"

  return (
    <Panel
      id="photos-panel"
      title="Photos"
      description="The first photo is the cover in your storefront, the marketplace and search. Drag to reorder."
      action={<span className="text-xs whitespace-nowrap text-ink-3 tabular">{images.length}/{MAX_IMAGES}</span>}
    >
      <div
        onDragOver={(e) => {
          if (!hasFiles(e)) return
          e.preventDefault()
          setFileOver(true)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setFileOver(false)
        }}
        onDrop={(e) => {
          if (!hasFiles(e)) return
          e.preventDefault()
          setFileOver(false)
          addFiles(e.dataTransfer.files)
        }}
        className={cn("grid grid-cols-3 gap-2 rounded-lg transition-[box-shadow] sm:grid-cols-4", fileOver && "ring-2 ring-violet ring-offset-4 ring-offset-card")}
      >
        {images.map((im, i) => (
          <motion.div
            layout
            key={im.key}
            transition={{ type: "spring", stiffness: 500, damping: 42 }}
            className={cn("relative aspect-[4/5]", i === 0 && "col-span-2 row-span-2")}
          >
            <div
              draggable={!im.processing}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move"
                e.dataTransfer.setData("text/plain", im.key)
                setDragKey(im.key)
              }}
              onDragEnd={() => {
                setDragKey(null)
                setOverKey(null)
              }}
              onDragOver={(e) => {
                if (!dragKey || hasFiles(e)) return
                e.preventDefault()
                if (overKey !== im.key) setOverKey(im.key)
              }}
              onDrop={(e) => {
                if (!dragKey || hasFiles(e)) return
                e.preventDefault()
                e.stopPropagation()
                moveKey(dragKey, im.key)
                setDragKey(null)
                setOverKey(null)
              }}
              className={cn(
                "group absolute inset-0 cursor-grab overflow-hidden rounded-md bg-surface active:cursor-grabbing",
                dragKey === im.key && "opacity-40",
                overKey === im.key && dragKey !== im.key && "ring-2 ring-violet",
              )}
            >
              <Image src={im.src} alt={im.alt || `${name}, photo ${i + 1}`} fill sizes={i === 0 ? "(min-width: 1024px) 360px, 66vw" : "(min-width: 1024px) 170px, 33vw"} loading={i === 0 ? "eager" : undefined} className="pointer-events-none object-cover" />
              {im.processing ? (
                <span className="absolute inset-0 flex items-center justify-center bg-obsidian/50">
                  <Loader2 className="size-5 animate-spin text-ink" aria-label="Preparing photo" />
                </span>
              ) : null}
              {i === 0 ? <span className="glass absolute top-2 left-2 rounded-[4px] px-1.5 py-0.5 text-[10px] text-ink">Cover</span> : null}
              <div className="absolute right-1.5 bottom-1.5 flex gap-1 transition-opacity pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100">
                {i > 0 ? (
                  <Button type="button" variant="glass" size="icon-xs" aria-label={i === 1 ? `Make photo ${i + 1} the cover` : `Move photo ${i + 1} earlier`} onClick={() => move(i, i - 1)}>
                    <ArrowLeft />
                  </Button>
                ) : null}
                {i < images.length - 1 ? (
                  <Button type="button" variant="glass" size="icon-xs" aria-label={`Move photo ${i + 1} later`} onClick={() => move(i, i + 1)}>
                    <ArrowRight />
                  </Button>
                ) : null}
                <Button type="button" variant="glass" size="icon-xs" aria-label={`Remove photo ${i + 1}`} onClick={() => remove(im.key)}>
                  <X />
                </Button>
              </div>
            </div>
          </motion.div>
        ))}
        {left > 0 ? (
          <button
            type="button"
            id="photos"
            // aria-invalid isn't allowed on a button (ARIA 1.2), so the error reaches it through aria-describedby and the danger border.
            aria-describedby={describedBy}
            onClick={() => input.current?.click()}
            className={cn(
              "flex aspect-[4/5] flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-line bg-surface/40 px-2 text-center text-ink-2 outline-none transition-colors hover:border-violet/60 hover:text-ink focus-visible:ring-2 focus-visible:ring-violet",
              images.length === 0 && "col-span-3 aspect-auto py-10 sm:col-span-4",
              error && "border-danger/70",
            )}
          >
            <Upload className="size-5" />
            <span className="text-xs text-ink">Add photos</span>
            <span className="text-[11px] text-ink-3">{images.length === 0 ? "Drop files here or click to choose. JPG, PNG or WebP, up to 15 MB each." : "or drop them here"}</span>
          </button>
        ) : null}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/avif,image/gif"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          addFiles(e.target.files)
          e.target.value = ""
        }}
      />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <FieldMessage id="photos" error={uploadError ?? error} hint="Portrait 4:5 works best. Use the arrows or drag to reorder." />
        <Button type="button" variant="ghost" size="sm" className="-mr-2" disabled={left === 0} onClick={() => setLibraryOpen(true)}>
          <ImagePlus /> Choose from your photos
        </Button>
      </div>
      <PhotoLibrary
        open={libraryOpen}
        onOpenChange={setLibraryOpen}
        photos={library}
        taken={new Set(images.map((im) => im.src))}
        slots={left}
        onAdd={(list) => {
          onChange((prev) => [...prev, ...toFormImages(list.map((im) => ({ ...im, alt: "" })))].slice(0, MAX_IMAGES))
          toast.success(list.length === 1 ? "Photo added" : `${list.length} photos added`)
        }}
      />
    </Panel>
  )
}

function PhotoLibrary({
  open,
  onOpenChange,
  photos,
  taken,
  slots,
  onAdd,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  photos: ImageAsset[]
  taken: Set<string>
  slots: number
  onAdd: (list: ImageAsset[]) => void
}) {
  const [picked, setPicked] = useState<string[]>([])

  function toggle(src: string) {
    setPicked((p) => (p.includes(src) ? p.filter((s) => s !== src) : p.length >= slots ? p : [...p, src]))
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) setPicked([])
      }}
    >
      <DialogContent className="flex max-h-[min(720px,calc(100dvh-2rem))] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Your photos</DialogTitle>
          <DialogDescription className="text-ink-2">Photos from your products, collections and drops. Pick up to {slots}.</DialogDescription>
        </DialogHeader>
        <div className="-mx-6 min-h-0 flex-1 overflow-y-auto px-6">
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {photos.map((im) => {
              const used = taken.has(im.src)
              const order = picked.indexOf(im.src)
              const on = order >= 0
              return (
                <li key={im.src}>
                  <button
                    type="button"
                    disabled={used || (!on && picked.length >= slots)}
                    aria-pressed={on}
                    aria-label={used ? `${im.alt} (already added)` : im.alt}
                    onClick={() => toggle(im.src)}
                    className={cn("relative block aspect-[4/5] w-full overflow-hidden rounded-md bg-surface outline-none focus-visible:ring-2 focus-visible:ring-violet disabled:cursor-not-allowed", used && "opacity-35")}
                  >
                    <Image src={im.src} alt="" fill sizes="(min-width: 640px) 150px, 30vw" className="object-cover" />
                    {on ? <span aria-hidden className="absolute inset-0 rounded-md border-2 border-purple" /> : null}
                    {on ? <span className="absolute top-1.5 right-1.5 inline-flex size-5 items-center justify-center rounded-full bg-purple text-[11px] text-ink tabular">{order + 1}</span> : null}
                    {used ? <span className="glass absolute top-1.5 left-1.5 inline-flex items-center gap-1 rounded-[4px] px-1.5 py-0.5 text-[10px] text-ink"><Check className="size-3" /> Added</span> : null}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
        <DialogFooter className="sm:items-center">
          <p className="mr-auto hidden text-xs text-ink-3 sm:block tabular">{picked.length} selected</p>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!picked.length}
            onClick={() => {
              onAdd(picked.map((src) => photos.find((p) => p.src === src)!).filter(Boolean))
              setPicked([])
              onOpenChange(false)
            }}
          >
            {picked.length > 1 ? `Add ${picked.length} photos` : "Add photo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
