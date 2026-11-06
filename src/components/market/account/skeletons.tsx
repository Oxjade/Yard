import { Bone, ProductCardSkeleton } from "@/components/feedback/skeletons"

export type AccountSkeletonVariant = "grid" | "list" | "form" | "split" | "detail" | "welcome"

/** The Your World header: eyebrow, title, one line of context and the sub-navigation. */
function HeaderBone() {
  return (
    <div aria-hidden>
      <Bone className="h-4 w-20" />
      <Bone className="mt-3 h-12 w-64 md:h-16 md:w-96" />
      <Bone className="mt-4 h-4 w-full max-w-md" />
      <div className="mt-8 flex gap-1 border-b border-line-soft">
        {["w-16", "w-[4.5rem]", "w-16", "w-14", "w-16"].map((w, i) => (
          <div key={i} className="flex h-11 items-center px-3">
            <Bone className={`h-3.5 ${w}`} />
          </div>
        ))}
      </div>
    </div>
  )
}

function CardBone({ rows = 2 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-lg border border-line-soft bg-card" aria-hidden>
      <div className="flex items-end justify-between border-b border-line-soft px-4 py-4 md:px-6">
        <div>
          <Bone className="h-4 w-40" />
          <Bone className="mt-2 h-3.5 w-56" />
        </div>
        <Bone className="h-5 w-24" />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex gap-4 border-b border-line-soft px-4 py-4 last:border-0 md:px-6">
          <Bone className="h-24 w-[4.75rem] shrink-0" />
          <div className="flex-1">
            <Bone className="h-3 w-24" />
            <Bone className="mt-2.5 h-3.5 w-48 max-w-full" />
            <Bone className="mt-2 h-3 w-64 max-w-full" />
            <Bone className="mt-3 h-6 w-24" />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * Shown until the shopper's saved session has loaded on this device, and by the routes'
 * loading.tsx. Each variant follows its page's layout so nothing jumps when it arrives.
 */
export function AccountSkeleton({ variant = "grid" }: { variant?: AccountSkeletonVariant }) {
  if (variant === "split") {
    return (
      <div role="status" aria-label="Loading" className="grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-14">
        <Bone className="aspect-[16/10] rounded-lg sm:aspect-[16/9] lg:aspect-auto lg:min-h-[640px]" />
        <div className="flex flex-col justify-center lg:py-10" aria-hidden>
          <Bone className="h-12 w-2/3 md:h-16" />
          <Bone className="mt-4 h-4 w-full max-w-md" />
          <Bone className="mt-2 h-4 w-3/4 max-w-sm" />
          <div className="mt-8 grid max-w-md gap-3">
            <Bone className="h-12 w-full" />
            <Bone className="h-12 w-full" />
            <Bone className="mt-3 h-11 w-full" />
            <Bone className="h-11 w-full" />
            <Bone className="h-12 w-full" />
          </div>
        </div>
      </div>
    )
  }

  if (variant === "welcome") {
    return (
      <div role="status" aria-label="Loading">
        <div className="flex justify-between" aria-hidden>
          <Bone className="h-4 w-28" />
          <Bone className="h-4 w-20" />
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2" aria-hidden>
          {Array.from({ length: 3 }, (_, i) => (
            <Bone key={i} className="h-1 rounded-full" />
          ))}
        </div>
        <div className="mt-10 grid gap-12 lg:grid-cols-[minmax(0,1fr)_400px] xl:grid-cols-[minmax(0,1fr)_460px]" aria-hidden>
          <div>
            <Bone className="h-12 w-full max-w-xl md:h-16" />
            <Bone className="mt-4 h-4 w-full max-w-lg" />
            <div className="mt-8 flex flex-wrap gap-2.5">
              {["w-30", "w-38", "w-32", "w-40", "w-30", "w-28", "w-36", "w-38"].map((w, i) => (
                <Bone key={i} className={`h-12 rounded-full ${w}`} />
              ))}
            </div>
          </div>
          <Bone className="hidden aspect-[4/5] rounded-lg lg:block" />
        </div>
      </div>
    )
  }

  if (variant === "detail") {
    return (
      <div role="status" aria-label="Loading">
        <div aria-hidden>
          <Bone className="h-4 w-24" />
          <Bone className="mt-8 h-8 w-40" />
          <Bone className="mt-4 h-12 w-72 md:h-16 md:w-[28rem]" />
          <Bone className="mt-3 h-4 w-80 max-w-full" />
          <div className="mt-8 h-11 border-b border-line-soft" />
        </div>
        <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-8" aria-hidden>
          <div className="grid content-start gap-6">
            <Bone className="h-56 rounded-lg" />
            <Bone className="h-72 rounded-lg" />
          </div>
          <div className="grid content-start gap-6">
            <Bone className="h-52 rounded-lg" />
            <Bone className="h-72 rounded-lg" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div role="status" aria-label="Loading">
      <HeaderBone />
      {variant === "grid" ? (
        <div className="mt-10 grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-4 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <ProductCardSkeleton key={i} />
          ))}
        </div>
      ) : variant === "list" ? (
        <>
          <div className="mt-10 flex gap-2" aria-hidden>
            {["w-16", "w-30", "w-28"].map((w, i) => (
              <Bone key={i} className={`h-10 rounded-full lg:h-9 ${w}`} />
            ))}
          </div>
          <div className="mt-6 grid gap-6">
            <CardBone rows={3} />
            <CardBone rows={2} />
          </div>
        </>
      ) : (
        <div className="mt-24 grid gap-6 md:mt-32 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] lg:gap-16" aria-hidden>
          <div>
            <Bone className="h-10 w-48" />
            <Bone className="mt-3 h-4 w-full max-w-xs" />
          </div>
          <div className="rounded-lg border border-line-soft bg-card p-5 md:p-6">
            <Bone className="h-3.5 w-16" />
            <Bone className="mt-2 h-11 w-full" />
            <Bone className="mt-5 h-3.5 w-16" />
            <Bone className="mt-2 h-11 w-full" />
            <Bone className="mt-5 h-10 w-32" />
          </div>
        </div>
      )}
    </div>
  )
}
