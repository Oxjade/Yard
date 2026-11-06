"use client"

import { useEffect, useRef, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { ArrowUpRightIcon, CaretLeftIcon, CaretRightIcon, DotsThreeIcon, FlagIcon, XIcon } from "@phosphor-icons/react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { useReturnFocus } from "@/components/market/catalog/phone-sheet"
import { Price } from "@/components/market/price"
import { ReportSheet } from "@/components/report/report-sheet"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { SampleChip } from "@/components/ui/sample-chip"
import { isSafeEmbed, isSafePermalink, providerLabels, type SocialPostDto, type SocialPostMediaDto } from "@/lib/api/contracts/social"
import { reportPostOpen, safeSrc } from "@/lib/api/social"
import { productById } from "@/lib/data/products"
import { duration, ease } from "@/lib/motion"
import { cn } from "@/lib/utils"
import { isSamplePost } from "./post-tile"

const dateText = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })

/** Where a post comes from, in words, and what its outbound link says (§6.1 Post lightbox). */
function sourceLine(post: SocialPostDto) {
  const network = post.provider ? providerLabels[post.provider] : "Instagram"
  if (post.source === "sandbox") return { label: `Sandbox ${network} post`, note: `Sandbox post — there's no original on ${network}.` }
  if (post.sample) return { label: "Sample post", note: `Sample post for this demo — there's no original on ${network}.` }
  if (post.source === "upload") return { label: "Posted on Yard", note: null }
  return { label: `From ${network}`, note: null }
}

function outbound(post: SocialPostDto) {
  if (isSamplePost(post) || !isSafePermalink(post.permalink)) return null
  return post.provider === "tiktok" ? { href: post.permalink, label: "Watch on TikTok" } : { href: post.permalink, label: "Open on Instagram" }
}

/** A photo that zooms to 2× where it's clicked and follows the pointer while zoomed. */
function ZoomImage({ media }: { media: SocialPostMediaDto }) {
  const [zoom, setZoom] = useState<{ x: number; y: number } | null>(null)
  const reduce = useReducedMotion()
  return (
    <button
      type="button"
      aria-label={zoom ? "Zoom out" : "Zoom in"}
      onClick={(e) => {
        if (zoom) return setZoom(null)
        const r = e.currentTarget.getBoundingClientRect()
        setZoom({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 })
      }}
      onMouseMove={(e) => {
        if (!zoom) return
        const r = e.currentTarget.getBoundingClientRect()
        setZoom({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 })
      }}
      className={cn("relative block size-full overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-violet", zoom ? "cursor-zoom-out" : "cursor-zoom-in")}
    >
      <Image
        src={safeSrc(media.src)}
        alt={media.alt}
        fill
        unoptimized
        sizes="(min-width: 1024px) 65vw, 100vw"
        draggable={false}
        className={cn("object-contain", !reduce && "transition-transform duration-200 ease-out")}
        style={zoom ? { transform: "scale(2)", transformOrigin: `${zoom.x}% ${zoom.y}%` } : undefined}
      />
    </button>
  )
}

