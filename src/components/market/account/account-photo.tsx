"use client"

import { useEffect, useRef, useState } from "react"
import { CameraIcon, MagnifyingGlassMinusIcon, MagnifyingGlassPlusIcon, TrashSimpleIcon } from "@phosphor-icons/react"
import { toast } from "sonner"
import { PhotoOrInitials } from "@/components/media/person-photo"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Slider } from "@/components/ui/slider"
import { api, ApiError } from "@/lib/api/client"
import { errorMessage, formatWait } from "@/lib/api/errors"
import { apiAccountPhotoUpload } from "@/lib/api/upload"
import { clampOffset, displayScale, isHeic, MAX_ZOOM, MIN_ZOOM, outputSide, photoFileProblem, PHOTO_MIN_SIDE, sourceSquare, zoomTo, type Offset } from "@/lib/media/photo-crop"
import { refreshServerSession } from "@/lib/session/use-server-session"
import type { AccountDto } from "./account-details"

type Picked = { url: string; width: number; height: number; image: HTMLImageElement }

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("")

function decode(file: File): Promise<Picked> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => resolve({ url, width: image.naturalWidth, height: image.naturalHeight, image })
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(isHeic(file) ? "This browser can't open HEIC photos. Export it as JPEG and try again." : "This photo couldn't be read. Try exporting it again as JPEG."))
    }
    image.src = url
  })
}

/** The cropped square as a JPEG (no metadata: a canvas re-encode), at most 1024 px. */
function renderCrop(p: Picked, frame: number, zoom: number, offset: Offset): Promise<Blob> {
  const { sx, sy, size } = sourceSquare(p, frame, zoom, offset)
  const side = outputSide(size)
  const canvas = document.createElement("canvas")
  canvas.width = side
  canvas.height = side
  const ctx = canvas.getContext("2d")
  if (!ctx) return Promise.reject(new Error("This browser can't prepare photos for upload."))
  ctx.fillStyle = "#080808"
  ctx.fillRect(0, 0, side, side)
  ctx.imageSmoothingQuality = "high"
  ctx.drawImage(p.image, sx, sy, size, size, 0, 0, side, side)
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("This photo couldn't be prepared."))), "image/jpeg", 0.9))
}

function uploadError(e: unknown) {
  if (e instanceof ApiError) {
    if (e.code === "too_large") return "Photos can be up to 10 MB."
    if (e.code === "unsupported_type") return "Yard couldn't read this as a JPEG, PNG or WebP photo. Try another one."
    if (e.code === "rate_limited") return `You've changed your photo a lot. Try again in ${formatWait(e.retryAfter ?? 600)}.`
  }
  return errorMessage(e, "Your photo wasn't saved. Try again.")
}
const retryable = (e: unknown) => !(e instanceof ApiError) || e.status === 0 || e.status === 429 || e.status >= 500

/**
 * Settings › Your details: the profile photo. Pick a file, position it in a square in the crop
 * sheet, save. The new photo shows at once while it uploads; on failure the old one comes back
 * with the reason and, when sending again could work, Try again. Remove goes back to initials.
 */
