"use client"

import { useSyncExternalStore } from "react"
import Link from "next/link"
import { CaretLeftIcon as ChevronLeft } from "@phosphor-icons/react"
import { useStudio } from "@/lib/stores/studio"
import { cn } from "@/lib/utils"

/**
 * Small pieces only the Studio business pages (orders, customers, analytics, settings) use.
 * Panel, Field, the field wiring and Thumb come from the catalog pieces every Studio page shares;
 * the rules live in ./model.ts.
 */

/** True once the Studio store has loaded what this browser saved; until then pages show skeletons. */
export function useStudioReady() {
  return useSyncExternalStore(
    (cb) => useStudio.persist.onFinishHydration(cb),
    () => useStudio.persist.hasHydrated(),
    () => false,
  )
}

/** Initials in a circle; Studio never shows shoppers' photos. */
export function Initials({ name, className }: { name: string; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("")
  return (
    <span aria-hidden className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-[11px] font-medium text-ink-2", className)}>
      {initials}
    </span>
  )
}

export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex w-fit items-center gap-1 text-xs text-ink-2 hover:text-ink">
      <ChevronLeft className="size-3.5" /> {children}
    </Link>
  )
}

/** A label/value list used in side panels. */
export function DefinitionList({ items, className }: { items: { label: string; value: React.ReactNode }[]; className?: string }) {
  return (
    <dl className={cn("grid gap-2.5 text-sm", className)}>
      {items.map((it) => (
        <div key={it.label} className="grid grid-cols-[7.5rem_1fr] gap-3">
          <dt className="text-ink-2">{it.label}</dt>
          <dd className="min-w-0 text-ink">{it.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Horizontal bar used by the funnel, locations and best sellers. Width is a 0–1 share. */
export function ShareBar({ share, tone = "purple", className }: { share: number; tone?: "purple" | "muted" | "acid"; className?: string }) {
  const pct = Math.max(0, Math.min(1, share)) * 100
  return (
    <span className={cn("block h-2 w-full overflow-hidden rounded-full bg-white/[0.05]", className)} aria-hidden>
      <span
        className={cn("block h-full origin-left rounded-full transition-[width] duration-500 ease-out-quint", tone === "purple" ? "bg-purple" : tone === "acid" ? "bg-acid" : "bg-ink-3/60")}
        style={{ width: `${pct}%` }}
      />
    </span>
  )
}
