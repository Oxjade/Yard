import { Bone } from "@/components/feedback/skeletons"
import { cn } from "@/lib/utils"
import { MOSAIC_GRID, mosaicLayout } from "./category-mosaic-layout"

/** The category index while it loads: the mosaic's own spans, one bone per tile. */
export function CategoryMosaicSkeleton({ count }: { count: number }) {
  return (
    <div role="status" aria-label="Loading categories" className={MOSAIC_GRID}>
      {Array.from({ length: count }, (_, i) => {
        const spot = mosaicLayout[i % mosaicLayout.length]
        return <Bone key={i} className={cn("h-full rounded-lg", spot.m, spot.d)} />
      })}
    </div>
  )
}
