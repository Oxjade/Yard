"use client"

import { useState } from "react"
import { ArrowUpRightIcon } from "@phosphor-icons/react"
import { Bone } from "@/components/feedback/skeletons"
import { PostLightbox } from "@/components/storefront/social/post-lightbox"
import { PostTile } from "@/components/storefront/social/post-tile"
import { useApi } from "@/lib/api/use-api"
import type { SocialPostDto } from "@/lib/api/contracts/social"
import { getPublicPosts, publicPostsKey } from "@/lib/api/social"
import type { StorefrontSection } from "@/lib/data/types"
import { cn } from "@/lib/utils"
import { Container, SectionHeading, SectionShell, socialLinksOf, type StorefrontContext } from "../parts"
import { feedSettings, resolveSocialPosts } from "../theme"

type Props = { ctx: StorefrontContext; section: StorefrontSection; index: number; first: boolean }

/** "Follow on Instagram ↗" (or TikTok): the brand's own profile, from its social links. */
function FollowLink({ ctx }: { ctx: StorefrontContext }) {
  const link = socialLinksOf(ctx.brand).find((l) => l.key === "instagram") ?? socialLinksOf(ctx.brand).find((l) => l.key === "tiktok")
  if (!link) return null
  return (
    <a
      href={link.href}
      target="_blank"
      rel="noopener noreferrer"
      className="group inline-flex min-h-10 shrink-0 items-center gap-1 rounded-md py-1 text-sm text-ink-2 transition-colors hover:text-(color:--sf-accent) lg:min-h-0"
    >
      Follow on {link.label}
      <ArrowUpRightIcon className="size-4 transition-transform duration-300 ease-out-quint group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  )
}

/**
 * How a collage fills its rows on wide screens: a 2 × 2 frame plus squares when n + 3 cells divide
 * evenly into 3, 4 or 5 columns; otherwise even squares in a column count that divides n.
 */
function collagePlan(n: number): { big: boolean; cols: 3 | 4 | 5 } {
  for (const c of [4, 3, 5] as const) if (n >= 3 && (n + 3) % c === 0) return { big: true, cols: c }
  for (const c of [4, 3, 5] as const) if (n % c === 0) return { big: false, cols: c }
  return { big: n >= 5, cols: 4 }
}
const collageCols = { 3: "@3xl:grid-cols-3", 4: "@3xl:grid-cols-4", 5: "@3xl:grid-cols-5" } as const

const sizes = { big: "(min-width: 768px) 50vw, 100vw", quarter: "(min-width: 768px) 25vw, 50vw", third: "(min-width: 768px) 33vw, 50vw", rail: "(min-width: 768px) 22rem, 70vw" }

/** The tiles in each template's arrangement (grid) or as a swipeable rail. */
function Tiles({ ctx, layout, posts, open }: { ctx: StorefrontContext; layout: "grid" | "rail"; posts: SocialPostDto[]; open: (i: number) => void }) {
  const { template } = ctx
  if (layout === "rail") {
    if (template === "street") {
      // An offset collage rail: alternate tiles drop, like pasted prints on a wall.
      return (
        <ul className="rail -mx-4 flex snap-x snap-mandatory scroll-px-4 items-start gap-2 overflow-x-auto px-4 pb-3 @3xl:mx-0 @3xl:px-0">
          {posts.map((p, i) => (
            <PostTile key={p.id} post={p} onOpen={() => open(i)} sizes={sizes.rail} className={cn("shrink-0 snap-start", i % 3 === 0 ? "w-[72%] @3xl:w-[22rem]" : "w-[56%] @3xl:w-[16rem]", i % 2 === 1 && "mt-8 @3xl:mt-14")} frame={i % 3 === 0 ? "aspect-[4/5]" : "aspect-square"} />
          ))}
        </ul>
      )
    }
    if (template === "studio") {
      return (
        <ul className="rail -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 @3xl:mx-0 @3xl:px-0">
          {posts.map((p, i) => (
            <li key={p.id} className="w-[70%] shrink-0 snap-start rounded-lg border border-line-soft bg-card p-3 @3xl:w-[18rem]">
              <PostTile as="div" post={p} onOpen={() => open(i)} sizes={sizes.rail} frame="aspect-[4/5]" rounded="rounded-md" />
              <p className="mt-3 flex items-baseline justify-between gap-3 text-xs">
                <span className="truncate text-ink-2">{p.caption || ctx.brand.name}</span>
                <span className="shrink-0 text-ink-3 tabular">Plate {String(i + 1).padStart(2, "0")}</span>
              </p>
            </li>
          ))}
        </ul>
      )
    }
    return (
      <ul className="rail -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 @3xl:mx-0 @3xl:px-0">
        {posts.map((p, i) => (
          <PostTile key={p.id} post={p} onOpen={() => open(i)} sizes={sizes.rail} className="w-[70%] shrink-0 snap-start @3xl:w-[18rem]" frame="aspect-[4/5]" caption={template === "minimal"} />
        ))}
      </ul>
    )
  }

  if (template === "editorial" || template === "street") {
    // A collage: one big frame (2 × 2) and squares, in as many columns as fill every row.
    const plan = collagePlan(posts.length)
    const street = template === "street"
    const smalls = posts.length - (plan.big ? 1 : 0)
    return (
      <ul className={cn("grid grid-cols-2", street ? "gap-1.5 @3xl:gap-2" : "gap-3 @3xl:gap-4", collageCols[plan.cols])}>
        {posts.map((p, i) => {
          const big = plan.big && i === 0
          // Phones are two columns: an odd one out at the end takes the whole row.
          const lastAlone = !big && i === posts.length - 1 && smalls % 2 === 1
          return (
            <PostTile
              key={p.id}
              post={p}
              onOpen={() => open(i)}
              sizes={big ? sizes.big : sizes.quarter}
              className={cn(big && "col-span-2 row-span-2", lastAlone && "col-span-2 @3xl:col-span-1")}
              frame={big ? (street ? "aspect-square" : "aspect-[4/5] @3xl:aspect-auto @3xl:h-full") : lastAlone ? "aspect-[2/1] @3xl:aspect-square" : "aspect-square"}
              rounded={street ? "rounded-md" : "rounded-lg"}
            />
          )
        })}
      </ul>
    )
  }
  if (template === "studio") {
    return (
      <ul className="grid grid-cols-2 gap-3 @3xl:grid-cols-4 @3xl:gap-4">
        {posts.map((p, i) => (
          <li key={p.id} className="rounded-lg border border-line-soft bg-card p-3">
            <PostTile as="div" post={p} onOpen={() => open(i)} sizes={sizes.quarter} frame="aspect-[4/5]" rounded="rounded-md" />
            <p className="mt-3 text-xs text-ink-3 tabular">Plate {String(i + 1).padStart(2, "0")}</p>
          </li>
        ))}
      </ul>
    )
  }
  // minimal: a quiet 3-column grid (2 on phones), captions underneath.
  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-6 @3xl:grid-cols-3 @3xl:gap-x-4">
      {posts.map((p, i) => (
        <PostTile key={p.id} post={p} onOpen={() => open(i)} sizes={sizes.third} frame="aspect-[3/4]" caption />
      ))}
    </ul>
  )
}

