"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowRightIcon, CheckIcon, LightningIcon, TimerIcon, XIcon } from "@phosphor-icons/react"
import { Bone } from "@/components/feedback/skeletons"
import { Button } from "@/components/ui/button"
import { useContentReveal } from "@/components/ui/loaded"
import { api } from "@/lib/api/client"
import { useApi } from "@/lib/api/use-api"
import { useServerSession } from "@/lib/session/use-server-session"
import { cn } from "@/lib/utils"
import { FULL_EDITOR_HREF, listingGuide, nextActionLabel, QUICK_ADD_HREF, type ListingFacts } from "@/lib/listing-guide"
import { setupItemCopy, setupStatusDto, type SetupStatusDto } from "./contract"
import { setupKey } from "./use-listing"

const storageKey = (brandId: string) => `nocturne-studio-setup:${brandId}`
/** The first-product guide is hidden separately, so hiding it never hides the feature setup that follows it. */
const listingKey = (brandId: string) => `yard-studio-listing-guide:${brandId}`

function readDismissed(key: string) {
  try {
    return window.localStorage.getItem(key) === "dismissed"
  } catch {
    return false
  }
}

function writeDismissed(key: string) {
  try {
    window.localStorage.setItem(key, "dismissed")
  } catch {
    // Storage refused (private mode): it stays hidden for this visit only.
  }
}

/**
 * Studio Overview's one guidance card. First "List your first product in ~3 min" (photos, name
 * and price, sizes and stock, publish, then the storefront for founding brands and a payout
 * account), from the server's `listing` facts; once that's all done (or hidden), the same card
 * becomes "Set up the new features" (§7.4): Shipping & fulfilment, Social, Locations
 * and quick replies, each ticked only when GET /api/studio/setup says it's done for the
 * session's brand. It refetches whenever the Overview opens, so saving shipping ticks it on the
 * way back. Optional guidance: hidden signed out, a card skeleton while loading, omitted on an
 * error, gone by itself once all four are done, and dismissible per viewer (this browser,
 * per brand).
 */
