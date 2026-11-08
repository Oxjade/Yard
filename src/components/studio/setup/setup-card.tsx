"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowRightIcon, CheckIcon, XIcon } from "@phosphor-icons/react"
import { Bone } from "@/components/feedback/skeletons"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api/client"
import { useApi } from "@/lib/api/use-api"
import { useServerSession } from "@/lib/session/use-server-session"
import { cn } from "@/lib/utils"
import { setupItemCopy, setupStatusDto, type SetupStatusDto } from "./contract"

const storageKey = (brandId: string) => `nocturne-studio-setup:${brandId}`

function readDismissed(brandId: string) {
  try {
    return window.localStorage.getItem(storageKey(brandId)) === "dismissed"
  } catch {
    return false
  }
}

/**
 * Studio Overview's "Set up the new features" (§7.4): Shipping & fulfilment, Social, Locations
 * and quick replies, each ticked only when GET /api/studio/setup says it's done for the
 * session's brand. It refetches whenever the Overview opens, so saving shipping ticks it on the
 * way back. Optional guidance: hidden signed out, a card skeleton while loading, omitted on an
 * error, gone by itself once all four are done, and dismissible per viewer (this browser,
 * per brand).
 */
export function SetupCard({ className }: { className?: string }) {
  const brand = useServerSession((s) => s.brand)
  const brandId = brand?.brand.id ?? null
  const key = brandId ? `/api/studio/setup#${brandId}` : null
  const { data, error, isLoading, revalidate } = useApi<SetupStatusDto>(key, () => api<SetupStatusDto>("/api/studio/setup", { schema: setupStatusDto }))
  // Fresh on every visit: the cache would otherwise show the state from before a save elsewhere.
  useEffect(() => {
    if (key) void revalidate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  const [dismissedFor, setDismissedFor] = useState<string | null>(null)
  const [storedFor, setStoredFor] = useState<{ id: string; dismissed: boolean } | null>(null)
  useEffect(() => {
    if (!brandId) return
    const dismissed = readDismissed(brandId)
    // Read after mount (storage isn't available on the server render).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStoredFor({ id: brandId, dismissed })
  }, [brandId])

  if (!brandId || error) return null
  const known = storedFor?.id === brandId
  if (!known) return null
  if (storedFor.dismissed || dismissedFor === brandId) return null
  if (isLoading && !data) return <SetupSkeleton className={className} />
  if (!data || data.brandId !== brandId || data.done === data.total) return null

  function dismiss() {
    try {
      window.localStorage.setItem(storageKey(brandId!), "dismissed")
    } catch {
      // Storage refused (private mode): it stays hidden for this visit only.
    }
    setDismissedFor(brandId)
  }

  return (
    <section aria-labelledby="studio-setup-title" className={cn("rounded-2xl border border-white/[0.07] bg-card p-5 @2xl:p-6", className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id="studio-setup-title" className="text-base font-medium text-ink">
            Set up the new features
          </h2>
          <p className="mt-1 text-[13px] text-ink-2 tabular">
            {data.done} of {data.total} done
          </p>
        </div>
        <Button type="button" variant="ghost" size="icon" onClick={dismiss} aria-label="Hide this card" className="-mt-1.5 -mr-1.5 shrink-0 text-ink-3 hover:text-ink">
          <XIcon />
        </Button>
      </div>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/[0.06]" aria-hidden>
        <div className="h-full rounded-full bg-ink" style={{ width: `${(data.done / data.total) * 100}%` }} />
      </div>
      <ul className="mt-4 grid gap-1 @3xl:grid-cols-2 @3xl:gap-2">
        {data.items.map((item) => {
          const copy = setupItemCopy[item.key]
          return (
            <li key={item.key}>
              <Link
                href={copy.href}
                className="group flex min-h-14 items-start gap-3 rounded-xl px-2.5 py-2.5 transition-colors hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-violet"
              >
                <span
                  className={cn(
                    "mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full border",
                    item.done ? "border-purple bg-purple text-ink" : "border-white/20 text-transparent",
                  )}
                  aria-hidden
                >
                  <CheckIcon weight="bold" className="size-3" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-[13.5px]", item.done ? "text-ink-2 line-through decoration-white/25" : "text-ink")}>
                    {copy.title}
                    <span className="sr-only">{item.done ? ", done" : ", not done yet"}</span>
                  </span>
                  <span className="mt-0.5 block text-[12px] text-ink-3">{copy.body}</span>
                </span>
                {item.done ? null : <ArrowRightIcon className="mt-1 size-3.5 shrink-0 text-ink-3 transition-transform group-hover:translate-x-0.5 group-hover:text-ink motion-reduce:transition-none" aria-hidden />}
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function SetupSkeleton({ className }: { className?: string }) {
  return (
    <div role="status" aria-label="Loading setup" className={cn("rounded-2xl border border-white/[0.07] bg-card p-5 @2xl:p-6", className)}>
      <Bone className="h-4 w-48" />
      <Bone className="mt-2 h-3 w-20" />
      <Bone className="mt-4 h-1 w-full rounded-full" />
      <div className="mt-4 grid gap-3 @3xl:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex items-start gap-3 px-2.5 py-2.5">
            <Bone className="size-5 shrink-0 rounded-full" />
            <div className="flex-1">
              <Bone className="h-3.5 w-3/4" />
              <Bone className="mt-1.5 h-3 w-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