/**
 * The Social feed section (§6.1), modelled on LookbookSection: the brand's posts in its
 * template's arrangement or as a rail; a tap opens the post lightbox. Pure: the posts come in
 * already resolved (pinned, then featured, then newest).
 */
export function SocialFeedSection({ ctx, section, index, first, posts }: Props & { posts: SocialPostDto[] }) {
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState(0)
  const { layout } = feedSettings(section)
  return (
    <SectionShell ctx={ctx} section={section} first={first}>
      <Container>
        <SectionHeading ctx={ctx} section={section} index={index} description="Tap a post to see it larger and shop what's in it." action={<FollowLink ctx={ctx} />} />
        <Tiles
          ctx={ctx}
          layout={layout}
          posts={posts}
          open={(i) => {
            setAt(i)
            setOpen(true)
          }}
        />
      </Container>
      <PostLightbox posts={posts} index={Math.min(at, posts.length - 1)} onIndexChange={setAt} open={open} onOpenChange={setOpen} brandName={ctx.brand.name} preview={ctx.preview} />
    </SectionShell>
  )
}

/** Tile skeletons with the geometry of the posts they stand for. */
function FeedSkeleton({ ctx, layout, count }: { ctx: StorefrontContext; layout: "grid" | "rail"; count: number }) {
  const n = Math.min(count, layout === "rail" ? 4 : count)
  if (layout === "rail")
    return (
      <div aria-hidden className="-mx-4 flex gap-3 overflow-hidden px-4 @3xl:mx-0 @3xl:px-0">
        {Array.from({ length: n }, (_, i) => (
          <Bone key={i} className="aspect-[4/5] w-[70%] shrink-0 rounded-lg @3xl:w-[18rem]" />
        ))}
      </div>
    )
  const cols = ctx.template === "minimal" ? "grid-cols-2 @3xl:grid-cols-3" : "grid-cols-2 @3xl:grid-cols-4"
  return (
    <div aria-hidden className={cn("grid gap-3 @3xl:gap-4", cols)}>
      {Array.from({ length: n }, (_, i) => (
        <Bone key={i} className={cn("w-full rounded-lg", ctx.template === "minimal" ? "aspect-[3/4]" : (ctx.template === "editorial" || ctx.template === "street") && i === 0 ? "col-span-2 aspect-[4/5] @3xl:row-span-2 @3xl:aspect-auto" : "aspect-square")} />
      ))}
    </div>
  )
}

/**
 * The live storefront's feed: fetches the brand's published posts (public, no session) and keeps
 * the storefront page itself prerendered. Skeleton tiles while loading, nothing at all when the
 * brand has no published posts, and a one-line retry on error.
 */
export function LiveSocialFeed({ ctx, section, index, first }: Props) {
  const { source, layout, count } = feedSettings(section)
  const key = publicPostsKey(ctx.brand.id, { source, limit: count, pinned: section.postIds })
  const { data, error, isLoading, revalidate } = useApi(key, getPublicPosts, { revalidateOnFocus: false })
  if (data) {
    const posts = resolveSocialPosts(section, data.posts)
    if (!posts.length) return null
    return <SocialFeedSection ctx={ctx} section={section} index={index} first={first} posts={posts} />
  }
  return (
    <SectionShell ctx={ctx} section={section} first={first}>
      <Container>
        <SectionHeading ctx={ctx} section={section} index={index} action={<FollowLink ctx={ctx} />} />
        {isLoading ? (
          <div role="status">
            <span className="sr-only">Loading posts</span>
            <FeedSkeleton ctx={ctx} layout={layout} count={count} />
          </div>
        ) : error ? (
          <p className="text-sm text-ink-2">
            Couldn&apos;t load posts.{" "}
            <button type="button" onClick={() => void revalidate()} className="inline-flex min-h-10 items-center rounded-sm text-ink underline underline-offset-4 hover:text-(color:--sf-accent) lg:min-h-0">
              Retry
            </button>
          </p>
        ) : null}
      </Container>
    </SectionShell>
  )
}