export function AccountPhoto({ account, as, onAccount }: { account: AccountDto; as: "shopper" | "brand"; onAccount: (a: AccountDto) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [picked, setPicked] = useState<Picked | null>(null)
  const [pending, setPending] = useState<{ url: string; blob: Blob } | null>(null)
  const [error, setError] = useState<{ text: string; retry: boolean } | null>(null)
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null)

  // Release object URLs when they're replaced and on unmount.
  useEffect(() => () => (picked ? URL.revokeObjectURL(picked.url) : undefined), [picked])
  useEffect(() => () => (pending ? URL.revokeObjectURL(pending.url) : undefined), [pending])

  const shown = pending?.url ?? account.photo?.src ?? null
  const demo = account.demo

  const choose = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    const problem = photoFileProblem(file)
    if (problem) return setError({ text: problem, retry: false })
    try {
      const p = await decode(file)
      if (p.width < PHOTO_MIN_SIDE || p.height < PHOTO_MIN_SIDE) {
        URL.revokeObjectURL(p.url)
        return setError({ text: "This photo is smaller than 64 px on a side. Use a larger one.", retry: false })
      }
      setPicked(p)
    } catch (e) {
      setError({ text: (e as Error).message, retry: false })
    }
  }

  const upload = async (blob: Blob) => {
    setBusy("upload")
    setError(null)
    try {
      const next = await apiAccountPhotoUpload<AccountDto>(Object.assign(blob, { name: "photo.jpg" }), as).promise
      onAccount(next)
      setPending(null)
      void refreshServerSession()
      toast("Photo saved")
    } catch (e) {
      setError({ text: uploadError(e), retry: retryable(e) })
    } finally {
      setBusy(null)
    }
  }

  const save = async (blob: Blob) => {
    // Optimistic: the cropped photo shows straight away; it reverts if the upload fails.
    setPending({ url: URL.createObjectURL(blob), blob })
    setPicked(null)
    await upload(blob)
  }

  const remove = async () => {
    setBusy("remove")
    setError(null)
    try {
      const r = await api<{ account: AccountDto }>("/api/account/photo", { method: "DELETE", query: { as } })
      onAccount(r.account)
      void refreshServerSession()
      toast("Photo removed")
    } catch (e) {
      setError({ text: errorMessage(e, "Your photo wasn't removed. Try again."), retry: false })
    } finally {
      setBusy(null)
    }
  }

  const failed = !!error && !!pending
  return (
    <div className="grid gap-2">
      <p className="text-sm text-ink">Photo</p>
      <div className="flex flex-wrap items-center gap-4">
        <span className={`relative inline-flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-purple text-xl font-semibold text-ink ${failed ? "opacity-60" : ""}`}>
          <PhotoOrInitials src={failed ? (account.photo?.src ?? null) : shown}>
            <span aria-hidden>{initialsOf(account.name)}</span>
          </PhotoOrInitials>
          {busy === "upload" ? <span aria-hidden className="absolute inset-0 animate-pulse bg-black/35" /> : null}
        </span>
        <div className="flex flex-wrap gap-2">
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              void choose(e.target.files?.[0])
              e.target.value = ""
            }}
          />
          <Button variant="secondary" size="sm" disabled={demo || !!busy} loading={busy === "upload"} onClick={() => input.current?.click()}>
            <CameraIcon /> {account.photo || pending ? "Change photo" : "Add photo"}
          </Button>
          {account.photo && !pending ? (
            <Button variant="ghost" size="sm" disabled={demo || !!busy} loading={busy === "remove"} onClick={() => void remove()}>
              <TrashSimpleIcon /> Remove
            </Button>
          ) : null}
        </div>
      </div>
      {error ? (
        <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-xs text-danger">{error.text}</p>
          {error.retry && pending ? (
            <Button variant="ghost" size="sm" onClick={() => void upload(pending.blob)}>
              Try again
            </Button>
          ) : null}
          {pending && !busy ? (
            <Button variant="ghost" size="sm" onClick={() => setPending(null)}>
              Discard
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-ink-3">{demo ? "Demo accounts can't change their photo." : as === "brand" ? "Shown to your team in Studio. It's the same photo as your Yard account." : "Shows to brands you message or buy from. JPEG, PNG or WebP, up to 10 MB."}</p>
      )}
      <CropSheet picked={picked} onCancel={() => setPicked(null)} onSave={(b) => void save(b)} />
    </div>
  )
}

/** The square crop step: drag to position, zoom with the slider, the wheel or a pinch-free +/−. */
function CropSheet({ picked, onCancel, onSave }: { picked: Picked | null; onCancel: () => void; onSave: (b: Blob) => void }) {
  const [last, setLast] = useState<Picked | null>(picked)
  if (picked && picked !== last) setLast(picked)
  const p = picked ?? last
  return (
    <Sheet open={!!picked} onOpenChange={(o) => !o && onCancel()}>
      <SheetContent side="bottom" className="mx-auto max-w-lg rounded-t-2xl border-white/10 bg-[var(--glass-bg-strong)] backdrop-blur-xl lg:bottom-6 lg:rounded-2xl lg:border">
        <SheetHeader className="pr-12">
          <SheetTitle>Position your photo</SheetTitle>
          <SheetDescription className="text-ink-2">Drag to move it. Zoom to fit your face in the circle.</SheetDescription>
        </SheetHeader>
        {p ? <Cropper key={p.url} picked={p} onCancel={onCancel} onSave={onSave} /> : null}
      </SheetContent>
    </Sheet>
  )
}

