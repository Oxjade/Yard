import { cn } from "@/lib/utils"

function Block({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-lg bg-card", className)} />
}

/** Shown until the shopper's saved session has loaded on this device. */
export function AccountSkeleton({ variant = "grid" }: { variant?: "grid" | "list" | "form" | "split" }) {
  if (variant === "split") {
    return (
      <div role="status" aria-label="Loading" className="grid gap-8 lg:grid-cols-[1.1fr_1fr] lg:gap-14">
        <Block className="aspect-[16/9] lg:aspect-auto lg:min-h-[600px]" />
        <div className="flex flex-col justify-center gap-4">
          <Block className="h-14 w-2/3" />
          <Block className="h-5 w-full max-w-md" />
          <Block className="mt-6 h-12 w-full max-w-md" />
          <Block className="h-12 w-full max-w-md" />
          <Block className="h-40 w-full max-w-md" />
        </div>
      </div>
    )
  }
  return (
    <div role="status" aria-label="Loading">
      <Block className="h-14 w-64 md:h-20 md:w-96" />
      <Block className="mt-4 h-5 w-full max-w-md" />
      <Block className="mt-8 h-11 w-full" />
      {variant === "grid" ? (
        <div className="mt-12 grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-4 md:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i}>
              <Block className="aspect-[4/5]" />
              <Block className="mt-3 h-3 w-1/2" />
              <Block className="mt-2 h-4 w-3/4" />
            </div>
          ))}
        </div>
      ) : variant === "list" ? (
        <div className="mt-12 grid gap-4">
          {Array.from({ length: 3 }, (_, i) => (
            <Block key={i} className="h-48" />
          ))}
        </div>
      ) : (
        <div className="mt-12 grid gap-6 lg:grid-cols-[320px_1fr]">
          <Block className="h-24" />
          <Block className="h-64" />
        </div>
      )}
    </div>
  )
}
