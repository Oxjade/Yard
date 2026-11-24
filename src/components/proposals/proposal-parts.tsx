"use client"

import Image from "next/image"
import { ArrowRightIcon, ImageBrokenIcon, WarningIcon } from "@phosphor-icons/react"
import { StatusBadge } from "@/components/dashboard/status-badge"
import type { CurrencyCode } from "@/config/markets"
import type { ProposalChangeDto, ProposalDetailDto, ProposalImageDto, ProposalStatus } from "@/lib/api/contracts/proposals"
import { categoryBySlug } from "@/lib/data/catalog"
import type { CategorySlug, Product, ProductOption } from "@/lib/data/types"
import { formatMoney } from "@/lib/money"
import type { ProductView, ProposalField, ViewImage } from "@/lib/proposals"
import { cn } from "@/lib/utils"

/**
 * Suggestions from Yard: the pieces both sides read a suggestion with. The brand's review page
 * and the admin's detail panel show the same product ("as it would look") and the same
 * before → after list, so what Yard suggested and what the brand accepts read identically.
 */

export const proposalStatusMeta: Record<ProposalStatus, { label: string; tone: "attention" | "success" | "danger" | "muted" | "neutral" }> = {
  pending: { label: "Waiting", tone: "attention" },
  accepted: { label: "Accepted", tone: "success" },
  declined: { label: "Declined", tone: "danger" },
  withdrawn: { label: "Withdrawn", tone: "muted" },
  superseded: { label: "Replaced", tone: "muted" },
}

export function ProposalStatusBadge({ status }: { status: ProposalStatus }) {
  const m = proposalStatusMeta[status]
  return <StatusBadge tone={m.tone}>{m.label}</StatusBadge>
}

const imageKey = (i: ViewImage) => i.id ?? i.mediaId ?? ""

export function ProposalThumb({ src, size = 40, className }: { src?: string | null; size?: number; className?: string }) {
  return (
    <span className={cn("relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-white/8 bg-surface", className)} style={{ width: size, height: size * 1.25 }}>
      {src ? <Image src={src} alt="" fill sizes={`${size}px`} unoptimized={src.startsWith("/api/")} className="object-cover" /> : <ImageBrokenIcon className="size-4 text-ink-3" aria-hidden />}
    </span>
  )
}

const money = (minor: number | null | undefined, currency: string) => (minor == null ? "None" : formatMoney(minor, currency as CurrencyCode))
const list = (xs: string[]) => (xs.length ? xs.join(", ") : "None")

function optionsText(options: ProductView["options"]) {
  if (!options.length) return "One variant, no options"
  return options.map((o) => `${o.name}: ${o.values.map((v) => v.value).join(", ")}`).join(" · ")
}

/** One field's value in words (photos as thumbnails). */
export function FieldValue({ field, value, detail }: { field: ProposalField; value: unknown; detail: ProposalDetailDto }) {
  const c = detail.currency
  if (value === null || value === undefined) return <span className="text-ink-3">None</span>
  switch (field) {
    case "priceMinor":
    case "compareAtMinor":
      return <span className="tabular">{money(value as number, c)}</span>
    case "categorySlug":
      return <>{categoryBySlug.get(value as CategorySlug)?.name ?? String(value)}</>
    case "tags":
    case "badges":
    case "details":
      return <>{list(value as string[])}</>
    case "collectionIds":
      return <>{list((value as string[]).map((id) => detail.names.collections[id] ?? "A collection"))}</>
    case "processingDays": {
      const d = value as [number, number]
      return <>{`${d[0]} to ${d[1]} business days`}</>
    }
    case "options":
      return <>{optionsText(value as ProductView["options"])}</>
    case "variants": {
      const vs = value as ProductView["variants"]
      return (
        <ul className="grid gap-0.5">
          {vs.map((v, i) => (
            <li key={v.id ?? `n${i}`} className="tabular">
              {Object.values(v.options).join(", ") || "Default"} <span className="text-ink-3">{v.sku}</span>
              {v.priceMinor != null ? <span className="text-ink-3">, {money(v.priceMinor, c)}</span> : null}
              {!v.id ? <span className="text-ink-3">, new{v.initialStock ? `, ${v.initialStock} in stock` : v.untracked ? ", in stock (count not tracked)" : ""}</span> : null}
            </li>
          ))}
        </ul>
      )
    }
    case "stock": {
      const s = value as Record<string, number>
      return (
        <ul className="grid gap-0.5">
          {Object.entries(s).map(([id, n]) => (
            <li key={id} className="tabular">
              {detail.names.variants[id] ?? "A variant"}: {n}
            </li>
          ))}
        </ul>
      )
    }
    case "images":
      return (
        <span className="flex flex-wrap gap-1.5">
          {(value as ViewImage[]).length ? (value as ViewImage[]).map((i) => <ProposalThumb key={imageKey(i)} src={detail.images[imageKey(i)]?.src} size={36} />) : <span className="text-ink-3">No photos</span>}
        </span>
      )
    case "description":
      return <span className="whitespace-pre-line">{String(value)}</span>
    default:
      return <>{String(value)}</>
  }
}

