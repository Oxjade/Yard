import Image from "next/image"
import Link from "next/link"
import { brandById } from "@/lib/data/brands"
import { cn } from "@/lib/utils"
import type { Story, StoryKind } from "@/lib/data/types"

export const storyKindLabel: Record<StoryKind, string> = {
  origins: "Origins",
  "behind-the-scenes": "Behind the scenes",
  "design-process": "Design process",
  "product-launch": "Launch",
  collection: "Collection",
  collaboration: "Collaboration",
}

/** Published dates are calendar dates; format them in UTC so server and client agree. */
export function storyDate(story: Pick<Story, "publishedAt">, month: "long" | "short" = "long") {
  return new Date(`${story.publishedAt}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month, year: "numeric", timeZone: "UTC" })
}

/** Stories newest first. */
export const byNewest = (a: Story, b: Story) => b.publishedAt.localeCompare(a.publishedAt)

/**
 * A story tile. `lead` is the large opening story on /stories: photograph and text side by
 * side on desktop, stacked on phones.
 */
export function StoryCard({
  story,
  variant = "default",
  as: Heading = "h3",
  priority = false,
  className,
}: {
  story: Story
  variant?: "default" | "lead"
  as?: "h2" | "h3"
  priority?: boolean
  className?: string
}) {
  const brand = brandById.get(story.brandId)!
  const href = `/stories/${story.slug}`

  if (variant === "lead") {
    return (
      <article className={cn("group relative grid gap-5 md:grid-cols-12 md:items-end md:gap-8", className)}>
        <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-card md:col-span-8 md:aspect-[16/11]">
          <Image src={story.cover.src} alt={story.cover.alt} fill preload={priority} sizes="(min-width: 768px) 64vw, 100vw" className="object-cover transition-transform duration-[900ms] ease-out-quint group-hover:scale-[1.03]" />
        </div>
        <div className="md:col-span-4 md:pb-2">
          <p className="text-xs text-violet">{storyKindLabel[story.kind]}</p>
          <Heading className="mt-2 font-display text-display-md text-balance text-ink">
            <Link href={href} className="after:absolute after:inset-0">
              {story.title}
            </Link>
          </Heading>
          <p className="mt-4 text-pretty text-[0.9375rem] leading-relaxed text-ink-2">{story.dek}</p>
          <p className="mt-5 text-xs text-ink-3">
            {brand.name}, {story.readMinutes} min read
          </p>
        </div>
      </article>
    )
  }

  return (
    <article className={cn("group relative", className)}>
      <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-card">
        <Image src={story.cover.src} alt={story.cover.alt} fill preload={priority} sizes="(min-width: 768px) 33vw, 100vw" className="object-cover transition-transform duration-[900ms] ease-out-quint group-hover:scale-[1.04]" />
      </div>
      <p className="mt-4 text-xs text-violet">{storyKindLabel[story.kind]}</p>
      <Heading className="mt-1 text-xl font-medium text-ink">
        <Link href={href} className="after:absolute after:inset-0">
          {story.title}
        </Link>
      </Heading>
      <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-ink-2">{story.dek}</p>
      <p className="mt-3 text-xs text-ink-3">
        {brand.name}, {story.readMinutes} min read
      </p>
    </article>
  )
}
