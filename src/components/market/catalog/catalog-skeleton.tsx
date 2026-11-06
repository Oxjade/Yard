import { Bone, ProductCardSkeleton } from "@/components/feedback/skeletons"
import { cn } from "@/lib/utils"

/**
 * The listing while it loads, shaped like it: search field, chip row, the desktop filter
 * panel and toolbar, then the first row of cards. Announced once as loading.
 */
export function CatalogListingSkeleton({ chips = 8 }: { chips?: number }) {
  return (
    <div role="status" aria-label="Loading pieces">
      <Bone className="h-11 w-full md:max-w-xl" />
      <div className="mt-5 flex gap-2 overflow-hidden md:flex-wrap">
        {Array.from({ length: chips }, (_, i) => (
          <Bone key={i} className={cn("h-10 shrink-0 rounded-full lg:h-9", i % 3 === 0 ? "w-28" : "w-20")} />
        ))}
      </div>
      <div className="mt-8 border-t border-line-soft pt-6 md:mt-10 lg:grid lg:grid-cols-[232px_minmax(0,1fr)] lg:gap-10 xl:gap-14">
        <div className="hidden lg:block">
          <Bone className="mb-5 h-4 w-16" />
          <Bone className="h-4 w-12" />
          <div className="mt-3 grid gap-2">
            {Array.from({ length: 5 }, (_, i) => (
              <Bone key={i} className={cn("h-8 rounded-full", i % 2 ? "w-24" : "w-28")} />
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Bone className="h-11" />
            <Bone className="h-11" />
          </div>
          <Bone className="mt-8 h-4 w-14" />
          <div className="mt-3 grid gap-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Bone key={i} className="h-6" />
            ))}
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between">
            <Bone className="h-5 w-32" />
            <Bone className="h-11 w-44" />
          </div>
          <div className="mt-6 grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-4 md:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <ProductCardSkeleton key={i} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