/** Before → after for each suggested field; a field the brand changed since the suggestion is flagged with its value now. */
export function ProposalChangeList({ detail }: { detail: ProposalDetailDto }) {
  if (!detail.changes.length) return null
  return (
    <ol className="grid gap-2" aria-label="Suggested changes">
      {detail.changes.map((ch: ProposalChangeDto) => (
        <li key={ch.field} className={cn("rounded-[10px] border p-3", ch.changedSince ? "border-acid/40 bg-acid/[0.04]" : "border-white/[0.07] bg-white/[0.018]")}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-[13px] font-medium text-ink">{ch.label}</h4>
            {ch.changedSince ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-acid">
                <WarningIcon className="size-3.5" aria-hidden /> Changed in Studio since
              </span>
            ) : null}
          </div>
          <div className="mt-2 grid gap-2 text-[13px] text-ink-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-start">
            <div className="min-w-0">
              <p className="mb-0.5 text-[11px] text-ink-3">Before</p>
              <FieldValue field={ch.field} value={ch.before} detail={detail} />
            </div>
            <ArrowRightIcon className="hidden size-4 text-ink-3 sm:mt-5 sm:block" aria-hidden />
            <div className="min-w-0 text-ink">
              <p className="mb-0.5 text-[11px] text-ink-3">After</p>
              <FieldValue field={ch.field} value={ch.after} detail={detail} />
            </div>
          </div>
          {ch.changedSince ? (
            <div className="mt-2 border-t border-white/[0.07] pt-2 text-[12px] text-ink-2">
              <p className="mb-0.5 text-[11px] text-ink-3">Now in Studio</p>
              <FieldValue field={ch.field} value={ch.now} detail={detail} />
            </div>
          ) : null}
        </li>
      ))}
    </ol>
  )
}

/** The product as it would look once accepted. */
export function ProposedProduct({ detail }: { detail: ProposalDetailDto }) {
  const p = detail.proposed
  const c = detail.currency
  const images = p.images.map((i) => detail.images[imageKey(i)]).filter((x): x is ProposalImageDto => !!x)
  const cat = categoryBySlug.get(p.categorySlug as CategorySlug)
  const total = Object.values(p.stock).reduce((n, x) => n + x, 0) + p.variants.reduce((n, v) => n + (v.initialStock ?? 0), 0)
  return (
    <article className="grid gap-4 sm:grid-cols-[180px_minmax(0,1fr)]">
      <div className="grid gap-2">
        <span className="relative block aspect-[4/5] overflow-hidden rounded-lg border border-white/8 bg-surface">
          {images[0] ? <Image src={images[0].src} alt={images[0].alt || p.title} fill sizes="180px" unoptimized={images[0].src.startsWith("/api/")} className="object-cover" /> : <ImageBrokenIcon className="absolute inset-0 m-auto size-6 text-ink-3" aria-hidden />}
        </span>
        {images.length > 1 ? (
          <span className="flex flex-wrap gap-1.5">
            {images.slice(1).map((i) => (
              <ProposalThumb key={i.key} src={i.src} size={36} />
            ))}
          </span>
        ) : null}
      </div>
      <div className="grid min-w-0 content-start gap-3">
        <div>
          <h3 className="text-lg text-ink">{p.title}</h3>
          <p className="mt-1 flex flex-wrap items-baseline gap-2 text-ink">
            <span className="tabular text-base">{money(p.priceMinor, c)}</span>
            {p.compareAtMinor ? <span className="tabular text-sm text-ink-3 line-through">{money(p.compareAtMinor, c)}</span> : null}
          </p>
          <p className="mt-1 text-xs text-ink-3">{[cat?.name ?? p.categorySlug, p.subcategory].filter(Boolean).join(" · ")}</p>
        </div>
        {p.description ? <p className="text-[13px] leading-relaxed whitespace-pre-line text-ink-2">{p.description}</p> : null}
        <dl className="grid gap-2 text-[13px]">
          <div>
            <dt className="text-[11px] text-ink-3">Options</dt>
            <dd className="text-ink-2">{optionsText(p.options)}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-ink-3">Variants</dt>
            <dd className="text-ink-2">
              {p.variants.length} {p.variants.length === 1 ? "variant" : "variants"}, {total > 0 || !p.variants.some((v) => v.untracked) ? `${total} in stock` : "in stock (count not tracked)"}
            </dd>
          </div>
          {p.processingDays ? (
            <div>
              <dt className="text-[11px] text-ink-3">Processing time</dt>
              <dd className="text-ink-2">{`${p.processingDays[0]} to ${p.processingDays[1]} business days`}</dd>
            </div>
          ) : null}
          {p.tags.length ? (
            <div>
              <dt className="text-[11px] text-ink-3">Tags</dt>
              <dd className="text-ink-2">{p.tags.join(", ")}</dd>
            </div>
          ) : null}
          {p.collectionIds.length ? (
            <div>
              <dt className="text-[11px] text-ink-3">Collections</dt>
              <dd className="text-ink-2">{p.collectionIds.map((id) => detail.names.collections[id] ?? "A collection").join(", ")}</dd>
            </div>
          ) : null}
        </dl>
      </div>
    </article>
  )
}

