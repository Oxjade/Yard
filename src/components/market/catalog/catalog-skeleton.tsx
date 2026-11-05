import { cn } from "@/lib/utils"

function Block({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-md bg-card", className)} />
}

/** Skeleton for the listing while it loads: blocks on bg-card, announced once as loading. */
export function CatalogListingSkeleton({ chips = 8 }: { chips?: number }) {
  return (
    <div role="status" aria-label="Loading pieces">
      <Block className="h-11 w-full md:max-w-xl" />
      <div className="mt-5 flex gap-2 overflow-hidden">
        {Array.from({ length: chips }, (_, i) => (
          <Block key={i} className={cn("h-9 shrink-0 rounded-full", i % 3 === 0 ? "w-28" : "w-20")} />
        ))}
      </div>
      <div className="mt-8 border-t border-line-soft pt-6 md:mt-10 lg:grid lg:grid-cols-[232px_minmax(0,1fr)] lg:gap-10 xl:gap-14">
        <div className="hidden gap-3 lg:grid lg:content-start">
          {Array.from({ length: 7 }, (_, i) => (
            <Block key={i} className="h-8" />
          ))}
        </div>
        <div>
          <div className="flex items-center justify-between">
            <Block className="h-5 w-32" />
            <Block className="h-11 w-44" />
          </div>
          <div className="mt-6 grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-4 md:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i}>
                <Block className="aspect-[4/5] rounded-lg" />
                <Block className="mt-3 h-3 w-1/3 rounded" />
                <Block className="mt-2 h-4 w-2/3 rounded" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
