"use client"

import { EyeSlashIcon, HourglassIcon, StorefrontIcon } from "@phosphor-icons/react"
import { toast } from "sonner"
import { revalidatePrefix } from "@/lib/api/use-api"
import { listingPill, type ListingTone } from "@/lib/listing-guide"
import { cn } from "@/lib/utils"
import { setProductStatuses } from "./store"
import { publishError, publishLiveProduct } from "./product-save"

/* ---------- Draft vs Live pill ---------- */

const tones: Record<ListingTone, string> = {
  draft: "border-dashed border-ink/45 text-ink",
  live: "border-purple bg-purple/25 text-ink",
  waiting: "border-ink/60 text-ink",
  archived: "border-white/10 text-ink-3",
}

/**
 * Where a product stands with shoppers, in words: "Draft: only you can see this", "Live on
 * Yard", or what it's waiting for. `size="lg"` (the editor header) adds the one-line hint;
 * `compact` (the products list) uses the short label with the full one for screen readers.
 */
export function ListingPill({ status, hidden = false, size = "sm", className }: { status: string; hidden?: boolean; size?: "sm" | "lg"; className?: string }) {
  const pill = listingPill(status, { hidden })
  const Icon = pill.tone === "draft" ? EyeSlashIcon : pill.tone === "waiting" ? (status === "published" ? StorefrontIcon : HourglassIcon) : null
  const badge = (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border font-medium whitespace-nowrap", size === "lg" ? "h-8 px-3 text-[12.5px]" : "h-6 px-2 text-[11px]", tones[pill.tone], className)}>
      {pill.tone === "live" ? (
        <span className="relative inline-flex size-1.5" aria-hidden>
          <span className="absolute inset-0 animate-ping rounded-full bg-violet opacity-60 motion-reduce:hidden" />
          <span className="relative size-1.5 rounded-full bg-violet" />
        </span>
      ) : Icon ? (
        <Icon aria-hidden className={size === "lg" ? "size-3.5" : "size-3"} />
      ) : (
        <span className="size-1.5 rounded-full bg-ink-3" aria-hidden />
      )}
      {size === "lg" ? pill.label : (
        <>
          <span aria-hidden>{pill.short}</span>
          <span className="sr-only">{pill.label}</span>
        </>
      )}
    </span>
  )
  if (size !== "lg") return badge
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      {badge}
      <span className="text-xs text-ink-3">{pill.hint}</span>
    </span>
  )
}

/* ---------- Toasts ---------- */

export type PublishedProduct = { id: string; name: string; slug: string }

/**
 * After a publish. The brand's first one is a small celebration; every one says where it is
 * and offers "View it on Yard". A founding brand whose storefront isn't published yet is told
 * the one thing left (its products are hidden until then). `viewable` is false for the sample
 * store, whose products never reach the marketplace.
 */
export function announcePublished(p: PublishedProduct, opts: { first: boolean; hidden: boolean; viewable: boolean; onOpen?: (href: string) => void }) {
  revalidatePrefix("/api/studio/setup")
  if (opts.hidden) {
    toast.success(opts.first ? "Published! One last step 🎉" : `${p.name} is published`, {
      description: "Shoppers see it once your storefront is published. That's the last step.",
      duration: 10_000,
      action: { label: "Open Storefront", onClick: () => opts.onOpen?.("/studio/storefront") },
    })
    return
  }
  const view = opts.viewable ? { label: "View it on Yard", onClick: () => window.open(`/products/${encodeURIComponent(p.slug)}`, "_blank", "noopener") } : undefined
  if (opts.first) {
    toast.success("You're live on Yard 🎉", { description: `${p.name} is out in the world. Shoppers can find it, save it and buy it.`, duration: 10_000, action: view })
    return
  }
  toast.success(`${p.name} is live on Yard`, { description: "Shoppers can see it now.", action: view })
}

/**
 * After a save that left the product a draft: say plainly that nobody can see it, and offer
 * the one tap that fixes that.
 */
export function announceDraft(p: PublishedProduct, opts: { isNew: boolean; onPublish: () => void }) {
  toast(opts.isNew ? "Saved as a draft" : "Draft saved", {
    description: `Only you can see ${p.name}. Publish it to put it on Yard.`,
    duration: 12_000,
    action: { label: "Publish now", onClick: opts.onPublish },
  })
}

/**
 * Publishes a saved product from a toast or a button: the status endpoint for a live brand
 * (with the product's current version), the sample store otherwise. Refetches the catalogue.
 */
export async function publishSavedProduct(p: PublishedProduct & { version?: number }, opts: { live: boolean; first: boolean; hidden: boolean; onOpen?: (href: string) => void }) {
  try {
    if (opts.live) {
      if (p.version === undefined) throw new Error("Reload this product, then publish it.")
      await publishLiveProduct(p.id, p.version)
      revalidatePrefix("studio.catalog")
    } else {
      setProductStatuses([p.id], "published")
    }
    announcePublished(p, { first: opts.first, hidden: opts.hidden, viewable: opts.live, onOpen: opts.onOpen })
    return true
  } catch (cause) {
    toast.error(`Couldn't publish ${p.name}`, { description: publishError(cause) })
    return false
  }
}