/** The media stage: a photo (zoomable), a video file, a TikTok embed, or a poster that plays on the network. */
function Stage({ post }: { post: SocialPostDto }) {
  const [at, setAt] = useState(0)
  const items = post.media
  const m = items[Math.min(at, items.length - 1)]
  const link = outbound(post)
  if (!m) return null
  let body: React.ReactNode
  if (m.kind === "video" && post.provider === "tiktok" && isSafeEmbed(post.embedUrl)) {
    body = (
      <iframe
        src={post.embedUrl}
        title="TikTok video"
        allow="encrypted-media; fullscreen"
        sandbox="allow-scripts allow-same-origin allow-popups"
        className="mx-auto aspect-[9/16] h-full max-h-full max-w-full rounded-md border-0 bg-card"
      />
    )
  } else if (m.kind === "video" && m.playable !== false) {
    body = (
      // A video the brand uploaded or Yard imported: Yard's own file, with the browser's controls.
      <video key={m.src} controls playsInline preload="metadata" poster={m.posterSrc ? safeSrc(m.posterSrc) : undefined} className="mx-auto h-full max-h-full w-full max-w-full object-contain">
        <source src={safeSrc(m.src)} />
      </video>
    )
  } else if (m.kind === "video") {
    body = (
      <div className="relative size-full">
        <Image src={safeSrc(m.posterSrc ?? m.src)} alt={m.alt} fill unoptimized sizes="(min-width: 1024px) 65vw, 100vw" className="object-contain" />
        {link ? (
          <a href={link.href} target="_blank" rel="noopener noreferrer" className="absolute bottom-4 left-1/2 inline-flex h-10 -translate-x-1/2 items-center gap-1.5 rounded-full bg-obsidian/85 px-4 text-sm text-ink">
            {link.label} <ArrowUpRightIcon className="size-4" aria-hidden />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        ) : null}
      </div>
    )
  } else {
    body = <ZoomImage key={m.src} media={m} />
  }
  return (
    <div className="relative flex size-full min-h-0 items-center justify-center">
      {body}
      {items.length > 1 ? (
        <div className="absolute inset-x-0 bottom-3 flex items-center justify-center gap-2">
          <button type="button" onClick={() => setAt((at - 1 + items.length) % items.length)} aria-label="Previous photo in this post" className="inline-flex size-10 items-center justify-center rounded-full bg-obsidian/80 text-ink">
            <CaretLeftIcon className="size-4" />
          </button>
          <span className="rounded-full bg-obsidian/80 px-2.5 py-1 text-xs text-ink tabular" aria-live="polite">
            {at + 1} of {items.length}
          </span>
          <button type="button" onClick={() => setAt((at + 1) % items.length)} aria-label="Next photo in this post" className="inline-flex size-10 items-center justify-center rounded-full bg-obsidian/80 text-ink">
            <CaretRightIcon className="size-4" />
          </button>
        </div>
      ) : null}
    </div>
  )
}

/**
 * The post lightbox (§6.1): the codebase's full-screen lightbox overlay on the Radix Dialog.
 * Media on the left (below on phones), the panel on the right: caption, date, source, tagged
 * pieces, and "Open on Instagram ↗" / "Watch on TikTok ↗" — or, for sample and sandbox posts,
 * their line instead of a link. More › Report this post opens the shared ReportSheet. ← and →
 * move between posts, Esc closes, and focus returns to the tile. Opening a post sends post_open.
 */
