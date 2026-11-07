"use client"

import { useMemo, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { ArrowCounterClockwiseIcon, MagnifyingGlassIcon, ReceiptIcon, TruckIcon } from "@phosphor-icons/react"
import { EmptyState } from "@/components/dashboard/empty-state"
import { DropCard } from "@/components/market/drop-card"
import { OrderStatusBadge } from "@/components/market/account/order-status"
import { Bone, ListSkeleton } from "@/components/feedback/skeletons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { countries, type CountryCode, type CurrencyCode } from "@/config/markets"
import { api } from "@/lib/api/client"
import type { OrderRefSummary } from "@/lib/api/contracts/inbox"
import { errorMessage } from "@/lib/api/errors"
import { myOrdersWith } from "@/lib/api/inbox"
import { useApi } from "@/lib/api/use-api"
import { brandById } from "@/lib/data/brands"
import { drops as allDrops } from "@/lib/data/catalog"
import { productById, products } from "@/lib/data/products"
import type { MerchantOrderStatus, Product } from "@/lib/data/types"
import { dropPhaseAt, dropWindow } from "@/lib/drops"
import { getDemoAnchor, useNow } from "@/hooks/use-now"
import { formatMoney } from "@/lib/money"
import { formatShortRange } from "@/lib/shipping/format"
import { useOrders } from "@/lib/stores/orders"
import { useSaved } from "@/lib/stores/saved"
import { cn } from "@/lib/utils"
import { useBelowLg } from "./hooks"
import { shortDate } from "./format"

/** A horizontal rail of 132×92 quick-action cards (§6.2, the inspiration's top row). */
export function QuickActionRail({ actions, label = "Quick actions" }: { actions: { key: string; label: string; icon: React.ComponentType<{ className?: string }>; onClick: () => void; pressed?: boolean; disabled?: boolean }[]; label?: string }) {
  return (
    <div className="rail -mx-3 flex gap-2 overflow-x-auto px-3 pt-3 pb-1 [scrollbar-width:none] md:-mx-5 md:px-5" role="toolbar" aria-label={label}>
      {actions.map(({ key, label: text, icon: Icon, onClick, pressed, disabled }) => (
        <button
          key={key}
          type="button"
          onClick={onClick}
          disabled={disabled}
          aria-pressed={pressed}
          className={cn(
            "flex h-[92px] w-[132px] shrink-0 flex-col justify-between rounded-2xl border bg-card p-3 text-left transition-[background-color,border-color,transform] duration-150 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-violet disabled:opacity-40",
            pressed ? "border-purple/60 bg-purple/15" : "border-line-soft hover:border-white/12 hover:bg-elevated",
          )}
        >
          <Icon className={cn("size-5", pressed ? "text-violet" : "text-ink-2")} />
          <span className="text-[15px] leading-tight text-ink">{text}</span>
        </button>
      ))}
    </div>
  )
}

function money(amount: number, currency: string) {
  try {
    return formatMoney(amount, currency as CurrencyCode)
  } catch {
    return `${amount / 100} ${currency}`
  }
}

/** A sheet on the right (desktop) or the bottom (phone). */
function SideSheet({ open, onOpenChange, title, description, children }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description: string; children: React.ReactNode }) {
  const phone = useBelowLg()
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={phone ? "bottom" : "right"} className={cn("gap-0", phone ? "max-h-[85dvh] rounded-t-[20px]" : "data-[side=right]:w-full data-[side=right]:sm:max-w-[480px]")}>
        <SheetHeader className="border-b border-line-soft">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{children}</div>
      </SheetContent>
    </Sheet>
  )
}

