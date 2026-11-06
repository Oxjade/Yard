"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { CheckCircleIcon, WarningCircleIcon } from "@phosphor-icons/react"
import { MediaUploader } from "@/components/media/media-uploader"
import { ItemPicker } from "@/components/studio/storefront-editor/sections-controls"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { useAsyncAction } from "@/hooks/use-async-action"
import { CAPTION_MAX, POST_PRODUCTS_MAX } from "@/lib/api/contracts/social"
import type { MediaDto } from "@/lib/api/contracts/uploads"
import { errorMessage, fieldErrors } from "@/lib/api/errors"
import { createPosts } from "@/lib/api/social"
import { apiUpload, type UploadTarget } from "@/lib/api/upload"
import { productsOf } from "@/lib/data"
import { formatMoney } from "@/lib/money"
import { cn } from "@/lib/utils"
import { StudioSheet } from "./shared"

type PosterState = { state: "loading" | "saving" | "done" | "error"; media?: MediaDto; progress: number; message?: string }

/**
 * A video's poster: a frame grabbed in the browser from Yard's own copy of the video (same
 * origin, so the canvas can read it), at 1 s by default. The brand can scrub to another frame;
 * the frame is uploaded as a photo with real progress and becomes the post's poster.
 */
function PosterPicker({ video, onPoster }: { video: MediaDto; onPoster: (poster: MediaDto | null) => void }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [duration, setDuration] = useState(0)
  const [at, setAt] = useState(1)
  const [poster, setPoster] = useState<PosterState>({ state: "loading", progress: 0 })
  const auto = useRef(true)
  const onPosterRef = useRef(onPoster)
  useEffect(() => {
    onPosterRef.current = onPoster
  })

  const capture = useCallback(async () => {
    const el = ref.current
    if (!el || !el.videoWidth) return
    const scale = Math.min(1, 1600 / Math.max(el.videoWidth, el.videoHeight))
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(64, Math.round(el.videoWidth * scale))
    canvas.height = Math.max(64, Math.round(el.videoHeight * scale))
    const ctx = canvas.getContext("2d")
    if (!ctx) return setPoster({ state: "error", progress: 0, message: "This browser can't grab a poster frame." })
    ctx.drawImage(el, 0, 0, canvas.width, canvas.height)
    setPoster({ state: "saving", progress: 0 })
    try {
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/jpeg", 0.86))
      const file = new File([blob], "poster.jpg", { type: "image/jpeg" })
      const media = await apiUpload(file, { purpose: "social_post", as: "brand" }, (f) => setPoster((p) => ({ ...p, progress: f }))).promise
      setPoster({ state: "done", media, progress: 1 })
      onPosterRef.current(media)
    } catch (e) {
      setPoster({ state: "error", progress: 0, message: errorMessage(e, "The poster didn't save. Try another frame.") })
      onPosterRef.current(null)
    }
  }, [])

  return (
    <div className="grid gap-2 rounded-lg border border-line-soft bg-card p-3">
      <p className="text-[13px] text-ink">Poster frame</p>
      <div className="relative overflow-hidden rounded-md bg-obsidian">
        <video
          ref={ref}
          src={video.src}
          muted
          playsInline
          preload="auto"
          className="mx-auto max-h-56 w-full object-contain"
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration
            setDuration(Number.isFinite(d) ? d : 0)
            const first = Math.min(1, (Number.isFinite(d) ? d : 1) / 2)
            setAt(first)
            e.currentTarget.currentTime = first
          }}
          onSeeked={() => {
            if (auto.current) {
              auto.current = false
              void capture()
            }
          }}
          onError={() => setPoster({ state: "error", progress: 0, message: "This video couldn't be read here, so it has no poster. It still plays on your storefront if the browser supports it." })}
        />
      </div>
      {duration > 0 ? (
        <div className="grid gap-1">
          <Label htmlFor={`poster-${video.id}`} className="text-xs text-ink-2">
            Scrub to choose a frame
          </Label>
          <input
            id={`poster-${video.id}`}
            type="range"
            min={0}
            max={duration}
            step={0.1}
            value={at}
            onChange={(e) => {
              const t = Number(e.target.value)
              setAt(t)
              if (ref.current) ref.current.currentTime = t
            }}
            className="h-10 w-full accent-[var(--color-purple)]"
          />
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-2" role="status">
          {poster.state === "loading" ? (
            "Reading the video…"
          ) : poster.state === "saving" ? (
            <span className="tabular">Saving the poster {Math.round(poster.progress * 100)}%</span>
          ) : poster.state === "done" ? (
            <span className="inline-flex items-center gap-1">
              <CheckCircleIcon weight="fill" className="size-3.5 text-violet" aria-hidden /> Poster saved
            </span>
          ) : (
            <span className="inline-flex items-start gap-1 text-danger">
              <WarningCircleIcon className="mt-px size-3.5 shrink-0" aria-hidden /> {poster.message}
            </span>
          )}
        </p>
        <Button type="button" variant="secondary" size="sm" className="h-10 md:h-8" disabled={!duration || poster.state === "saving"} onClick={() => void capture()}>
          Use this frame
        </Button>
      </div>
    </div>
  )
}

/**
 * The upload sheet (§6.1), built on the shared MediaUploader (purpose social_post): photos are
 * resized and re-encoded in the browser, every file shows real XHR progress with Cancel, errors
 * stay inline per file. Caption, tagged pieces, "Post as one carousel" (several photos) and
 * "Show on my storefront now", then POST /api/studio/social/posts.
 */
