"use client"

import Image from "next/image"
import { StoryCard } from "@/components/market/editorial/story-card"
import { cn } from "@/lib/utils"
import type { Brand, Story, StorefrontSection } from "@/lib/data/types"
import { Container, SectionHeading, SectionShell, placeOf, type StorefrontContext } from "../parts"

type Props = { ctx: StorefrontContext; section: StorefrontSection; index: number; first: boolean; stories: Story[] }

function Founder({ brand, className }: { brand: Brand; className?: string }) {
  const { founder } = brand
  const initials = founder.name.split(" ").map((n) => n[0]).slice(0, 2).join("")
  return (
    <figure className={cn("flex items-center gap-3", className)}>
      <span className="relative size-12 shrink-0 overflow-hidden rounded-full bg-elevated">
        {founder.avatar ? (
          <Image src={founder.avatar.src} alt={`${founder.name}, ${founder.role.toLowerCase()} of ${brand.name}`} fill sizes="48px" className="object-cover" />
        ) : (
          <span className="flex size-full items-center justify-center text-sm text-ink-2">{initials}</span>
        )}
      </span>
      <figcaption>
        <p className="text-sm text-ink">{founder.name}</p>
        <p className="text-xs text-ink-2">{founder.role}</p>
      </figcaption>
    </figure>
  )
}

/**
 * The brand's journal, in the marketplace's own story cards. Columns follow the number of
 * stories, so a lone story spans the row (photograph beside its text) instead of sitting in a
 * third of it, and two stories share the row in halves.
 */
function Journal({ stories }: { stories: Story[] }) {
  if (!stories.length) return null
  return (
    <div className="mt-14 @3xl:mt-16">
      <h3 className="mb-5 text-sm text-ink">From the journal</h3>
      {stories.length === 1 ? (
        <StoryCard story={stories[0]} variant="wide" />
      ) : (
        <div className={cn("grid gap-x-4 gap-y-10 @2xl:grid-cols-2", stories.length >= 3 && "@5xl:grid-cols-3")}>
          {stories.map((s) => (
            <StoryCard key={s.id} story={s} />
          ))}
        </div>
      )}
    </div>
  )
}

export function StorySection({ ctx, section, index, first, stories }: Props) {
  const { brand, template } = ctx
  const [lead, ...rest] = brand.story
  const heading = <SectionHeading ctx={ctx} section={section} index={index} />

  if (template === "minimal") {
    return (
      <SectionShell ctx={ctx} section={section} first={first}>
        <Container>
          {heading}
          <div className="max-w-2xl">
            {brand.story.map((para) => (
              <p key={para} className="mt-5 text-pretty text-lg leading-relaxed text-ink-2 first:mt-0 first:text-ink">{para}</p>
            ))}
            <Founder brand={brand} className="mt-10" />
          </div>
          <Journal stories={stories} />
        </Container>
      </SectionShell>
    )
  }

  if (template === "street") {
    return (
      <SectionShell ctx={ctx} section={section} first={first}>
        <Container>
          {heading}
          <div className="grid gap-10 @4xl:grid-cols-[minmax(0,1fr)_18rem] @4xl:gap-16">
            <div>
              <p className="text-pretty text-2xl leading-snug font-medium text-ink @3xl:text-3xl @3xl:leading-tight">{lead}</p>
              {rest.map((para) => (
                <p key={para} className="mt-6 max-w-2xl text-pretty text-[0.9375rem] leading-relaxed text-ink-2">{para}</p>
              ))}
            </div>
            <aside className="self-start border-l-2 border-(color:--sf-accent) pl-5">
              <Founder brand={brand} />
              <p className="mt-5 text-sm text-ink-2">Started in {brand.founded}, still based in {brand.city}.</p>
            </aside>
          </div>
          <Journal stories={stories} />
        </Container>
      </SectionShell>
    )
  }

  if (template === "studio") {
    return (
      <SectionShell ctx={ctx} section={section} first={first}>
        <Container>
          {heading}
          <div className="grid gap-8 rounded-lg border border-line-soft bg-card p-5 @3xl:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] @3xl:gap-14 @3xl:p-10">
            <div className="grid content-start gap-6">
              <Founder brand={brand} />
              <dl className="grid grid-cols-2 gap-4 text-sm @3xl:grid-cols-1">
                <div>
                  <dt className="text-xs text-ink-3">Studio</dt>
                  <dd className="mt-0.5 text-ink">{placeOf(brand)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-3">Since</dt>
                  <dd className="mt-0.5 text-ink tabular">{brand.founded}</dd>
                </div>
              </dl>
            </div>
            <div className="max-w-2xl">
              {brand.story.map((para) => (
                <p key={para} className="mt-5 text-pretty text-lg leading-relaxed text-ink-2 first:mt-0 first:text-ink">{para}</p>
              ))}
            </div>
          </div>
          <Journal stories={stories} />
        </Container>
      </SectionShell>
    )
  }

  // editorial: a standfirst set large, the rest in a narrower column, the founder alongside
  return (
    <SectionShell ctx={ctx} section={section} first={first}>
      <Container>
        {heading}
        <div className="grid gap-10 @4xl:grid-cols-12 @4xl:gap-12">
          <p className="text-pretty text-2xl leading-snug text-ink @3xl:text-4xl @3xl:leading-tight @4xl:col-span-8">{lead}</p>
          <div className="@4xl:col-span-4 @4xl:pt-2">
            {rest.map((para) => (
              <p key={para} className="mb-5 text-pretty text-[0.9375rem] leading-relaxed text-ink-2">{para}</p>
            ))}
            <Founder brand={brand} className={cn(rest.length && "mt-8")} />
          </div>
        </div>
        <Journal stories={stories} />
      </Container>
    </SectionShell>
  )
}
