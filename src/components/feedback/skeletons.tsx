import { cn } from "@/lib/utils"

/**
 * Content-shaped skeletons. Each mirrors the real layout's size so nothing shifts when
 * the content arrives. Use these for content; use a button's `loading` for actions.
 */

export function Bone({ className }: { className?: string }) {
  return <div className={cn("skeleton rounded-md", className)} aria-hidden />
}

export function ProductCardSkeleton({ ratio = "aspect-[4/5]" }: { ratio?: string }) {
  return (
    <div aria-hidden>
      <Bone className={cn("w-full rounded-lg", ratio)} />
      <div className="mt-3 flex items-start justify-between gap-3">
        <div className="flex-1">
          <Bone className="h-3 w-1/3" />
          <Bone className="mt-2 h-4 w-2/3" />
        </div>
        <Bone className="mt-[1.125rem] h-4 w-14" />
      </div>
    </div>
  )
}

export function ProductGridSkeleton({ count = 8, className }: { count?: number; className?: string }) {
  return (
    <div role="status" aria-label="Loading products" className={cn("grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-4 md:grid-cols-3 lg:grid-cols-4", className)}>
      {Array.from({ length: count }, (_, i) => (
        <ProductCardSkeleton key={i} />
      ))}
    </div>
  )
}

export function PageTitleSkeleton() {
  return (
    <div aria-hidden>
      <Bone className="h-12 w-2/3 max-w-md md:h-16" />
      <Bone className="mt-4 h-4 w-full max-w-lg" />
    </div>
  )
}

export function ProductDetailSkeleton() {
  return (
    <div role="status" aria-label="Loading product" className="grid gap-8 md:grid-cols-[1.2fr_1fr] md:gap-12">
      <Bone className="aspect-[4/5] w-full rounded-lg" />
      <div className="space-y-4">
        <Bone className="h-4 w-32" />
        <Bone className="h-12 w-3/4" />
        <Bone className="h-6 w-24" />
        <div className="grid grid-cols-5 gap-2 pt-4">
          {Array.from({ length: 5 }, (_, i) => (
            <Bone key={i} className="h-11" />
          ))}
        </div>
        <Bone className="h-12 w-full" />
        <Bone className="h-24 w-full" />
      </div>
    </div>
  )
}

export function StorefrontSkeleton() {
  return (
    <div role="status" aria-label="Loading storefront">
      <Bone className="h-[56vh] min-h-[420px] w-full rounded-none" />
      <div className="mx-auto max-w-page px-4 pt-10 md:px-8">
        <Bone className="h-10 w-72" />
        <ProductGridSkeleton count={4} className="mt-8" />
      </div>
    </div>
  )
}

export function MetricRowSkeleton({ count = 4, dense = false }: { count?: number; dense?: boolean }) {
  return (
    <div role="status" aria-label="Loading metrics" className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={cn("rounded-lg border border-line-soft bg-card", dense ? "p-3" : "p-4")}>
          <Bone className="h-3 w-24" />
          <Bone className={cn("mt-3", dense ? "h-6 w-20" : "h-8 w-28")} />
          <Bone className="mt-2 h-3 w-16" />
        </div>
      ))}
    </div>
  )
}

export function ChartSkeleton({ height = 260 }: { height?: number }) {
  return (
    <div role="status" aria-label="Loading chart" className="relative w-full overflow-hidden rounded-md" style={{ height }}>
      <div className="absolute inset-0 flex items-end gap-1.5 px-2 pb-6">
        {Array.from({ length: 24 }, (_, i) => (
          <Bone key={i} className="flex-1 rounded-sm" />
        ))}
      </div>
    </div>
  )
}

export function TableSkeleton({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div role="status" aria-label="Loading table" className="overflow-hidden rounded-lg border border-line-soft bg-card">
      <div className="flex gap-4 border-b border-line-soft bg-surface/60 px-4 py-3">
        {Array.from({ length: cols }, (_, i) => (
          <Bone key={i} className="h-3 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex items-center gap-4 border-b border-line-soft px-4 py-3.5 last:border-0">
          {Array.from({ length: cols }, (_, c) => (
            <Bone key={c} className={cn("h-3.5 flex-1", c === 0 && "max-w-40")} />
          ))}
        </div>
      ))}
    </div>
  )
}

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading" className="grid gap-3">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Bone className="size-9 shrink-0 rounded-full" />
          <div className="flex-1">
            <Bone className="h-3.5 w-1/2" />
            <Bone className="mt-2 h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function DashboardSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="grid gap-6">
      <div className="border-b border-line-soft pb-5">
        <Bone className="h-7 w-48" />
        <Bone className="mt-2 h-4 w-80 max-w-full" />
      </div>
      <MetricRowSkeleton count={8} />
      <div className="rounded-lg border border-line-soft bg-card p-5">
        <ChartSkeleton />
      </div>
    </div>
  )
}
