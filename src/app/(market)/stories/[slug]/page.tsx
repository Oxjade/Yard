import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { notFound } from "next/navigation"
import { CaretLeftIcon as ChevronLeft } from "@phosphor-icons/react/ssr"
import { BrandCard } from "@/components/market/brand-card"
import { SectionHeader } from "@/components/market/section-header"
import { StoryBlocks } from "@/components/market/editorial/story-blocks"
import { StoryCard, byNewest, storyDate, storyKindLabel } from "@/components/market/editorial/story-card"
import { brandById, getStory, stories } from "@/lib/data"

/**
 * The slug is checked before anything renders so an unknown story answers with a real 404.
 * That check needs the URL, so this segment may block; every known story is prerendered below.
 */
export const instant = false

export function generateStaticParams() {
  return stories.map((s) => ({ slug: s.slug }))
}

export async function generateMetadata({ params }: PageProps<"/stories/[slug]">): Promise<Metadata> {
  const { slug } = await params
  const story = getStory(slug)
  if (!story) return { title: "Story not found" }
  return { title: story.title, description: story.dek }
}

export default async function StoryPage({ params }: PageProps<"/stories/[slug]">) {
  const { slug } = await params
  const story = getStory(slug)
  if (!story) notFound()

  const brand = brandById.get(story.brandId)!
  // More from the same brand first, then the newest from everyone else.
  const others = stories.filter((s) => s.id !== story.id)
  const more = [...others.filter((s) => s.brandId === brand.id).sort(byNewest), ...others.filter((s) => s.brandId !== brand.id).sort(byNewest)].slice(0, 3)

  return (
    <div className="mx-auto max-w-page px-4 pt-28 md:px-8 md:pt-32">
      <article aria-labelledby="story-title">
        <header>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Link href="/stories" className="inline-flex items-center gap-1 rounded-md py-1 text-sm text-ink-2 transition-colors hover:text-ink">
              <ChevronLeft className="size-4" />
              All stories
            </Link>
            <Link href={`/stories?kind=${story.kind}`} className="text-sm text-violet hover:underline hover:underline-offset-4">
              {storyKindLabel[story.kind]}
            </Link>
          </div>

          <h1 id="story-title" className="mt-6 max-w-5xl font-display text-display-lg text-balance text-ink md:mt-8">{story.title}</h1>
          <p className="mt-6 max-w-3xl text-pretty text-lg leading-relaxed text-ink-2 md:text-2xl md:leading-snug">{story.dek}</p>

          {/* Brand header: who wrote it with us, and the follow */}
          <div className="mt-8 flex flex-col gap-3 border-y border-line-soft py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6 md:mt-10">
            <BrandCard brand={brand} variant="row" className="-mx-2 min-w-0 sm:w-full sm:max-w-sm" />
            <dl className="flex gap-6 text-xs">
              <div>
                <dt className="text-ink-3">Published</dt>
                <dd className="mt-0.5 text-ink">
                  <time dateTime={story.publishedAt}>{storyDate(story)}</time>
                </dd>
              </div>
              <div>
                <dt className="text-ink-3">Read time</dt>
                <dd className="mt-0.5 text-ink tabular">{story.readMinutes} min</dd>
              </div>
            </dl>
          </div>
        </header>

        <div className="relative -mx-4 mt-8 aspect-[4/5] overflow-hidden bg-card sm:aspect-[3/2] md:mx-0 md:mt-10 md:rounded-lg lg:aspect-[16/8]">
          <Image src={story.cover.src} alt={story.cover.alt} fill preload sizes="(min-width: 1440px) 1376px, 100vw" className="object-cover object-[50%_30%]" />
        </div>

        <div className="mt-12 md:mt-20">
          <StoryBlocks blocks={story.blocks} />
        </div>
      </article>

      {more.length ? (
        <section aria-labelledby="more-stories-title" className="mt-24 md:mt-32">
          <div id="more-stories-title">
            <SectionHeader title="More stories" href="/stories" action="All stories" />
          </div>
          <div className="grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
            {more.map((s) => (
              <StoryCard key={s.id} story={s} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
