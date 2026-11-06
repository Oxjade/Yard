import { Skeleton } from "@/components/ui/skeleton"

/** The board while it loads (§6.3 "States"): the podium and ten rows, in their real sizes. */
export function LeaderboardSkeleton() {
  return (
    <div aria-hidden className="grid gap-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-[1.35fr_1fr_1fr] md:gap-4">
        <Skeleton className="col-span-2 aspect-[16/10] rounded-lg md:col-span-1 md:aspect-auto md:h-[28rem] xl:h-[31rem]" />
        <Skeleton className="aspect-[3/4] rounded-lg md:aspect-auto md:h-[28rem] xl:h-[31rem]" />
        <Skeleton className="aspect-[3/4] rounded-lg md:aspect-auto md:h-[28rem] xl:h-[31rem]" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-16 rounded-lg md:h-[4.5rem]" />
        <Skeleton className="h-16 rounded-lg md:h-[4.5rem]" />
      </div>
      <div>
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="flex h-16 items-center gap-3 border-b border-line-soft px-3">
            <Skeleton className="h-7 w-9" />
            <Skeleton className="size-10 rounded-[5px]" />
            <div className="grid flex-1 gap-1.5">
              <Skeleton className="h-3.5 w-36 max-w-full" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-6 w-14" />
          </div>
        ))}
      </div>
    </div>
  )
}

/** The rail and controls while the URL is read (the static shell). */
export function ControlsSkeleton() {
  return (
    <div aria-hidden className="grid gap-3">
      <div className="flex gap-2 overflow-hidden">
        {[96, 84, 86, 116, 128, 92, 100].map((w, i) => (
          <Skeleton key={i} className="h-10 shrink-0 rounded-full lg:h-9" style={{ width: w }} />
        ))}
      </div>
      <Skeleton className="h-10 w-64 rounded-full" />
    </div>
  )
}
