import { Bone } from "@/components/feedback/skeletons"
import { galleryFrame } from "@/components/market/product/gallery-frame"
import { cn } from "@/lib/utils"

/**
 * Inside the slug check in layout.tsx, so unknown products still get a real 404.
 *
 * The product page's own layout in bones: same container, breadcrumb row, the gallery with its
 * thumbnail strip (edge to edge on phones) and the buy box in the same columns and gaps as
 * ProductView, so nothing moves when the page lands.
 */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading product" className="mx-auto max-w-page px-4 pt-28 md:px-8 md:pt-32">
      <div className="flex h-6 items-center gap-4" aria-hidden>
        <Bone className="h-3.5 w-10" />
        <Bone className="h-3.5 w-20" />
        <Bone className="h-3.5 w-24" />
      </div>

      <div
        className="mt-4 md:mt-6 md:grid md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:items-start md:gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(360px,1fr)] lg:gap-14 xl:gap-20"
        aria-hidden
      >
        {/* Gallery */}
        <div className="md:grid md:grid-cols-[56px_minmax(0,1fr)] md:gap-3 lg:grid-cols-[72px_minmax(0,1fr)]">
          <div className="hidden md:flex md:flex-col md:gap-2">
            {Array.from({ length: 3 }, (_, i) => (
              <Bone key={i} className="aspect-[4/5] w-full" />
            ))}
          </div>
          <Bone className={cn("rounded-none", galleryFrame)} />
        </div>

        {/* Buy box */}
        <div className="mt-6 md:mt-0">
          <div className="flex items-center gap-3">
            <Bone className="size-11" />
            <div className="flex-1">
              <Bone className="h-3.5 w-32" />
              <Bone className="mt-2 h-3 w-24" />
            </div>
            <Bone className="h-10 w-24 lg:h-8" />
          </div>
          <Bone className="mt-6 h-9 w-3/4 lg:h-11" />
          <Bone className="mt-4 h-7 w-28" />
          <Bone className="mt-2.5 h-3 w-52" />
          <div className="mt-5 grid max-w-prose gap-2">
            {["w-full", "w-full", "w-2/3"].map((w, i) => (
              <Bone key={i} className={cn("h-3.5", w)} />
            ))}
          </div>

          <div className="mt-8">
            <Bone className="h-4 w-28" />
            <div className="mt-3 flex gap-2">
              <Bone className="size-10 rounded-full" />
              <Bone className="size-10 rounded-full" />
            </div>
          </div>
          <div className="mt-7">
            <Bone className="h-4 w-14" />
            <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(3.5rem,1fr))] gap-2">
              {Array.from({ length: 5 }, (_, i) => (
                <Bone key={i} className="aspect-square max-h-16 min-h-11" />
              ))}
            </div>
          </div>

          <div className="mt-8 flex items-center justify-between gap-4">
            <Bone className="h-12 w-[134px]" />
            <Bone className="h-4 w-28" />
          </div>
          <div className="mt-3 flex gap-2">
            <Bone className="h-14 flex-1" />
            <Bone className="h-14 w-14 sm:w-[102px]" />
          </div>

          <div className="mt-8 grid gap-3">
            {["w-5/6", "w-2/3", "w-1/2"].map((w, i) => (
              <Bone key={i} className={cn("h-4", w)} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