/** Share a product: the brand's catalogue, with your recently viewed pieces of that brand first. */
export function ProductPicker({ open, onOpenChange, brandId, onPick }: { open: boolean; onOpenChange: (o: boolean) => void; brandId: string; onPick: (p: Product) => void }) {
  const [q, setQ] = useState("")
  const viewed = useSaved((s) => s.recentlyViewed)
  const brand = brandById.get(brandId)
  const list = useMemo(() => {
    const own = products.filter((p) => p.brandId === brandId && p.status === "published")
    const recent = viewed.map((id) => productById.get(id)).filter((p): p is Product => !!p && p.brandId === brandId)
    const rest = own.filter((p) => !recent.some((r) => r.id === p.id))
    const term = q.trim().toLowerCase()
    const match = (p: Product) => !term || p.name.toLowerCase().includes(term) || p.subcategory.toLowerCase().includes(term)
    return { recent: recent.filter(match), rest: rest.filter(match) }
  }, [brandId, viewed, q])
  const row = (p: Product) => (
    <li key={p.id}>
      <button
        type="button"
        onClick={() => {
          onPick(p)
          onOpenChange(false)
        }}
        className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-white/[0.05] focus-visible:outline-2 focus-visible:outline-violet"
      >
        <span className="relative size-14 shrink-0 overflow-hidden rounded-md bg-surface">{p.images[0] ? <Image src={p.images[0].src} alt="" fill sizes="56px" className="object-cover" /> : null}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-ink">{p.name}</span>
          <span className="block text-xs text-ink-2 tabular">{money(p.price, p.currency)}</span>
        </span>
        <span className="text-xs text-violet">Share</span>
      </button>
    </li>
  )
  return (
    <SideSheet open={open} onOpenChange={onOpenChange} title="Share a product" description={`Pieces from ${brand?.name ?? "this brand"}. The card shows the price when you share it.`}>
      <label className="relative block">
        <span className="sr-only">Search pieces</span>
        <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search pieces" className="h-10 pl-9" />
      </label>
      {list.recent.length ? (
        <>
          <h3 className="mt-5 mb-1 text-xs text-ink-3">Recently viewed</h3>
          <ul>{list.recent.map(row)}</ul>
        </>
      ) : null}
      <h3 className="mt-5 mb-1 text-xs text-ink-3">All pieces</h3>
      {list.rest.length ? <ul>{list.rest.map(row)}</ul> : <p className="py-6 text-center text-sm text-ink-2">No pieces match “{q}”.</p>}
    </SideSheet>
  )
}

