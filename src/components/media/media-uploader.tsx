"use client"

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react"
import { ArrowClockwiseIcon, CheckCircleIcon, FilmStripIcon, ImageIcon, UploadSimpleIcon, WarningCircleIcon, XIcon } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { ApiError } from "@/lib/api/client"
import type { MediaDto, UploadPurpose } from "@/lib/api/contracts/uploads"
import { errorMessage, formatWait } from "@/lib/api/errors"
import { apiUpload, type UploadTarget } from "@/lib/api/upload"
import { ImagePrepareError, imageTypeProblem, prepareImage } from "@/lib/media/prepare-image"
import { cn } from "@/lib/utils"

/**
 * The one upload control (§5.4, §6.1): a drop zone and file input; images are resized and
 * re-encoded in the browser (no location data) before upload; every file shows real XHR
 * progress with Cancel; errors stay inline per file with Retry. S builds its upload sheet on it,
 * A its place photos, I its attachments.
 */

export type UploadState = "preparing" | "uploading" | "done" | "error"

export type UploadItem = {
  key: string
  name: string
  size: number
  kind: "image" | "video"
  /** An object URL for the thumbnail. */
  preview?: string
  state: UploadState
  /** 0..1, real bytes sent. */
  progress: number
  error?: string
  /** The original file is still held, so Retry can resend it. */
  retryable?: boolean
  media?: MediaDto
}

type Uploader = (file: Blob & { name?: string }, target: UploadTarget, onProgress: (f: number) => void) => { promise: Promise<MediaDto>; abort: () => void }

type Props = {
  purpose: UploadPurpose
  as: "shopper" | "brand"
  conversationId?: string
  brandId?: string
  /** Most files at once (default 10 for posts, 6 for places, 4 for attachments). */
  maxFiles?: number
  /** Videos are only accepted for social posts (§5.4 step 3). */
  allowVideo?: boolean
  disabled?: boolean
  /** Why it's disabled, shown in place of the drop zone's hint. */
  disabledReason?: string
  onUploaded?: (media: MediaDto) => void
  onRemoved?: (media: MediaDto) => void
  /** Replaces the network call (tests). Defaults to apiUpload. */
  uploader?: Uploader
  className?: string
}

const MB = 1024 * 1024
const capFor = (purpose: UploadPurpose, kind: "image" | "video") => (purpose === "inbox_attachment" ? 8 * MB : kind === "video" ? 50 * MB : 10 * MB)
const sizeText = (bytes: number) => (bytes >= MB ? `${(bytes / MB).toFixed(bytes >= 10 * MB ? 0 : 1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)
const VIDEO = /^video\/(mp4|webm)$/

/** What an upload failure says, per file (§6.1). */
export function uploadErrorCopy(e: unknown, kind: "image" | "video", purpose: UploadPurpose) {
  if (e instanceof ImagePrepareError) return e.message
  if (e instanceof ApiError) {
    if (e.code === "too_large") return kind === "video" ? "Videos can be up to 50 MB." : purpose === "inbox_attachment" ? "Photos can be up to 8 MB." : "Photos can be up to 10 MB."
    // The file already had an allowed extension and type: the server read its bytes as something else.
    if (e.code === "unsupported_type") return kind === "video" ? "Yard couldn't read this as an MP4 or WebM video. Export it again and add it." : "Yard couldn't read this as a JPEG, PNG or WebP photo. Export it again and add it."
    if (e.code === "rate_limited") return `You've uploaded a lot in the last few minutes. Try again in ${formatWait(e.retryAfter ?? 600)}.`
    // The target (a conversation, or the brand of a new one) was removed or is no longer visible.
    if (e.status === 404) return purpose === "inbox_attachment" ? "This conversation isn't available any more. Reload and try again." : errorMessage(e, "We couldn't find that.")
  }
  return errorMessage(e, "The upload didn't go through. Try again.")
}

/**
 * Whether sending the same file again could work: only after a network failure, a server error
 * (5xx) or a rate limit (429, once its wait has passed). A refusal of the file itself (size, type,
 * dimensions, validation) or of the target (401, 403, 404) fails the same way every time.
 */
export function uploadRetryable(e: unknown) {
  if (e instanceof ImagePrepareError) return false
  if (e instanceof ApiError) return e.status === 0 || e.status === 429 || e.status >= 500
  return true
}

/** Touch screens have no drag and drop: the zone says "Add" there instead of "Drop". */
function useCoarsePointer() {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia("(pointer: coarse)")
      mq.addEventListener("change", cb)
      return () => mq.removeEventListener("change", cb)
    },
    () => window.matchMedia("(pointer: coarse)").matches,
    () => false,
  )
}

