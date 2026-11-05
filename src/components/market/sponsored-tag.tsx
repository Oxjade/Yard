import { cn } from "@/lib/utils"

/** Every paid placement carries this tag. It is never optional. */
export function SponsoredTag({ className, by }: { className?: string; by?: string }) {
  return (
    <span
      className={cn(
        "glass inline-flex h-6 items-center rounded-[5px] px-2 text-[11px] font-medium text-ink",
        className,
      )}
    >
      {by ? `Sponsored by ${by}` : "Sponsored"}
    </span>
  )
}