export function PostLightbox({
  posts,
  index,
  onIndexChange,
  open,
  onOpenChange,
  brandName,
  preview = false,
}: {
  posts: SocialPostDto[]
  index: number
  onIndexChange: (i: number) => void
  open: boolean
  onOpenChange: (open: boolean) => void
  brandName: string
  /** Inside the Studio editor: no signal and no Report (it's the brand's own post). */
  preview?: boolean
}) {
  const returnFocus = useReturnFocus()
  const reduce = useReducedMotion()
  const [reporting, setReporting] = useState(false)
  const post = posts[Math.min(index, posts.length - 1)]
  const many = posts.length > 1
  const counted = useRef<string | null>(null)

  useEffect(() => {
    if (!open || !post || preview) return
    if (counted.current === post.id) return
    counted.current = post.id
    reportPostOpen(post.brandId)
  }, [open, post, preview])
  useEffect(() => {
    if (!open) counted.current = null
  }, [open])

  const go = (dir: 1 | -1) => onIndexChange((index + dir + posts.length) % posts.length)

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return
    // Leave arrows alone inside a video's controls or the report form.
    const t = e.target as HTMLElement
    if (t.closest("video, input, textarea, [role=menu], [role=radiogroup]")) return
    e.stopPropagation()
    e.preventDefault()
    if (many) go(e.key === "ArrowRight" ? 1 : -1)
  }

  if (!post) return null
  const line = sourceLine(post)
  const link = outbound(post)
  const products = post.productIds.map((id) => productById.get(id)).filter((p) => !!p)

  return (
    <>
      <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
        <AnimatePresence>
          {open ? (
            <DialogPrimitive.Portal forceMount>
              <DialogPrimitive.Overlay asChild forceMount>
                <motion.div className="fixed inset-0 z-50 bg-obsidian/95" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: duration.modal, ease: ease.out }} />
              </DialogPrimitive.Overlay>
              <DialogPrimitive.Content asChild forceMount aria-describedby={undefined} {...returnFocus} onKeyDown={onKeyDown}>
                <motion.div
                  data-post-lightbox=""
                  className="fixed inset-0 z-50 flex flex-col outline-none lg:flex-row"
                  initial={{ opacity: 0, scale: reduce ? 1 : 0.985 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: reduce ? 1 : 0.985 }}
                  transition={{ duration: duration.modal, ease: ease.out }}
                >
                  {/* Media */}
                  <div className="relative flex h-[min(62dvh,36rem)] shrink-0 flex-col px-3 pt-14 pb-3 lg:h-auto lg:min-w-0 lg:flex-1 lg:px-16 lg:py-8">
                    <div className="min-h-0 flex-1">
                      <Stage key={post.id} post={post} />
                    </div>
                    {many ? (
                      <>
                        <button type="button" onClick={() => go(-1)} aria-label="Previous post" className="absolute top-1/2 left-2 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-obsidian/80 text-ink transition-colors hover:bg-elevated lg:left-4 lg:size-11">
                          <CaretLeftIcon className="size-5" />
                        </button>
                        <button type="button" onClick={() => go(1)} aria-label="Next post" className="absolute top-1/2 right-2 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-obsidian/80 text-ink transition-colors hover:bg-elevated lg:right-4 lg:size-11">
                          <CaretRightIcon className="size-5" />
                        </button>
                      </>
                    ) : null}
                  </div>

                  {/* Panel */}
                  <aside className="flex min-h-0 flex-1 flex-col border-t border-line-soft bg-surface lg:w-[380px] lg:flex-none lg:border-t-0 lg:border-l">
                    <header className="flex items-center gap-2 border-b border-line-soft px-4 py-3">
                      <DialogPrimitive.Title className="min-w-0 flex-1 truncate text-sm text-ink">
                        {brandName}
                        {many ? <span className="ml-2 text-ink-3 tabular">{index + 1} of {posts.length}</span> : null}
                      </DialogPrimitive.Title>
                      {!preview ? (
                        <DropdownMenu modal={false}>
                          <DropdownMenuTrigger asChild>
                            <button type="button" aria-label="More" className="inline-flex size-10 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-elevated hover:text-ink">
                              <DotsThreeIcon weight="bold" className="size-5" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="z-[60]">
                            <DropdownMenuItem onSelect={() => setReporting(true)}>
                              <FlagIcon aria-hidden /> Report this post
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : null}
                      <DialogPrimitive.Close aria-label="Close" className="absolute top-3 right-3 inline-flex size-10 items-center justify-center rounded-full bg-obsidian/80 text-ink transition-colors hover:bg-elevated lg:static lg:bg-transparent">
                        <XIcon className="size-5" />
                      </DialogPrimitive.Close>
                    </header>
                    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-2">
                        <span>{line.label}</span>
                        <span aria-hidden className="size-1 rounded-full bg-ink-3" />
                        <time dateTime={post.postedAt}>{dateText(post.postedAt)}</time>
                        {isSamplePost(post) ? <SampleChip /> : null}
                      </div>
                      {post.caption ? <p className="mt-3 text-sm leading-relaxed whitespace-pre-line text-ink">{post.caption}</p> : null}
                      {line.note ? <p className="mt-3 text-xs text-ink-3">{line.note}</p> : null}
                      {link ? (
                        <a href={link.href} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex min-h-10 items-center gap-1.5 text-sm text-ink-2 transition-colors hover:text-ink">
                          {link.label} <ArrowUpRightIcon className="size-4" aria-hidden />
                          <span className="sr-only">(opens in a new tab)</span>
                        </a>
                      ) : null}
                      {products.length ? (
                        <section aria-labelledby="post-products" className="mt-6">
                          <h3 id="post-products" className="text-xs text-ink-3">
                            In this post
                          </h3>
                          <ul className="mt-2 grid gap-1">
                            {products.map((p) => (
                              <li key={p!.id}>
                                <Link href={`/products/${p!.slug}`} className="flex items-center gap-3 rounded-md p-1.5 transition-colors hover:bg-elevated">
                                  <span className="relative size-12 shrink-0 overflow-hidden rounded-md bg-card">
                                    <Image src={p!.images[0].src} alt="" fill sizes="48px" className="object-cover" />
                                  </span>
                                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{p!.name}</span>
                                  <Price amount={p!.price} currency={p!.currency} compareAt={p!.compareAt} className="text-ink-2" />
                                </Link>
                              </li>
                            ))}
                          </ul>
                        </section>
                      ) : null}
                    </div>
                  </aside>
                </motion.div>
              </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
          ) : null}
        </AnimatePresence>
      </DialogPrimitive.Root>
      {!preview ? <ReportSheet open={reporting} onOpenChange={setReporting} subjectType="social_post" subjectId={post.id} as="shopper" /> : null}
    </>
  )
}