export function SetupCard({ className }: { className?: string }) {
  const brand = useServerSession((s) => s.brand)
  const brandId = brand?.brand.id ?? null
  const showPayout = brand?.role === "owner" || brand?.role === "admin" || brand?.role === "finance"
  const key = brandId ? setupKey(brandId) : null
  const { data, error, isLoading, revalidate } = useApi<SetupStatusDto>(key, () => api<SetupStatusDto>("/api/studio/setup", { schema: setupStatusDto }))
  // Fresh on every visit: the cache would otherwise show the state from before a save elsewhere.
  useEffect(() => {
    if (key) void revalidate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  const [dismissedFor, setDismissedFor] = useState<string | null>(null)
  const [listingHiddenFor, setListingHiddenFor] = useState<string | null>(null)
  const [storedFor, setStoredFor] = useState<{ id: string; dismissed: boolean; listing: boolean } | null>(null)
  useEffect(() => {
    if (!brandId) return
    const dismissed = readDismissed(storageKey(brandId))
    const listing = readDismissed(listingKey(brandId))
    // Read after mount (storage isn't available on the server render).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStoredFor({ id: brandId, dismissed, listing })
  }, [brandId])

  const reveal = useContentReveal(!(isLoading && !data))
  if (!brandId || error) return null
  const known = storedFor?.id === brandId
  if (!known) return null
  if (isLoading && !data) return storedFor.dismissed && storedFor.listing ? null : <SetupSkeleton className={className} />
  if (!data || data.brandId !== brandId) return null

  const listingHidden = storedFor.listing || listingHiddenFor === brandId
  if (data.listing && !listingHidden) {
    const guide = listingGuide(data.listing, { showPayout })
    if (!guide.complete) {
      return (
        <ListingGuideCard
          facts={data.listing}
          guide={guide}
          className={cn(reveal, className)}
          onHide={() => {
            writeDismissed(listingKey(brandId))
            setListingHiddenFor(brandId)
          }}
        />
      )
    }
  }

  if (storedFor.dismissed || dismissedFor === brandId) return null
  if (data.done === data.total) return null

  function dismiss() {
    writeDismissed(storageKey(brandId!))
    setDismissedFor(brandId)
  }

  return (
    <section aria-labelledby="studio-setup-title" className={cn("rounded-2xl border border-white/[0.07] bg-card p-5 @2xl:p-6", reveal, className)}>
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
        {/* Scaled, not sized, so a step done elsewhere slides the bar on the compositor when the refetch lands. */}
        <div className="h-full origin-left rounded-full bg-ink transition-[scale] duration-500 ease-settle" style={{ scale: `${data.done / data.total} 1` }} />
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
                <Tick done={item.done} />
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-[13.5px] transition-colors duration-300", item.done ? "text-ink-2 line-through decoration-white/25" : "text-ink")}>
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

/**
 * "List your first product in ~3 min": a compact checklist read from real data. Each step links
 * to the exact place (Quick add, or the field on the draft that's waiting); the main button is
 * the next step in plain words. Hidden with "Hide this"; gone by itself once every step is done.
 */
function ListingGuideCard({ facts, guide, onHide, className }: { facts: ListingFacts; guide: ReturnType<typeof listingGuide>; onHide: () => void; className?: string }) {
  const label = nextActionLabel(guide, facts)
  const fresh = facts.products === 0
  return (
    <section aria-labelledby="studio-listing-title" className={cn("rounded-2xl border border-white/[0.07] bg-card p-5 @2xl:p-6", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-ink-3 uppercase">
            <TimerIcon aria-hidden className="size-3.5" /> About 3 minutes
          </p>
          <h2 id="studio-listing-title" className="mt-1 text-base font-medium text-pretty text-ink">
            {fresh ? "List your first product in 3 minutes" : facts.live === 0 ? "You're one tap from live" : "Nearly there: finish setting up"}
          </h2>
          <p className="mt-1 text-[13px] text-ink-2 tabular">
            {guide.done} of {guide.total} done{facts.live === 0 && facts.products > 0 ? ". Drafts are invisible to shoppers until you publish." : ""}
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onHide} className="-mt-1 -mr-2 h-10 shrink-0 gap-1 px-2.5 text-ink-3 hover:text-ink md:h-8" aria-label="Hide this guide">
          <XIcon aria-hidden className="size-3.5" /> <span aria-hidden>Hide this</span>
        </Button>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.06]" role="progressbar" aria-label="Listing progress" aria-valuemin={0} aria-valuemax={guide.total} aria-valuenow={guide.done} aria-valuetext={`${guide.done} of ${guide.total} steps done`}>
        <div className="h-full origin-left rounded-full bg-acid transition-[scale] duration-500 ease-settle motion-reduce:transition-none" style={{ scale: `${Math.max(guide.done, 0.15) / guide.total} 1` }} />
      </div>
      <ol className="mt-4 grid gap-1 @3xl:grid-cols-2 @3xl:gap-x-2">
        {guide.steps.map((step, i) => (
          <li key={step.key}>
            <Link
              href={step.href}
              aria-current={guide.next?.key === step.key ? "step" : undefined}
              className={cn(
                "group flex min-h-14 items-start gap-3 rounded-xl px-2.5 py-2.5 transition-colors hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-violet",
                guide.next?.key === step.key && "bg-white/[0.035]",
              )}
            >
              <Tick done={step.done} number={i + 1} />
              <span className="min-w-0 flex-1">
                <span className={cn("block text-[13.5px] transition-colors duration-300", step.done ? "text-ink-2 line-through decoration-white/25" : "text-ink")}>
                  {step.title}
                  <span className="sr-only">{step.done ? ", done" : ", not done yet"}</span>
                </span>
                <span className="mt-0.5 block text-[12px] text-ink-3">{step.body}</span>
              </span>
              {step.done ? null : <ArrowRightIcon className="mt-1 size-3.5 shrink-0 text-ink-3 transition-transform group-hover:translate-x-0.5 group-hover:text-ink motion-reduce:transition-none" aria-hidden />}
            </Link>
          </li>
        ))}
      </ol>
      {guide.next && label ? (
        <div className="mt-4 flex flex-col gap-2 border-t border-white/[0.06] pt-4 @lg:flex-row @lg:items-center">
          <Button asChild variant="primary" className="h-11 rounded-full px-5 @lg:h-10">
            <Link href={guide.next.href}>
              {guide.next.href === QUICK_ADD_HREF ? <LightningIcon weight="fill" aria-hidden /> : null}
              {label}
            </Link>
          </Button>
          {guide.next.href === QUICK_ADD_HREF ? (
            <Link href={FULL_EDITOR_HREF} className="inline-flex min-h-10 items-center justify-center rounded-md px-2 text-[13px] text-ink-2 underline-offset-4 hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-violet">
              Use the full editor
            </Link>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

/**
 * The round check. A step that was open when the card first showed and is done by the next
 * fetch (shipping saved, then back to the Overview) ticks in with a pop (`step-pop`); steps
 * already done are simply drawn done.
 */
function Tick({ done, number }: { done: boolean; number?: number }) {
  const [doneAtFirst] = useState(done)
  return (
    <span
      className={cn(
        "mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors duration-300",
        done ? "border-purple bg-purple text-ink" : number ? "border-white/20 text-ink-3" : "border-white/20 text-transparent",
        done && !doneAtFirst && "step-pop",
      )}
      aria-hidden
    >
      {done || !number ? <CheckIcon weight="bold" className="size-3" /> : <span className="text-[10.5px] font-medium tabular">{number}</span>}
    </span>
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