/** Order help (§6.2): your orders with this brand to attach, and where returns and refunds really happen. */
export function OrderHelp({ open, onOpenChange, brandId, onAttach }: { open: boolean; onOpenChange: (o: boolean) => void; brandId: string; onAttach: (o: OrderRefSummary) => void }) {
  const brand = brandById.get(brandId)
  const { data, error, isLoading, revalidate } = useApi(open ? `inbox:orders:${brandId}` : null, () => myOrdersWith(brandId))
  // Order pages read this browser's order store: "Open order" only for orders it holds (as Studio's context does).
  const localIds = useOrders((s) => s.orders)
  const local = useMemo(() => new Set(localIds.map((o) => o.id)), [localIds])
  return (
    <SideSheet open={open} onOpenChange={onOpenChange} title="Order help" description={`Your orders with ${brand?.name ?? "this brand"}. Attach one so they know which order you mean.`}>
      <p className="mb-4 rounded-lg border border-line-soft bg-card px-3 py-2.5 text-xs leading-relaxed text-ink-2">Returns, refunds and missing parcels have their own steps on the order page, so Yard can step in if needed.</p>
      {isLoading ? (
        <ListSkeleton rows={3} />
      ) : error ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center" role="alert">
          <p className="text-sm text-ink">Couldn&apos;t load your orders.</p>
          <p className="text-xs text-ink-2">{errorMessage(error)}</p>
          <Button size="sm" variant="secondary" onClick={() => void revalidate()}>
            <ArrowCounterClockwiseIcon /> Retry
          </Button>
        </div>
      ) : !data?.items.length ? (
        <EmptyState icon={ReceiptIcon} title={`No orders with ${brand?.name ?? "this brand"} yet`} body="Orders you place with them appear here." />
      ) : (
        <ul className="grid gap-3">
          {data.items.map((o) => (
            <li key={o.id} className="rounded-xl border border-line-soft bg-card p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-ink tabular">{o.reference}</span>
                <OrderStatusBadge status={o.status as MerchantOrderStatus} />
              </div>
              <p className="mt-1 text-xs text-ink-2">
                Placed {shortDate(o.placedAt)}, {o.itemCount} {o.itemCount === 1 ? "item" : "items"}, <span className="text-ink tabular">{money(o.total.amount, o.total.currency)}</span>
              </p>
              <p className={cn("mt-1 text-xs text-ink-3", local.has(o.id) ? "line-clamp-1" : "line-clamp-3")}>{o.items.map((i) => `${i.qty} × ${i.name}`).join(", ")}</p>
              {local.has(o.id) ? null : <p className="mt-1 text-xs text-ink-3">Placed in another browser — details shown here.</p>}
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    onAttach(o)
                    onOpenChange(false)
                  }}
                >
                  Attach
                </Button>
                {local.has(o.id) ? (
                  <Button asChild size="sm" variant="ghost">
                    <Link href={`/you/orders/${o.id}`}>Open order</Link>
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </SideSheet>
  )
}

type EstimateResponse = {
  brand: { name: string }
  options: { service: string; label: string; available: boolean; reason?: string; transit: [number, number]; estimate?: { arrivalFrom?: string; arrivalTo?: string } }[]
}

/** Yard's delivery estimate for a product to a country (D's GET /api/shipping/estimate). Never a promise. */
export function useDeliveryEstimate(productId: string | null, country: CountryCode | null, city?: string | null) {
  const key = productId && country ? `inbox:estimate:${productId}:${country}:${city ?? ""}` : null
  const r = useApi(key, () => api<EstimateResponse>("/api/shipping/estimate", { query: { product: productId!, to: country!, city: city ?? undefined } }), { revalidateOnFocus: false })
  const option = r.data?.options.find((o) => o.available && o.service === "standard") ?? r.data?.options.find((o) => o.available)
  const range = option?.estimate?.arrivalFrom && option.estimate.arrivalTo ? formatShortRange(option.estimate.arrivalFrom, option.estimate.arrivalTo) : null
  return { ...r, option, range, unavailable: !!r.data && !option }
}

export function DeliveryEstimateCard({ productId, country, city, brandName }: { productId: string | null; country: CountryCode; city?: string | null; brandName: string }) {
  const { isLoading, error, range, unavailable, revalidate, option } = useDeliveryEstimate(productId, country, city)
  const place = countries[country]?.name ?? country
  return (
    <div className="flex items-start gap-3 rounded-xl border border-line-soft bg-card p-3.5" role="status">
      <TruckIcon className="mt-0.5 size-5 shrink-0 text-ink-2" aria-hidden />
      <div className="min-w-0 flex-1 text-sm">
        {!productId ? (
          <p className="text-ink-2">{brandName} has no pieces to estimate delivery for yet.</p>
        ) : isLoading ? (
          <>
            <Bone className="h-4 w-56" />
            <Bone className="mt-2 h-3 w-36" />
          </>
        ) : error ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-ink-2">Couldn&apos;t load Yard&apos;s estimate.</span>
            <Button size="sm" variant="ghost" onClick={() => void revalidate()}>
              <ArrowCounterClockwiseIcon /> Retry
            </Button>
          </div>
        ) : unavailable ? (
          <p className="text-ink-2">
            {brandName} doesn&apos;t list delivery to {place}.
          </p>
        ) : (
          <>
            <p className="text-ink">
              Yard&apos;s estimate to {city ? `${city}, ` : ""}
              {place}: <span className="tabular">{range ?? `${option?.transit[0]}–${option?.transit[1]} days in transit`}</span>
            </p>
            <p className="mt-0.5 text-xs text-ink-3">Estimate, not a guarantee. {option?.label ? `${option.label} delivery.` : ""}</p>
          </>
        )}
      </div>
    </div>
  )
}

/** The brand's next upcoming drop, as a compact DropCard (the Next drop card). */
export function NextDrop({ brandId }: { brandId: string }) {
  const now = useNow(60_000)
  const next = useMemo(() => {
    if (now === null) return undefined
    const anchor = getDemoAnchor()
    return allDrops
      .filter((d) => d.brandId === brandId && dropPhaseAt(d, now, anchor) === "upcoming")
      .sort((a, b) => dropWindow(a, anchor).release - dropWindow(b, anchor).release)[0]
  }, [brandId, now])
  if (now === null) return <Bone className="h-40 w-[min(18rem,80vw)] rounded-lg" />
  if (!next) return <p className="rounded-xl border border-line-soft bg-card px-3.5 py-3 text-sm text-ink-2">{brandById.get(brandId)?.name ?? "This brand"} has no upcoming drop on Yard right now.</p>
  return <DropCard drop={next} className="w-[min(18rem,80vw)]" />
}