/**
 * A Product for the Studio product form from a proposal's view. `asNew`: a suggested new product
 * (no ids: its variants and photos are saved as new). Otherwise the product's own ids are kept, and
 * existing variants keep their count now: the editor adds a suggested stock change on top (stockDelta).
 */
export function productFromView(view: ProductView, detail: Pick<ProposalDetailDto, "images" | "currency" | "brand" | "productId">, opts: { asNew: boolean; base?: Product }): Product {
  const options: ProductOption[] = []
  for (const o of view.options) {
    if (o.name === "Size") options.push({ name: "Size", values: o.values.map((v) => v.value) })
    if (o.name === "Colour") options.push({ name: "Colour", values: o.values.map((v) => ({ name: v.value, hex: v.hex ?? "#777777" })) })
  }
  return {
    ...(opts.base ?? { stats: { views7d: 0, wishlists: 0, sales30d: 0, trend: 0 }, createdAt: new Date().toISOString(), status: "draft" as const, badges: [] }),
    id: opts.asNew ? "" : (detail.productId ?? opts.base?.id ?? ""),
    slug: opts.base?.slug ?? "",
    brandId: detail.brand.id,
    name: view.title,
    description: view.description,
    details: view.details,
    category: view.categorySlug as CategorySlug,
    subcategory: view.subcategory ?? "",
    tags: view.tags,
    price: view.priceMinor,
    ...(view.compareAtMinor != null ? { compareAt: view.compareAtMinor } : { compareAt: undefined }),
    currency: detail.currency as Product["currency"],
    images: view.images.map((i) => {
      const src = detail.images[imageKey(i)]
      return { src: src?.src ?? "/media/missing.svg", alt: i.alt, width: src?.width ?? 1200, height: src?.height ?? 1500, ...(i.id && !opts.asNew ? { imageId: i.id } : {}), ...(i.mediaId ? { mediaId: i.mediaId } : {}) }
    }),
    options,
    variants: view.variants.map((v) => {
      const kept = !opts.asNew && v.id ? opts.base?.variants.find((x) => x.id === v.id) : undefined
      return { id: opts.asNew ? "" : (v.id ?? ""), sku: v.sku, options: v.options, stock: v.id && !opts.asNew ? (kept?.stock ?? view.stock[v.id] ?? 0) : (v.initialStock ?? 0), reserved: kept?.reserved ?? 0, priceOverrideMinor: v.priceMinor }
    }),
    badges: (view.badges as Product["badges"]) ?? [],
    ...(view.processingDays ? { processingDays: view.processingDays } : { processingDays: undefined }),
    collectionIds: view.collectionIds,
  }
}
