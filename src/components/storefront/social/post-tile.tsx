"use client"

import Image from "next/image"
import { CopySimpleIcon, PlayIcon } from "@phosphor-icons/react"
import { SampleChip } from "@/components/ui/sample-chip"
import type { SocialPostDto } from "@/lib/api/contracts/social"
import { durationLabel, safeSrc } from "@/lib/api/social"
import { cn } from "@/lib/utils"

/** What a post's tile shows: the first photo, or a video's poster frame. */
export function coverOf(post: SocialPostDto) {
  const m = post.media[0]
  if (!m) return { src: safeSrc(null), alt: "", width: 1080, height: 1350 }
  return { src: safeSrc(m.kind === "video" ? (m.posterSrc ?? m.src) : m.src), alt: m.alt, width: m.width, height: m.height }
}

/** A sample or sandbox post carries the Sample chip (§6.1 Labels). */
export const isSamplePost = (post: SocialPostDto) => post.sample || post.source === "sandbox"

/** "Open post: Third Mainland test prints on the Yaba table" (the first line, shortened). */
export function postLabel(post: SocialPostDto) {
  const first = post.caption.split("\n")[0]?.trim() ?? ""
  const text = first.length > 60 ? `${first.slice(0, 57).trimEnd()}…` : first
  const what = post.media[0]?.kind === "video" ? "video" : post.kind === "carousel" ? "photos" : "post"
  return text ? `Open ${what}: ${text}` : `Open ${what}`
}

/**
 * One post in a grid or rail: `<li><figure><button>`, never `<article>`, so the Studio preview's
 * "shopping is off" guard doesn't swallow the click (the button is also marked
 * data-preview-allowed, so the lightbox opens in preview). Video tiles show a play glyph and the
 * duration; sample and sandbox posts carry the Sample chip. The hover zoom is off under reduced motion.
 */
export function PostTile({
  post,
  onOpen,
  className,
  frame = "aspect-square",
  sizes,
  caption = false,
  as: Tag = "li",
  rounded = "rounded-lg",
}: {
  post: SocialPostDto
  onOpen: (trigger: HTMLElement) => void
  className?: string
  /** The tile's shape: an aspect class, or h-full to fill a grid cell. */
  frame?: string
  sizes: string
  /** A one-line caption under the photo. */
  caption?: boolean
  as?: "li" | "div"
  rounded?: string
}) {
  const cover = coverOf(post)
  const video = post.media[0]?.kind === "video"
  const duration = video ? durationLabel(post.media[0]?.durationMs) : null
  return (
    <Tag className={cn("min-w-0 list-none", className)}>
      <figure className="group h-full">
        <button
          type="button"
          data-preview-allowed=""
          aria-label={postLabel(post)}
          onClick={(e) => onOpen(e.currentTarget)}
          className={cn(
            "relative block w-full overflow-hidden bg-card text-left outline-none focus-visible:ring-2 focus-visible:ring-violet focus-visible:ring-offset-2 focus-visible:ring-offset-obsidian",
            rounded,
            frame,
          )}
        >
          <Image
            src={cover.src}
            alt=""
            fill
            unoptimized
            sizes={sizes}
            className="object-cover transition-transform duration-[900ms] ease-out-quint motion-safe:group-hover:scale-[1.03]"
          />
          {video ? (
            <span aria-hidden className="absolute top-2.5 left-2.5 inline-flex size-8 items-center justify-center rounded-full bg-obsidian/75 text-ink">
              <PlayIcon weight="fill" className="size-3.5" />
            </span>
          ) : post.kind === "carousel" ? (
            <span aria-hidden className="absolute top-2.5 right-2.5 inline-flex size-7 items-center justify-center rounded-full bg-obsidian/75 text-ink">
              <CopySimpleIcon className="size-3.5" />
            </span>
          ) : null}
          {duration ? <span className="absolute right-2.5 bottom-2.5 rounded-[4px] bg-obsidian/80 px-1.5 py-0.5 text-[11px] text-ink tabular">{duration}</span> : null}
          {isSamplePost(post) ? <SampleChip className="absolute bottom-2.5 left-2.5 border-white/15 bg-obsidian/80 text-ink-2" /> : null}
        </button>
        {caption && post.caption ? <figcaption className="mt-2 line-clamp-1 text-xs text-ink-2">{post.caption}</figcaption> : null}
      </figure>
    </Tag>
  )
}
