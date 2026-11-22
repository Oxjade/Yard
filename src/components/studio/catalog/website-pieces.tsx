"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowRightIcon, CheckIcon, ChecksIcon, GlobeIcon, XIcon } from "@phosphor-icons/react"
import { surfaceClass } from "@/components/dashboard/insight/insight-panel"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { actionKey } from "@/lib/api/founding"
import { currencies, type CurrencyCode } from "@/config/markets"
import type { SitePieceDto, StudioSitePiecesDto } from "@/lib/api/contracts/imports"
import { errorMessage } from "@/lib/api/errors"
import { actOnStudioWebsitePiece, addStudioWebsitePieces, listStudioWebsitePieces, STUDIO_WEBSITE_PIECES_KEY } from "@/lib/api/imports"
import { revalidatePrefix, useApi } from "@/lib/api/use-api"
import { formatMoney } from "@/lib/money"
import { useServerSession } from "@/lib/session/use-server-session"
import { cn } from "@/lib/utils"

/*
 * Studio › Products › "New from your website" (docs/IMPORTER.md › Watching a website): pieces Yard
 * found on the brand's own site that aren't on Yard yet. Add to Yard copies the photos and creates
 * the product as the brand, published when the brand can publish (like accepting a suggestion);
 * Not this one passes on it for good. If Yard's team approves or skips one first, it leaves the list.
 * The Overview shows a card while anything is waiting.
 */

export const FROM_WEBSITE_ID = "from-website"

export function useWebsitePieces() {
  const brandId = useServerSession((s) => s.brand?.brand.id ?? null)
  return useApi(brandId ? `${STUDIO_WEBSITE_PIECES_KEY}:${brandId}` : null, () => listStudioWebsitePieces())
}

const priceOf = (p: SitePieceDto, currency: string | undefined) => {
  if (p.yardPriceMinor != null && currency && currency in currencies) return formatMoney(p.yardPriceMinor, currency as CurrencyCode)
  if (p.priceMinor != null && p.currency && p.currency in currencies) return formatMoney(p.priceMinor, p.currency as CurrencyCode)
  return "Price not shown on your site"
}