function Cropper({ picked, onCancel, onSave }: { picked: Picked; onCancel: () => void; onSave: (b: Blob) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const [frame, setFrame] = useState(288)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 })
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const drag = useRef<{ id: number; x: number; y: number; from: Offset } | null>(null)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => setFrame(Math.max(160, Math.round(el.clientWidth)))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const setZoomKeep = (z: number) => {
    const next = zoomTo(picked, frame, { zoom, offset }, z)
    setZoom(next.zoom)
    setOffset(next.offset)
  }
  const o = clampOffset(picked, frame, zoom, offset)
  const s = displayScale(picked, frame, zoom)
  const w = picked.width * s
  const h = picked.height * s

  const save = async () => {
    setSaving(true)
    setProblem(null)
    try {
      onSave(await renderCrop(picked, frame, zoom, o))
    } catch (e) {
      setProblem((e as Error).message)
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-4 px-4">
      <div
        ref={box}
        role="img"
        aria-label="Photo crop area. Use the arrow keys to move the photo, plus and minus to zoom."
        tabIndex={0}
        className="relative mx-auto aspect-square w-full max-w-[18rem] cursor-grab touch-none overflow-hidden rounded-lg bg-black outline-none select-none focus-visible:ring-2 focus-visible:ring-violet active:cursor-grabbing"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, from: o }
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d || d.id !== e.pointerId) return
          setOffset(clampOffset(picked, frame, zoom, { x: d.from.x + e.clientX - d.x, y: d.from.y + e.clientY - d.y }))
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onWheel={(e) => setZoomKeep(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08))}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 24 : 8
          const move: Record<string, Offset> = { ArrowLeft: { x: step, y: 0 }, ArrowRight: { x: -step, y: 0 }, ArrowUp: { x: 0, y: step }, ArrowDown: { x: 0, y: -step } }
          if (move[e.key]) {
            e.preventDefault()
            setOffset(clampOffset(picked, frame, zoom, { x: o.x + move[e.key].x, y: o.y + move[e.key].y }))
          } else if (e.key === "+" || e.key === "=") setZoomKeep(zoom + 0.25)
          else if (e.key === "-") setZoomKeep(zoom - 0.25)
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={picked.url}
          alt=""
          draggable={false}
          className="pointer-events-none absolute top-1/2 left-1/2 max-w-none"
          style={{ width: w, height: h, transform: `translate(calc(-50% + ${o.x}px), calc(-50% + ${o.y}px))` }}
        />
        {/* What shows in a round avatar: everything outside the circle is dimmed. */}
        <span aria-hidden className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_999px_rgba(8,8,8,0.6)] ring-1 ring-white/40" />
      </div>
      <div className="mx-auto flex w-full max-w-[18rem] items-center gap-3">
        <button type="button" aria-label="Zoom out" onClick={() => setZoomKeep(zoom - 0.25)} className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-ink-2 hover:bg-white/[0.06] hover:text-ink">
          <MagnifyingGlassMinusIcon className="size-4" />
        </button>
        <Slider aria-label="Zoom" min={MIN_ZOOM} max={MAX_ZOOM} step={0.01} value={[zoom]} onValueChange={([z]) => setZoomKeep(z)} className="flex-1" />
        <button type="button" aria-label="Zoom in" onClick={() => setZoomKeep(zoom + 0.25)} className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-ink-2 hover:bg-white/[0.06] hover:text-ink">
          <MagnifyingGlassPlusIcon className="size-4" />
        </button>
      </div>
      {problem ? (
        <p role="alert" className="text-center text-xs text-danger">
          {problem}
        </p>
      ) : null}
      <SheetFooter className="px-0 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row-reverse">
        <Button variant="primary" loading={saving} onClick={() => void save()} className="sm:flex-1">
          Save photo
        </Button>
        <Button variant="secondary" onClick={onCancel} className="sm:flex-1">
          Cancel
        </Button>
      </SheetFooter>
    </div>
  )
}
