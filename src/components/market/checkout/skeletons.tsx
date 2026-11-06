import { Bone } from "@/components/feedback/skeletons"

/*
 * Content-shaped placeholders for the bag, checkout and confirmation. Each mirrors the real
 * layout (same grid, same card heights) so nothing shifts when the persisted stores load.
 */

function BrandGroupBone({ lines = 1 }: { lines?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-white/8 bg-card" aria-hidden>
      <div className="flex items-center gap-2.5 border-b border-white/6 px-4 py-3">
        <Bone className="size-8 rounded-md" />
        <div className="flex-1">
          <Bone className="h-3.5 w-32" />
          <Bone className="mt-1.5 h-3 w-44" />
        </div>
        <Bone className="h-3 w-14" />
      </div>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="flex gap-3 border-b border-white/6 px-4 py-3 last:border-0">
          <Bone className="h-28 w-22 shrink-0" />
          <div className="flex flex-1 flex-col">
            <Bone className="h-3.5 w-40" />
            <Bone className="mt-1.5 h-3 w-24" />
            <div className="mt-auto flex items-end justify-between">
              <Bone className="h-8 w-22" />
              <Bone className="h-3.5 w-16" />
            </div>
          </div>
        </div>
      ))}
      <div className="flex justify-between border-t border-white/6 px-4 py-3">
        <Bone className="h-3 w-36" />
        <Bone className="h-3 w-10" />
      </div>
    </div>
  )
}

function SummaryBone({ rows = 3 }: { rows?: number }) {
  return (
    <div className="rounded-lg border border-line-soft bg-card p-5 md:p-6" aria-hidden>
      <Bone className="h-4 w-24" />
      <div className="mt-5 grid gap-3">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex justify-between">
            <Bone className="h-3.5 w-28" />
            <Bone className="h-3.5 w-16" />
          </div>
        ))}
      </div>
      <div className="mt-6 flex items-baseline justify-between border-t border-line-soft pt-5">
        <Bone className="h-4 w-12" />
        <Bone className="h-7 w-28" />
      </div>
      <Bone className="mt-5 h-12 w-full" />
      <Bone className="mt-2 h-12 w-full" />
    </div>
  )
}

/** The bag body below the title: brand groups on the left, the summary on the right. */
export function BagSkeleton() {
  return (
    <div className="mt-8 grid gap-8 md:mt-10 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-12" role="status" aria-label="Loading your bag">
      <div className="grid min-w-0 gap-4">
        <Bone className="h-11 w-full rounded-lg" />
        <BrandGroupBone lines={2} />
        <BrandGroupBone />
      </div>
      <SummaryBone />
    </div>
  )
}

/** The step indicator, one step's fields and the summary panel. */
export function CheckoutSkeleton({ withTitle = false }: { withTitle?: boolean }) {
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start xl:gap-16" role="status" aria-label="Loading checkout">
      <div className="min-w-0">
        {withTitle ? <h1 className="font-display text-display-lg text-ink">Checkout</h1> : null}
        <div className="mt-8 grid grid-cols-5 gap-1.5 sm:gap-2 md:mt-10" aria-hidden>
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i}>
              <Bone className="h-0.5 w-full rounded-full" />
              <Bone className="mt-2.5 h-5 w-5 rounded-full sm:w-20" />
            </div>
          ))}
        </div>
        <Bone className="mt-6 h-[52px] w-full rounded-lg lg:hidden" />
        <div className="mt-8 md:mt-10" aria-hidden>
          <Bone className="h-3 w-20" />
          <Bone className="mt-3 h-8 w-44" />
          <Bone className="mt-3 h-4 w-72 max-w-full" />
          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            {[true, false, false].map((wide, i) => (
              <div key={i} className={wide ? "sm:col-span-2" : undefined}>
                <Bone className="h-3.5 w-20" />
                <Bone className="mt-2 h-11 w-full" />
              </div>
            ))}
          </div>
          <div className="mt-8 flex justify-between">
            <Bone className="h-12 w-32" />
            <Bone className="h-12 w-56" />
          </div>
        </div>
      </div>
      <div className="hidden lg:block">
        <SummaryBone rows={3} />
      </div>
    </div>
  )
}

/** The confirmation heading, its reference strip and the brand order cards. */
export function ConfirmationSkeleton() {
  return (
    <div role="status" aria-label="Loading your order">
      <Bone className="size-12 rounded-full" />
      <Bone className="mt-6 h-14 w-full max-w-lg md:h-20" />
      <Bone className="mt-4 h-4 w-full max-w-2xl" />
      <Bone className="mt-2 h-4 w-2/3 max-w-xl" />
      <div className="mt-8 grid gap-px overflow-hidden rounded-lg border border-line-soft bg-line-soft sm:grid-cols-2 lg:grid-cols-4" aria-hidden>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="bg-card px-4 py-3.5 md:px-5">
            <Bone className="h-3 w-24" />
            <Bone className="mt-2 h-5 w-32" />
          </div>
        ))}
      </div>
      <div className="mt-8 flex gap-3" aria-hidden>
        <Bone className="h-12 w-48" />
        <Bone className="h-12 w-44" />
      </div>
      <div className="mt-24 grid gap-4 md:mt-32 md:grid-cols-2" aria-hidden>
        <Bone className="h-72 rounded-lg" />
        <Bone className="h-72 rounded-lg" />
      </div>
    </div>
  )
}
