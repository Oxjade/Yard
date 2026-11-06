import { Bone, ProductGridSkeleton } from "@/components/feedback/skeletons"
import { cn } from "@/lib/utils"

/**
 * Route loading states for brands, drops, stories and curated collections. Each one is the
 * page's own layout in bones (same container, same gaps, same image ratios), so nothing moves
 * when the content lands. Static titles are shown as text, since they are already known.
 */

const page = "mx-auto max-w-page px-4 pt-28 md:px-8 md:pt-32"

function Lines({ widths, className, lineClass = "h-3.5" }: { widths: string[]; className?: string; lineClass?: string }) {
  return (
    <div className={cn("grid gap-2", className)} aria-hidden>
      {widths.map((w, i) => (
        <Bone key={i} className={cn(lineClass, w)} />
      ))}
    </div>
  )
}

function SectionHeaderBones({ className }: { className?: string }) {
  return (
    <div className={cn("mb-6 md:mb-8", className)} aria-hidden>
      <Bone className="h-9 w-64 max-w-full md:h-11" />
      <Bone className="mt-3 h-3.5 w-80 max-w-full" />
    </div>
  )
}

function BrandCardBones() {
  return (
    <div className="overflow-hidden rounded-lg border border-line-soft bg-card" aria-hidden>
      <Bone className="aspect-[4/3] w-full rounded-none" />
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <Bone className="h-4 w-2/3" />
            <Bone className="mt-2 h-3 w-1/2" />
          </div>
          <Bone className="h-7 w-20" />
        </div>
        <Bone className="mt-4 h-3.5 w-full" />
        <Bone className="mt-2 h-3 w-1/3" />
      </div>
    </div>
  )
}