/** Products page: the list, anchored at #from-website (the email's and notification's link). Nothing when none are waiting. */
export function WebsitePiecesSection() {
  const q = useWebsitePieces()
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const batchKey = useRef(actionKey())
  const data = q.data
  const items = data?.items ?? []
  const shown = items.length > 0
  // Arriving from the email (#from-website): scroll to the list once it's on the page.
  useEffect(() => {
    if (shown && window.location.hash === `#${FROM_WEBSITE_ID}`) document.getElementById(FROM_WEBSITE_ID)?.scrollIntoView({ block: "start" })
  }, [shown])
  if (!data || !shown) return null

  async function act(p: SitePieceDto, action: "add" | "skip") {
    setBusy(`${p.id}:${action}`)
    setErrors((e) => ({ ...e, [p.id]: "" }))
    try {
      const r = await actOnStudioWebsitePiece(p.id, action)
      q.mutate(r as StudioSitePiecesDto)
      if (action === "add") {
        revalidatePrefix("studio.catalog")
        toast.success(r.published ? `${p.title} is live` : `${p.title} added as a draft`, {
          description: r.published ? "It's in your shop now. Change anything in Products." : "Publish it once your brand can publish.",
          action: r.productId ? { label: "Open", onClick: () => router.push(`/studio/products/${encodeURIComponent(r.productId!)}`) } : undefined,
        })
      } else toast(`Got it, not ${p.title}`, { description: "We won't suggest it again." })
    } catch (e) {
      setErrors((x) => ({ ...x, [p.id]: errorMessage(e) }))
      // The card may leave the list on the reload (Yard got there first), so the toast says why.
      toast.error(action === "add" ? `${p.title} wasn't added` : "That didn't go through", { description: errorMessage(e) })
      void q.revalidate()
    } finally {
      setBusy(null)
    }
  }

  const waitingIds = items.filter((i) => i.status === "waiting").map((i) => i.id)
  const waiting = waitingIds.length
  const chosen = waitingIds.filter((id) => selected.has(id))
  const allOn = waiting > 0 && chosen.length === waiting

  // Add all / Add selected: each piece exactly as one "Add to Yard" (first wins against Yard).
  async function addMany(which: "all" | "selected") {
    setBusy(`batch:${which}`)
    try {
      const r = await addStudioWebsitePieces({ ids: which === "selected" ? chosen : undefined, idempotencyKey: batchKey.current })
      batchKey.current = actionKey()
      const { accepted, skipped, replayed: _replayed, ...dto } = r
      void _replayed
      q.mutate(dto as StudioSitePiecesDto)
      setSelected(new Set())
      setErrors((x) => {
        const next = { ...x }
        for (const id of accepted) delete next[id]
        for (const sk of skipped) next[sk.id] = sk.reason
        return next
      })
      revalidatePrefix("studio.catalog")
      const left = skipped.length ? ` ${skipped.length} couldn't be added: the reason is on ${skipped.length === 1 ? "it" : "each"}.` : ""
      if (accepted.length) toast.success(`${accepted.length} ${accepted.length === 1 ? "piece" : "pieces"} added to Yard`, { description: `Photos and all, in your Products.${left}` })
      else toast.error("Nothing was added", { description: left.trim() || "Reload and try again." })
    } catch (e) {
      toast.error("That didn't go through", { description: errorMessage(e) })
      void q.revalidate()
    } finally {
      setBusy(null)
    }
  }

  return (
    <section id={FROM_WEBSITE_ID} aria-labelledby={`${FROM_WEBSITE_ID}-h`} className={cn(surfaceClass, "grid scroll-mt-20 gap-3 p-4")}>
      <div className="flex items-start gap-3">
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-purple/20 text-violet">
          <GlobeIcon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 id={`${FROM_WEBSITE_ID}-h`} className="text-sm text-ink">
            New from your website <span className="text-ink-3 tabular">({waiting})</span>
          </h2>
          <p className="text-xs text-ink-2">{data.site ? `New on ${data.site}. ` : ""}Add one and it goes straight into your shop, photos and all. Not this one, and we won&apos;t ask again.</p>
        </div>
      </div>
      {data.mayAdd && waiting > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="primary" className="h-11 flex-1 sm:flex-none" loading={busy === "batch:all"} disabled={!!busy} onClick={() => void addMany("all")}>
            <ChecksIcon aria-hidden /> Add all ({waiting})
          </Button>
          {chosen.length && !allOn ? (
            <Button type="button" variant="secondary" className="h-11 flex-1 sm:flex-none" loading={busy === "batch:selected"} disabled={!!busy} onClick={() => void addMany("selected")}>
              <CheckIcon aria-hidden /> Add selected ({chosen.length})
            </Button>
          ) : null}
          <label className="inline-flex h-11 items-center gap-2 px-1 text-xs text-ink-2 sm:ml-auto">
            <Checkbox checked={allOn ? true : chosen.length ? "indeterminate" : false} onCheckedChange={() => setSelected(allOn ? new Set() : new Set(waitingIds))} aria-label="Select all waiting pieces" />
            {chosen.length ? `${chosen.length} of ${waiting} selected` : "Select all"}
          </label>
        </div>
      ) : null}
      <ul className="grid gap-3 md:grid-cols-2">
        {items.map((p) => (
          <li key={p.id} className="grid gap-3 rounded-xl border border-white/[0.07] bg-white/[0.015] p-3">
            <div className="flex gap-3">
              <div className="flex shrink-0 gap-1.5">
                {p.images.slice(0, 2).map((src, i) => (
                  // eslint-disable-next-line @next/next/no-img-element -- your own site's photo, a preview; Yard copies it when you add the piece
                  <img key={src} src={src} alt={i === 0 ? p.title : ""} referrerPolicy="no-referrer" loading="lazy" className={cn("h-24 w-20 rounded-lg border border-white/10 object-cover", i > 0 && "hidden sm:block")} />
                ))}
                {!p.images.length ? <span className="h-24 w-20 rounded-lg border border-dashed border-white/10" aria-hidden /> : null}
              </div>
              <div className="grid min-w-0 flex-1 content-start gap-1">
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1 text-sm leading-snug text-ink">{p.title}</p>
                  {data.mayAdd && p.status === "waiting" ? (
                    <Checkbox
                      className="mt-0.5"
                      checked={selected.has(p.id)}
                      onCheckedChange={() =>
                        setSelected((x) => {
                          const n = new Set(x)
                          if (n.has(p.id)) n.delete(p.id)
                          else n.add(p.id)
                          return n
                        })
                      }
                      aria-label={`Select ${p.title}`}
                    />
                  ) : null}
                </div>
                <p className="text-sm text-ink tabular">{priceOf(p, data.currency)}</p>
                {p.sizes.length ? <p className="text-xs text-ink-2">Sizes {p.sizes.join(", ")}</p> : null}
                {p.availability === "out_of_stock" ? <p className="text-xs text-ink-3">Sold out on your site</p> : null}
                {p.description ? <p className="line-clamp-2 text-xs text-ink-3">{p.description}</p> : null}
                <a href={p.sourceUrl} target="_blank" rel="noopener noreferrer" className="w-fit text-xs text-violet underline-offset-4 hover:underline">
                  See it on your site<span className="sr-only"> (opens in a new tab)</span>
                </a>
              </div>
            </div>
            {p.status === "approving" ? (
              <p role="status" className="text-xs text-ink-2">
                {p.taken === "admin" ? "Yard is adding this one for you…" : "Adding…"}
              </p>
            ) : data.mayAdd ? (
              <div className="flex gap-2">
                <Button type="button" variant="secondary" size="sm" className="h-10 flex-1" loading={busy === `${p.id}:add`} disabled={!!busy} onClick={() => void act(p, "add")}>
                  <CheckIcon aria-hidden /> Add to Yard
                </Button>
                <Button type="button" variant="ghost" size="sm" className="h-10 flex-1" loading={busy === `${p.id}:skip`} disabled={!!busy} onClick={() => void act(p, "skip")}>
                  <XIcon aria-hidden /> Not this one
                </Button>
              </div>
            ) : (
              <p className="text-xs text-ink-3">Someone who can manage products can add it.</p>
            )}
            {errors[p.id] || p.error ? (
              <p role="alert" className="text-xs text-danger">
                {errors[p.id] || p.error}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Overview: a card while pieces are waiting. */
export function WebsitePiecesCard({ className }: { className?: string }) {
  const q = useWebsitePieces()
  const n = q.data?.count ?? 0
  if (!n) return null
  return (
    <Link href={`/studio/products#${FROM_WEBSITE_ID}`} className={cn(surfaceClass, "group flex items-center gap-3 p-4 transition-colors hover:border-white/15", className)}>
      <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-purple/20 text-violet">
        <GlobeIcon className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-ink">New from your website</span>
        <span className="block text-xs text-ink-2">
          {n} new {n === 1 ? "piece is" : "pieces are"} waiting. Add {n === 1 ? "it" : "them"} to Yard in one tap.
        </span>
      </span>
      <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-acid px-2 text-xs font-medium text-obsidian tabular">{n}</span>
      <ArrowRightIcon className="size-4 text-ink-3 transition-transform group-hover:translate-x-0.5" aria-hidden />
    </Link>
  )
}
