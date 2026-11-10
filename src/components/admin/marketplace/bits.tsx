"use client"

import Image from "next/image"
import { CheckIcon, CopyIcon, ImageBrokenIcon } from "@phosphor-icons/react"
import { useAsyncAction } from "@/hooks/use-async-action"
import { cn } from "@/lib/utils"
import { initials } from "./format"

/** Initials in a neutral tile: brands without an uploaded logo, and shopper accounts. */
export function Initials({ name, round = false, size = "sm" }: { name: string; round?: boolean; size?: "sm" | "lg" }) {
  return (
    <span aria-hidden className={cn("inline-flex shrink-0 items-center justify-center border border-white/10 bg-white/[0.04] font-semibold text-ink-2", round ? "rounded-full" : "rounded-md", size === "lg" ? "size-11 text-[13px]" : "size-8 text-[10.5px]")}>
      {initials(name) || "?"}
    </span>
  )
}

export function Thumb({ src, size = "sm" }: { src?: string; size?: "sm" | "lg" }) {
  return (
    <span className={cn("relative shrink-0 overflow-hidden rounded-md border border-white/8 bg-white/[0.03]", size === "lg" ? "h-24 w-20" : "h-10 w-8")}>
      {src ? <Image src={src} alt="" fill sizes={size === "lg" ? "80px" : "32px"} unoptimized={src.startsWith("/api/")} className="object-cover" /> : <ImageBrokenIcon className="absolute inset-0 m-auto size-3.5 text-ink-3" aria-hidden />}
    </span>
  )
}

/**
 * A value an operator copies into a ticket or a provider dashboard (an order reference, an
 * idempotency key). The copy icon turns into a check for a moment once it's on the
 * clipboard, in place; only a failure says anything more.
 */
export function CopyValue({ value, display, label, className, mono = true }: { value: string; display?: React.ReactNode; label: string; className?: string; mono?: boolean }) {
  const copy = useAsyncAction(() => navigator.clipboard.writeText(value), { error: `Couldn't reach the clipboard. Select ${value} and copy it by hand.` })
  return (
    <button
      type="button"
      onClick={() => void copy.run()}
      aria-label={`${label}: ${value}`}
      className={cn(
        "group/copy relative inline-flex max-w-full items-center gap-1.5 rounded-md py-1 text-left whitespace-nowrap transition-colors duration-150 outline-none before:absolute before:-inset-x-1 before:-inset-y-1.5 before:content-[''] hover:text-ink focus-visible:ring-2 focus-visible:ring-violet",
        mono && "tabular",
        className,
      )}
    >
      <span className="min-w-0 truncate">{display ?? value}</span>
      {copy.succeeded ? <CheckIcon className="size-3.5 shrink-0 text-violet" aria-hidden /> : <CopyIcon className="size-3.5 shrink-0 text-ink-3 transition-colors group-hover/copy:text-ink" aria-hidden />}
      <span className="sr-only" role="status">{copy.succeeded ? "Copied" : ""}</span>
    </button>
  )
}
