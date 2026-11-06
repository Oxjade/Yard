"use client"

import { useState } from "react"
import { useApi } from "@/lib/api/use-api"
import { getPublicPosts, publicPostsKey } from "@/lib/api/social"
import { brandById } from "@/lib/data/brands"
import { cn } from "@/lib/utils"
import { PostLightbox } from "./post-lightbox"
import { PostTile } from "./post-tile"

/**
 * "Seen on the feed" (§6.1; N mounts it on the product page, §7.4): a compact rail of up to 6
 * published posts that tag this piece, from GET /api/brands/{brandId}/social-posts?product=.
 * It renders nothing while loading, on error and when there are none (it's optional context),
 * carries the same sample labels, and opens the same lightbox as the storefront feed.
 */
export function SeenOnFeed({ brandId, productId, brandName: name, className }: { brandId: string; productId: string; brandName?: string; className?: string }) {
  const brandName = name ?? brandById.get(brandId)?.name ?? "the brand"
  const { data } = useApi(publicPostsKey(brandId, { product: productId, limit: 6 }), getPublicPosts, { revalidateOnFocus: false })
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState(0)
  const posts = data?.posts.slice(0, 6) ?? []
  if (!posts.length) return null
  return (
    <section aria-labelledby={`seen-${productId}`} className={cn("grid gap-3", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={`seen-${productId}`} className="text-sm font-medium text-ink">
          Seen on the feed
        </h2>
        <p className="text-xs text-ink-3">{posts.length === 1 ? `1 post by ${brandName}` : `${posts.length} posts by ${brandName}`}</p>
      </div>
      <ul className="rail -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
        {posts.map((p, i) => (
          <PostTile
            key={p.id}
            post={p}
            sizes="(min-width: 768px) 9rem, 36vw"
            className="w-[36%] shrink-0 snap-start sm:w-[9rem]"
            frame="aspect-[4/5]"
            rounded="rounded-md"
            onOpen={() => {
              setAt(i)
              setOpen(true)
            }}
          />
        ))}
      </ul>
      <PostLightbox posts={posts} index={Math.min(at, posts.length - 1)} onIndexChange={setAt} open={open} onOpenChange={setOpen} brandName={brandName} />
    </section>
  )
}