/** /brands: header, toolbar, category chips, then the featured grid. */
export function BrandDirectorySkeleton() {
  return (
    <div role="status" aria-label="Loading brands" className={page}>
      <header className="grid gap-5 lg:grid-cols-[1fr_minmax(0,26rem)] lg:items-end lg:gap-12">
        <h1 className="font-display text-display-lg text-ink">Brands</h1>
        <Lines widths={["w-full", "w-full", "w-2/3"]} className="max-w-xl lg:pb-1" />
      </header>
      <div className="mt-10 grid gap-4 md:mt-12" aria-hidden>
        <div className="flex items-center gap-3">
          <Bone className="h-11 min-w-0 flex-1 lg:max-w-md" />
          <div className="ml-auto hidden gap-3 lg:flex">
            <Bone className="h-11 w-44" />
            <Bone className="h-11 w-44" />
          </div>
        </div>
        {/* Category (a rail on phones), then Aesthetic from lg, each with its label column. */}
        <div className="grid gap-3 lg:grid-cols-[6.5rem_1fr] lg:items-center">
          <Bone className="hidden h-4 w-16 lg:block" />
          <div className="flex gap-2 overflow-hidden pb-1">
            {["w-12", "w-20", "w-24", "w-20", "w-28", "w-20", "w-20", "w-24"].map((w, i) => (
              <Bone key={i} className={cn("h-10 shrink-0 rounded-full lg:h-9", w)} />
            ))}
          </div>
        </div>
        <div className="hidden gap-3 lg:grid lg:grid-cols-[6.5rem_1fr] lg:items-center">
          <Bone className="h-4 w-16" />
          <div className="flex flex-wrap gap-2">
            {["w-12", "w-24", "w-20", "w-28", "w-20", "w-24", "w-20"].map((w, i) => (
              <Bone key={i} className={cn("h-9 shrink-0 rounded-full", w)} />
            ))}
          </div>
        </div>
      </div>
      <section className="mt-14 md:mt-16">
        <SectionHeaderBones />
        <div className="grid gap-4 lg:grid-cols-4 lg:grid-rows-2" aria-hidden>
          <Bone className="min-h-[520px] rounded-lg sm:min-h-[600px] lg:col-span-2 lg:row-span-2" />
          <div className="hidden gap-4 sm:grid sm:grid-cols-2 lg:col-span-2 lg:row-span-2">
            {Array.from({ length: 4 }, (_, i) => (
              <BrandCardBones key={i} />
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

/** A brand collection page: the photograph header, the count bar and the product grid. */
export function BrandCollectionSkeleton() {
  return (
    <div role="status" aria-label="Loading collection">
      <div className="relative">
        <Bone className="min-h-[520px] w-full rounded-none md:min-h-[620px]" />
        <div className="absolute inset-x-0 bottom-0 mx-auto max-w-page px-4 pb-8 md:px-8 md:pb-12" aria-hidden>
          <Bone className="h-4 w-40 bg-white/8" />
          <Bone className="mt-4 h-14 w-2/3 max-w-xl bg-white/8 md:h-20" />
          <Bone className="mt-4 h-4 w-80 max-w-full bg-white/8" />
        </div>
      </div>
      <div className="mx-auto max-w-page px-4 md:px-8">
        <div className="mt-10 mb-8 flex items-center justify-between gap-4 border-b border-line-soft pb-4 md:mt-14" aria-hidden>
          <Bone className="h-5 w-24" />
          <Bone className="h-11 w-52" />
        </div>
        <ProductGridSkeleton count={8} />
      </div>
    </div>
  )
}

/** /drops: header, the featured release, then Live now. */
export function DropsIndexSkeleton() {
  return (
    <div role="status" aria-label="Loading drops" className={page}>
      <header className="max-w-2xl">
        <h1 className="font-display text-display-lg text-ink">Drops</h1>
        <Lines widths={["w-full", "w-3/4"]} className="mt-4 max-w-xl" />
      </header>
      <div className="mt-10 grid overflow-hidden rounded-lg border border-line-soft bg-card md:mt-12 md:grid-cols-12" aria-hidden>
        <Bone className="aspect-[4/3] w-full rounded-none md:col-span-7 md:aspect-auto md:min-h-[600px]" />
        <div className="flex flex-col p-5 sm:p-6 md:col-span-5 md:p-8 lg:p-10">
          <Bone className="h-5 w-40" />
          <Bone className="mt-6 h-12 w-3/4 md:mt-8" />
          <Lines widths={["w-full", "w-5/6"]} className="mt-4" />
          <Bone className="mt-8 h-16 w-64 md:mt-auto" />
          <div className="mt-8 grid grid-cols-2 gap-4 border-t border-line-soft pt-5">
            <Bone className="col-span-2 h-9 w-2/3" />
            <Bone className="h-9 w-24" />
            <Bone className="h-9 w-28" />
          </div>
          <Bone className="mt-7 h-12 w-44" />
        </div>
      </div>
      <section className="mt-24 md:mt-32">
        <SectionHeaderBones />
        <div className="grid gap-4 lg:grid-cols-2" aria-hidden>
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="grid overflow-hidden rounded-lg border border-line-soft bg-card sm:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
              <Bone className="aspect-[16/10] w-full rounded-none sm:aspect-auto sm:min-h-[320px]" />
              <div className="p-4 sm:p-5">
                <Bone className="h-3 w-24" />
                <Bone className="mt-3 h-8 w-3/4" />
                <Bone className="mt-5 h-10 w-40" />
                <Bone className="mt-10 h-1.5 w-full" />
                <div className="mt-5 flex justify-between">
                  <Bone className="h-3 w-28" />
                  <Bone className="h-8 w-28" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

/** A drop page: title, the photograph, the release panel and the brand. */
export function DropDetailSkeleton() {
  return (
    <div role="status" aria-label="Loading drop" className={page}>
      <Bone className="h-5 w-24" />
      <div className="mt-5 grid gap-6 lg:grid-cols-12 lg:gap-x-8 lg:gap-y-10" aria-hidden>
        <div className="lg:col-span-8 lg:row-start-1">
          <div className="flex items-center gap-2.5">
            <Bone className="size-8" />
            <Bone className="h-4 w-28" />
          </div>
          <Bone className="mt-4 h-14 w-3/4 md:h-20" />
        </div>
        <Lines widths={["w-full", "w-full", "w-1/2"]} className="hidden self-end lg:col-span-4 lg:col-start-9 lg:row-start-1 lg:grid" />
        <Bone className="aspect-[4/3] w-full rounded-lg lg:col-span-8 lg:row-start-2 lg:aspect-auto lg:min-h-[620px]" />
        <div className="grid content-start gap-4 lg:col-span-4 lg:row-start-2">
          <div className="rounded-lg border border-line-soft bg-card p-5 sm:p-6 lg:p-7">
            <Bone className="h-16 w-56" />
            <Bone className="mt-2 h-3 w-40" />
            <div className="mt-6 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <Bone className="h-12 w-full" />
              <Bone className="h-12 w-full" />
            </div>
            <div className="mt-6 grid grid-cols-2 gap-4 border-t border-line-soft pt-5">
              <Bone className="col-span-2 h-9 w-1/2" />
              <Bone className="h-9 w-24" />
              <Bone className="h-9 w-28" />
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-line-soft p-2">
            <Bone className="size-10" />
            <div className="flex-1">
              <Bone className="h-3.5 w-28" />
              <Bone className="mt-2 h-3 w-20" />
            </div>
            <Bone className="h-7 w-20" />
          </div>
        </div>
      </div>
    </div>
  )
}

function StoryCardBones() {
  return (
    <div aria-hidden>
      <Bone className="aspect-[4/3] w-full rounded-lg" />
      <Bone className="mt-4 h-3 w-20" />
      <Bone className="mt-2 h-6 w-4/5" />
      <Lines widths={["w-full", "w-2/3"]} className="mt-3" lineClass="h-3" />
    </div>
  )
}

/** /stories: header, the kind filter, the lead story and the grid under it. */
export function StoriesIndexSkeleton() {
  return (
    <div role="status" aria-label="Loading stories" className={page}>
      <header className="max-w-2xl">
        <h1 className="font-display text-display-lg text-ink">Stories</h1>
        <Lines widths={["w-full", "w-3/4"]} className="mt-4 max-w-xl" />
      </header>
      <div className="mt-8 flex gap-2 overflow-hidden md:mt-10" aria-hidden>
        {["w-24", "w-20", "w-32", "w-28", "w-20"].map((w, i) => (
          <Bone key={i} className={cn("h-8 shrink-0 rounded-full", w)} />
        ))}
      </div>
      <div className="mt-8 grid gap-5 md:mt-10 md:grid-cols-12 md:items-end md:gap-8" aria-hidden>
        <Bone className="aspect-[4/3] w-full rounded-lg md:col-span-8 md:aspect-[16/11]" />
        <div className="md:col-span-4 md:pb-2">
          <Bone className="h-3 w-20" />
          <Bone className="mt-3 h-10 w-full" />
          <Bone className="mt-2 h-10 w-2/3" />
          <Lines widths={["w-full", "w-full", "w-1/2"]} className="mt-4" />
        </div>
      </div>
      <div className="mt-16 grid gap-x-6 gap-y-12 sm:grid-cols-2 md:mt-20 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <StoryCardBones key={i} />
        ))}
      </div>
    </div>
  )
}

/** A story: title, standfirst, the brand bar, the cover and the opening paragraphs. */
export function StorySkeleton() {
  return (
    <div role="status" aria-label="Loading story" className={page}>
      <div className="flex gap-4" aria-hidden>
        <Bone className="h-5 w-24" />
        <Bone className="h-5 w-20" />
      </div>
      <div className="mt-6 max-w-5xl md:mt-8" aria-hidden>
        <Bone className="h-14 w-full md:h-20" />
        <Bone className="mt-3 h-14 w-2/3 md:h-20" />
      </div>
      <Lines widths={["w-full", "w-4/5"]} className="mt-6 max-w-3xl" lineClass="h-5 md:h-6" />
      <div className="mt-8 flex items-center justify-between gap-6 border-y border-line-soft py-3 md:mt-10" aria-hidden>
        <div className="flex items-center gap-3">
          <Bone className="size-10" />
          <div>
            <Bone className="h-3.5 w-28" />
            <Bone className="mt-2 h-3 w-20" />
          </div>
        </div>
        <Bone className="hidden h-8 w-40 sm:block" />
      </div>
      <Bone className="-mx-4 mt-8 aspect-[4/5] rounded-none sm:aspect-[3/2] md:mx-0 md:mt-10 md:rounded-lg lg:aspect-[16/8]" />
      <Lines widths={["w-full", "w-full", "w-full", "w-3/5"]} className="mx-auto mt-12 max-w-2xl md:mt-20" lineClass="h-4" />
    </div>
  )
}

/** A curated collection: photograph header, the brands in the edit, then the pieces. */
export function CuratedCollectionSkeleton() {
  return (
    <div role="status" aria-label="Loading collection">
      <div className="relative">
        <Bone className="min-h-[360px] w-full rounded-none md:min-h-[460px]" />
        <div className="absolute inset-x-0 bottom-0 mx-auto max-w-page px-4 pb-8 md:px-8 md:pb-12" aria-hidden>
          <Bone className="h-4 w-32 bg-white/8" />
          <Bone className="mt-3 h-14 w-2/3 max-w-xl bg-white/8 md:h-20" />
          <Bone className="mt-4 h-4 w-72 max-w-full bg-white/8" />
        </div>
      </div>
      <div className="mx-auto max-w-page px-4 md:px-8">
        <section className="mt-24 md:mt-32">
          <SectionHeaderBones />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-hidden>
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className={cn("flex items-center gap-3 rounded-lg border border-line-soft p-2", i > 0 && "hidden sm:flex")}>
                <Bone className="size-10" />
                <div className="flex-1">
                  <Bone className="h-3.5 w-28" />
                  <Bone className="mt-2 h-3 w-20" />
                </div>
                <Bone className="h-7 w-20" />
              </div>
            ))}
          </div>
        </section>
        <section className="mt-24 md:mt-32">
          <SectionHeaderBones />
          <ProductGridSkeleton count={4} className="md:grid-cols-4" />
        </section>
      </div>
    </div>
  )
}