export function UploadSheet({ open, onOpenChange, brandId, onPosted }: { open: boolean; onOpenChange: (o: boolean) => void; brandId: string; onPosted: () => void }) {
  const products = useMemo(() => productsOf(brandId), [brandId])
  const [round, setRound] = useState(0)
  const [media, setMedia] = useState<MediaDto[]>([])
  const [posters, setPosters] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(0)
  const [caption, setCaption] = useState("")
  const [tags, setTags] = useState<string[]>([])
  const [carousel, setCarousel] = useState(false)
  const [publish, setPublish] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setRound((r) => r + 1)
    setMedia([])
    setPosters({})
    setBusy(0)
    setCaption("")
    setTags([])
    setCarousel(false)
    setPublish(true)
    setError(null)
  }

  const uploader = useCallback((file: Blob & { name?: string }, target: UploadTarget, onProgress: (f: number) => void) => {
    setBusy((n) => n + 1)
    const handle = apiUpload(file, target, onProgress)
    handle.promise.then(
      () => setBusy((n) => Math.max(0, n - 1)),
      () => setBusy((n) => Math.max(0, n - 1)),
    )
    return handle
  }, [])

  const images = media.filter((m) => m.kind === "image")
  const videos = media.filter((m) => m.kind === "video")
  const over = caption.length > CAPTION_MAX
  const canCarousel = images.length > 1 && videos.length === 0
  const asCarousel = canCarousel && carousel
  const count = asCarousel ? 1 : media.length

  const submit = useAsyncAction(
    () => createPosts({ mediaIds: media.map((m) => m.id), posters, caption, productIds: tags, publish, carousel: asCarousel }),
    {
      success: (r) => (publish ? `${r.posts.length === 1 ? "Post" : `${r.posts.length} posts`} added to your storefront` : `${r.posts.length === 1 ? "Post" : `${r.posts.length} posts`} saved as ${r.posts.length === 1 ? "a draft" : "drafts"}`),
      errorToast: false,
      onSuccess: () => {
        onPosted()
        onOpenChange(false)
        reset()
      },
      onError: (e) => {
        const f = fieldErrors(e)
        setError(Object.values(f)[0] ?? errorMessage(e))
      },
    },
  )

  return (
    <StudioSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Upload posts"
      description="Photos and videos you upload stay on Yard. They show on your storefront's Social feed."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!media.length || busy > 0 || over} loading={submit.pending} success={submit.succeeded} onClick={() => void submit.run()}>
            {busy > 0 ? "Uploading…" : publish ? (count > 1 ? `Post ${count}` : "Post") : count > 1 ? `Save ${count} drafts` : "Save draft"}
          </Button>
        </>
      }
    >
      <div className="grid gap-5">
        <MediaUploader
          key={round}
          purpose="social_post"
          as="brand"
          allowVideo
          maxFiles={10}
          uploader={uploader}
          onUploaded={(m) => setMedia((list) => [...list, m])}
          onRemoved={(m) => {
            setMedia((list) => list.filter((x) => x.id !== m.id))
            setPosters((p) => {
              const next = { ...p }
              delete next[m.id]
              return next
            })
          }}
        />
        {videos.length > 1 ? <p className="text-xs text-danger">Upload one video at a time. Remove the others to post this one.</p> : null}
        {videos.map((v) => (
          <PosterPicker
            key={v.id}
            video={v}
            onPoster={(p) =>
              setPosters((all) => {
                const next = { ...all }
                if (p) next[v.id] = p.id
                else delete next[v.id]
                return next
              })
            }
          />
        ))}

        <div className="grid gap-1.5">
          <div className="flex items-baseline justify-between">
            <Label htmlFor="upload-caption" className="text-[13px] text-ink">
              Caption
            </Label>
            <span className={cn("text-xs tabular", over ? "text-danger" : "text-ink-3")}>
              {caption.length}/{CAPTION_MAX}
            </span>
          </div>
          <Textarea id="upload-caption" value={caption} onChange={(e) => setCaption(e.target.value)} rows={4} placeholder="What's in the post?" aria-invalid={over || undefined} />
        </div>

        <ItemPicker
          id="upload-tags"
          legend="Tag products"
          max={POST_PRODUCTS_MAX}
          autoNote={`Optional. Tagged pieces show under the post. Up to ${POST_PRODUCTS_MAX}.`}
          empty="Publish a product to tag it here."
          items={products.map((p) => ({ id: p.id, name: p.name, image: p.images[0]?.src, meta: formatMoney(p.price, p.currency) }))}
          value={tags}
          onChange={setTags}
        />

        {canCarousel ? (
          <label htmlFor="upload-carousel" className="flex min-h-10 cursor-pointer items-center justify-between gap-3">
            <span className="grid gap-0.5">
              <span className="text-[13px] text-ink">Post as one carousel</span>
              <span className="text-xs text-ink-2">{carousel ? `One post with ${images.length} photos.` : `${images.length} separate posts.`}</span>
            </span>
            <Switch id="upload-carousel" checked={carousel} onCheckedChange={setCarousel} />
          </label>
        ) : null}

        <label htmlFor="upload-publish" className="flex min-h-10 cursor-pointer items-center justify-between gap-3">
          <span className="grid gap-0.5">
            <span className="text-[13px] text-ink">Show on my storefront now</span>
            <span className="text-xs text-ink-2">{publish ? "Shoppers see it on your storefront." : "Saved as a draft. Show it from Content Studio when you're ready."}</span>
          </span>
          <Switch id="upload-publish" checked={publish} onCheckedChange={setPublish} />
        </label>

        {error ? (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </StudioSheet>
  )
}
