import { Bone, ProductGridSkeleton } from "@/components/feedback/skeletons"

/**
 * Inside the handle check in layout.tsx, so unknown storefronts still get a real 404. Shaped
 * like the storefront's profile header (sections/hero.tsx): the banner at the same reserved
 * height melting into the page, the round avatar over its foot, the name row with its actions,
 * the bio and meta lines and the stats, so nothing moves when the storefront arrives.
 */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading storefront">
      <div className="relative h-[max(38svh,15rem)] md:h-[clamp(24rem,50svh,38rem)]">
        <Bone className="absolute inset-0 rounded-none" />
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-3/5 bg-linear-to-b from-obsidian/0 to-obsidian" />
      </div>
      <div className="relative mx-auto -mt-16 max-w-page px-4 md:-mt-24 md:px-8">
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] md:gap-x-10">
          <span className="col-start-1 row-start-1 inline-flex size-24 rounded-full bg-obsidian ring-[3px] ring-obsidian md:size-36 md:ring-4">
            <Bone className="size-full rounded-full" />
          </span>
          <div className="col-start-1 row-start-2 mt-5 md:mt-7">
            <Bone className="h-11 w-64 md:h-20 md:w-[28rem]" />
            <Bone className="mt-3 h-4 w-28" />
          </div>
          <div className="col-start-1 row-start-3 mt-5 flex items-center gap-2 md:col-start-2 md:row-start-2 md:mt-0 md:self-center md:pt-7">
            <Bone className="h-10 w-24 rounded-full md:h-11 md:w-28" />
            <Bone className="size-10 rounded-full md:size-11" />
            <Bone className="h-10 flex-1 rounded-full min-[32rem]:w-40 min-[32rem]:flex-none md:h-11" />
          </div>
        </div>
        <Bone className="mt-6 h-6 w-4/5 max-w-md" />
        <Bone className="mt-3 h-4 w-full max-w-xl" />
        <Bone className="mt-6 h-4 w-3/4 max-w-sm" />
        <div className="mt-8 flex gap-5 md:mt-10 md:gap-7">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="flex flex-col gap-2">
              <Bone className="h-6 w-20 md:h-7 md:w-24" />
              <Bone className="h-3 w-14" />
            </div>
          ))}
        </div>
        <ProductGridSkeleton count={4} className="mt-24 md:mt-32" />
      </div>
    </div>
  )
}
