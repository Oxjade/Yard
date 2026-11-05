"use client"

import { useState } from "react"
import { useSearchParams } from "next/navigation"
import { BookOpen } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { Button } from "@/components/ui/button"
import { Chip } from "@/components/market/catalog/chip"
import { cn } from "@/lib/utils"
import type { Story, StoryKind } from "@/lib/data/types"
import { StoryCard, storyKindLabel } from "./story-card"

type KindFilter = "all" | StoryKind

const isKind = (v: string | null): v is StoryKind => !!v && v in storyKindLabel

/** Whole rows at desktop width for the grid under the lead story. */
function restColumns(n: number) {
  if (n <= 2) return "sm:grid-cols-2"
  if (n % 3 === 0) return "sm:grid-cols-2 lg:grid-cols-3"
  if (n % 4 === 0) return "sm:grid-cols-2 lg:grid-cols-4"
  if (n % 2 === 0) return "sm:grid-cols-2"
  return "sm:grid-cols-2 lg:grid-cols-3"
}

/** Writes the filter to the URL without a navigation; useSearchParams follows it. */
function writeKind(next: KindFilter) {
  const url = new URL(window.location.href)
  if (next === "all") url.searchParams.delete("kind")
  else url.searchParams.set("kind", next)
  window.history.replaceState(null, "", `${url.pathname}${url.search}`)
}

/**
 * The story index: the newest story large, the rest in a grid, filtered by kind. The filter is
 * kept in the URL (?kind=) so a filtered view can be shared. `StoriesIndex` reads it and must
 * sit inside <Suspense>; the fallback is this view unfiltered, so the static page is complete.
 */
export function StoriesIndexView({ stories, kind }: { stories: Story[]; kind: KindFilter }) {
  // Animate only after the shopper picks a filter, not on the first render.
  const [touched, setTouched] = useState(false)

  function choose(next: KindFilter) {
    setTouched(true)
    writeKind(next)
  }

  const kinds = (Object.keys(storyKindLabel) as StoryKind[]).filter((k) => stories.some((s) => s.kind === k))
  const visible = kind === "all" ? stories : stories.filter((s) => s.kind === kind)
  const [lead, ...rest] = visible

  return (
    <div>
      <div className="rail -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0" role="radiogroup" aria-label="Filter stories by kind">
        <Chip selected={kind === "all"} onClick={() => choose("all")} count={stories.length} layoutId="story-kind" size="sm" radio>
          All stories
        </Chip>
        {kinds.map((k) => (
          <Chip key={k} selected={kind === k} onClick={() => choose(k)} count={stories.filter((s) => s.kind === k).length} layoutId="story-kind" size="sm" radio>
            {storyKindLabel[k]}
          </Chip>
        ))}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={kind}
          initial={touched ? { opacity: 0, y: 10 } : false}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          className="mt-8 md:mt-10"
        >
          {lead ? (
            <>
              <StoryCard story={lead} variant="lead" as="h2" priority />
              {rest.length ? (
                <div className={cn("mt-16 grid gap-x-6 gap-y-12 md:mt-20", restColumns(rest.length))}>
                  {rest.map((s) => (
                    <StoryCard key={s.id} story={s} as="h2" />
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <div className="flex flex-col items-center gap-4 rounded-lg border border-line-soft bg-card px-6 py-14 text-center">
              <span className="inline-flex size-14 items-center justify-center rounded-full border border-line">
                <BookOpen className="size-6 text-ink-2" />
              </span>
              <div>
                <p className="text-base text-ink">No stories of this kind yet</p>
                <p className="mt-1 text-sm text-ink-2">Brands publish new stories every week. Try another kind for now.</p>
              </div>
              <Button variant="primary" onClick={() => choose("all")}>
                Show all stories
              </Button>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

/** The story index driven by ?kind=. Render inside <Suspense>. */
export function StoriesIndex({ stories }: { stories: Story[] }) {
  const params = useSearchParams()
  const fromUrl = params.get("kind")
  return <StoriesIndexView stories={stories} kind={isKind(fromUrl) ? fromUrl : "all"} />
}
