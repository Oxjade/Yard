import type { Metadata } from "next"
import { Suspense } from "react"
import { StoriesIndex, StoriesIndexView } from "@/components/market/editorial/stories-index"
import { byNewest } from "@/components/market/editorial/story-card"
import { stories } from "@/lib/data"

export const metadata: Metadata = {
  title: "Stories",
  description: "Origins, process and the people behind independent brands, told by the brands themselves.",
}

export default function StoriesPage() {
  const list = [...stories].sort(byNewest)
  return (
    <div className="mx-auto max-w-page px-4 pt-28 md:px-8 md:pt-32">
      <header className="max-w-2xl">
        <h1 className="font-display text-display-lg text-ink">Stories</h1>
        <p className="mt-4 max-w-xl text-pretty text-[0.9375rem] leading-relaxed text-ink-2">
          Origins, process and the people behind the pieces, written with the brands. Every story links to what it&apos;s about.
        </p>
      </header>
      <div className="mt-8 md:mt-10">
        {/* The URL holds the kind filter, so the index reads it inside Suspense. The fallback is the unfiltered index. */}
        <Suspense fallback={<StoriesIndexView stories={list} kind="all" />}>
          <StoriesIndex stories={list} />
        </Suspense>
      </div>
    </div>
  )
}
