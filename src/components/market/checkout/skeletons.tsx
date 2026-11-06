import { cn } from "@/lib/utils"

function Block({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-lg bg-card", className)} />
}

/** Shown until the persisted bag has been read, so the server HTML and first render agree. */
export function BagSkeleton() {
  return (
    <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-12" role="status" aria-label="Loading your bag">
      <div className="grid content-start gap-4">
        <Block className="h-4 w-72 max-w-full rounded-md" />
        <Block className="h-56" />
        <Block className="h-40" />
      </div>
      <Block className="h-80" />
    </div>
  )
}

export function CheckoutSkeleton() {
  return (
    <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_400px] xl:gap-16" role="status" aria-label="Loading checkout">
      <div className="grid content-start gap-6">
        <Block className="h-10" />
        <Block className="h-8 w-48 rounded-md" />
        <Block className="h-72" />
        <Block className="h-12 w-40 rounded-md" />
      </div>
      <Block className="hidden h-96 lg:block" />
    </div>
  )
}

export function ConfirmationSkeleton() {
  return (
    <div className="grid gap-6" role="status" aria-label="Loading your order">
      <Block className="size-12 rounded-full" />
      <Block className="h-16 w-full max-w-xl" />
      <Block className="h-5 w-80 max-w-full rounded-md" />
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Block className="h-72" />
        <Block className="h-72" />
      </div>
    </div>
  )
}