export function MediaUploader({ purpose, as, conversationId, brandId, maxFiles, allowVideo = false, disabled = false, disabledReason, onUploaded, onRemoved, uploader = apiUpload, className }: Props) {
  const uid = useId()
  const input = useRef<HTMLInputElement>(null)
  const [items, setItems] = useState<UploadItem[]>([])
  const [dragging, setDragging] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const aborts = useRef(new Map<string, () => void>())
  const files = useRef(new Map<string, File>())
  const counter = useRef(0)
  // Every preview object URL this uploader still holds, so unmount can release them all.
  const previews = useRef(new Set<string>())
  const coarse = useCoarsePointer()
  const limit = maxFiles ?? (purpose === "social_post" ? 10 : purpose === "location_image" ? 6 : 4)
  const accept = allowVideo ? "image/jpeg,image/png,image/webp,video/mp4,video/webm" : "image/jpeg,image/png,image/webp"

  // Abort uploads and release previews on unmount.
  useEffect(() => {
    const a = aborts.current
    const urls = previews.current
    return () => {
      for (const abort of a.values()) abort()
      for (const url of urls) URL.revokeObjectURL(url)
      urls.clear()
    }
  }, [])

  const patch = (key: string, p: Partial<UploadItem>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...p } : i)))
  /** Releases a row's thumbnail and shows the file-kind placeholder instead. */
  const dropPreview = (key: string) =>
    setItems((list) =>
      list.map((i) => {
        if (i.key !== key || !i.preview) return i
        URL.revokeObjectURL(i.preview)
        previews.current.delete(i.preview)
        return { ...i, preview: undefined }
      }),
    )

  async function start(key: string, file: File) {
    const kind = VIDEO.test(file.type) ? "video" : "image"
    patch(key, { state: kind === "image" ? "preparing" : "uploading", progress: 0, error: undefined })
    try {
      const ready = kind === "image" ? await prepareImage(file) : file
      if (ready.size > capFor(purpose, kind)) throw new ApiError(413, "too_large", "Too large")
      patch(key, { state: "uploading", progress: 0 })
      const { promise, abort } = uploader(ready, { purpose, as, conversationId, brandId }, (f) => patch(key, { progress: f }))
      aborts.current.set(key, abort)
      const media = await promise
      aborts.current.delete(key)
      patch(key, { state: "done", progress: 1, media })
      onUploaded?.(media)
    } catch (e) {
      aborts.current.delete(key)
      if (e instanceof DOMException && e.name === "AbortError") {
        setItems((list) => list.filter((i) => i.key !== key))
        return
      }
      // The browser couldn't read the bytes as an image: its thumbnail would be a broken image too.
      if (e instanceof ImagePrepareError) dropPreview(key)
      patch(key, { state: "error", error: uploadErrorCopy(e, kind, purpose), retryable: uploadRetryable(e) })
    }
  }

  function add(list: FileList | File[]) {
    setNotice(null)
    const incoming = [...list]
    // Every row counts, failed ones too (Retry can turn them into uploads), until it's removed.
    const room = Math.max(0, limit - items.length)
    if (incoming.length > room) {
      const left = incoming.length - room
      setNotice(
        room > 0
          ? `Only ${room} more ${room === 1 ? "fits" : "fit"} here, so ${left} ${left === 1 ? "file wasn't" : "files weren't"} added.`
          : `That's the most files for this (${limit}). Remove one to add another.`,
      )
    }
    for (const file of incoming.slice(0, room)) {
      counter.current += 1
      const key = `${uid}-${counter.current}`
      const video = VIDEO.test(file.type)
      const problem = video ? (allowVideo ? null : "Videos can only be added to posts.") : imageTypeProblem(file)?.message
      const kind = video ? "video" : "image"
      const tooBig = !problem && file.size > (video ? 50 * MB : 25 * MB) ? (video ? "Videos can be up to 50 MB." : "This photo is over 25 MB. Use a smaller one.") : null
      const preview = !problem && !video ? URL.createObjectURL(file) : undefined
      if (preview) previews.current.add(preview)
      const item: UploadItem = { key, name: file.name, size: file.size, kind, preview, state: problem || tooBig ? "error" : "preparing", progress: 0, error: problem ?? tooBig ?? undefined, retryable: !problem && !tooBig }
      setItems((l) => [...l, item])
      if (!problem && !tooBig) {
        files.current.set(key, file)
        void start(key, file)
      }
    }
  }

  function remove(item: UploadItem) {
    aborts.current.get(item.key)?.()
    aborts.current.delete(item.key)
    files.current.delete(item.key)
    if (item.preview) {
      URL.revokeObjectURL(item.preview)
      previews.current.delete(item.preview)
    }
    setItems((l) => l.filter((i) => i.key !== item.key))
    if (item.media) onRemoved?.(item.media)
  }

  const note =
    purpose === "social_post"
      ? "Photos are resized and their location data is removed. Videos are uploaded as they are — turn off location in your camera or editor first."
      : "Photos are resized and their location data is removed."

  return (
    <div className={cn("grid gap-3", className)}>
      <div
        onDragOver={(e) => {
          if (disabled) return
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          if (!disabled && e.dataTransfer.files.length) add(e.dataTransfer.files)
        }}
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-7 text-center transition-colors duration-150",
          dragging ? "border-purple bg-purple/10" : "border-line bg-card",
          disabled && "opacity-60",
        )}
      >
        <span aria-hidden className="inline-flex size-10 items-center justify-center rounded-full border border-white/10 text-ink-2">
          <UploadSimpleIcon className="size-[18px]" />
        </span>
        <p className="text-sm text-ink">{coarse ? (allowVideo ? "Add photos or a video" : "Add photos") : allowVideo ? "Drop photos or a video here" : "Drop photos here"}</p>
        <p id={`${uid}-hint`} className="text-xs text-ink-3">
          {disabled && disabledReason ? disabledReason : allowVideo ? "JPEG, PNG or WebP up to 10 MB; MP4 or WebM up to 50 MB." : purpose === "inbox_attachment" ? "JPEG, PNG or WebP up to 8 MB." : "JPEG, PNG or WebP up to 10 MB."}
        </p>
        {/* 40px on phones (the only way to add files on touch screens); the compact size from sm up. */}
        <Button type="button" variant="secondary" className="sm:h-8 sm:px-3 sm:text-[0.8125rem]" disabled={disabled} onClick={() => input.current?.click()} aria-describedby={`${uid}-hint`}>
          Choose {allowVideo ? "files" : limit === 1 ? "a photo" : "photos"}
        </Button>
        <input
          ref={input}
          type="file"
          accept={accept}
          multiple={limit > 1}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            if (e.target.files?.length) add(e.target.files)
            e.target.value = ""
          }}
        />
      </div>
      <p className="text-xs text-ink-3">{note}</p>
      {notice ? (
        <p role="status" className="text-xs text-ink-2">
          {notice}
        </p>
      ) : null}
      {items.length ? (
        <ul className="grid gap-2" aria-label="Uploads">
          {items.map((item) => (
            <UploadRow
              key={item.key}
              item={item}
              onCancel={() => remove(item)}
              onRetry={() => {
                const f = files.current.get(item.key)
                if (f) void start(item.key, f)
              }}
              canRetry={!!item.retryable}
            />
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/** One file's row: thumbnail, name and size, then its state: real progress, done, or the error with Retry. */
export function UploadRow({ item, onCancel, onRetry, canRetry = true }: { item: UploadItem; onCancel?: () => void; onRetry?: () => void; canRetry?: boolean }) {
  const pct = Math.round(item.progress * 100)
  const Kind = item.kind === "video" ? FilmStripIcon : ImageIcon
  // A preview the browser can't decode shows the file-kind placeholder, never a broken image.
  const [brokenPreview, setBrokenPreview] = useState<string | null>(null)
  const preview = item.preview && item.preview !== brokenPreview ? item.preview : undefined
  return (
    <li className={cn("flex items-center gap-3 rounded-lg border bg-card p-2.5", item.state === "error" ? "border-danger/40" : "border-line-soft")}>
      <span className="relative inline-flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-elevated">
        {preview ? (
          // A local object URL: next/image can't optimise it.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" className="size-full object-cover" onError={() => setBrokenPreview(preview)} />
        ) : (
          <Kind aria-hidden className="size-5 text-ink-3" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-ink">{item.name}</span>
        {item.state === "error" ? (
          <span role="alert" className="mt-0.5 flex items-start gap-1 text-xs text-danger">
            <WarningCircleIcon aria-hidden className="mt-px size-3.5 shrink-0" />
            {item.error}
          </span>
        ) : item.state === "done" ? (
          <span className="mt-0.5 flex items-center gap-1 text-xs text-ink-2">
            <CheckCircleIcon aria-hidden weight="fill" className="size-3.5 text-violet" /> Uploaded, {sizeText(item.media?.bytes ?? item.size)}
          </span>
        ) : (
          <span className="mt-1 grid gap-1">
            <span className="text-xs text-ink-2 tabular">{item.state === "preparing" ? "Preparing…" : `Uploading ${pct}%`}</span>
            <span
              role="progressbar"
              aria-label={`Uploading ${item.name}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={item.state === "preparing" ? undefined : pct}
              className="block h-1 overflow-hidden rounded-full bg-white/[0.08]"
            >
              <span className="block h-full rounded-full bg-violet transition-[width] duration-150 motion-reduce:transition-none" style={{ width: `${item.state === "preparing" ? 0 : pct}%` }} />
            </span>
          </span>
        )}
      </span>
      {item.state === "error" && canRetry && onRetry ? (
        <Button type="button" size="icon" variant="ghost" onClick={onRetry} aria-label={`Retry ${item.name}`}>
          <ArrowClockwiseIcon />
        </Button>
      ) : null}
      {onCancel ? (
        <Button type="button" size="icon" variant="ghost" onClick={onCancel} aria-label={item.state === "uploading" || item.state === "preparing" ? `Cancel ${item.name}` : `Remove ${item.name}`}>
          <XIcon />
        </Button>
      ) : null}
    </li>
  )
}
