"use client"

import Image from "next/image"
import { ArrowDownIcon, ArrowUpIcon, TrashIcon } from "@phosphor-icons/react"
import { formatMoney } from "@/lib/money"
import type { Product } from "@/lib/data/types"
import type { CurrencyCode } from "@/config/markets"
import { safePlaceSrc } from "@/lib/around/labels"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

/** Featured pieces (§6.4): the brand's own products, in the order picked, up to `max`. Same pattern as the storefront editor's ItemPicker. */
export function ProductPicker({ id, legend, max, products, value, onChange, error }: { id: string; legend: string; max: number; products: Product[]; value: string[]; onChange: (ids: string[]) => void; error?: string }) {
  const picked = value.filter((v) => products.some((p) => p.id === v))
  const full = picked.length >= max
  return (
    <div role="group" aria-labelledby={`${id}-label`} className="grid min-w-0 gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <p id={`${id}-label`} className="text-[13px] text-ink">
          {legend}
        </p>
        {picked.length ? (
          <span className="flex items-baseline gap-3">
            <span className="text-xs text-ink-3 tabular">
              {picked.length} of {max}
            </span>
            <button type="button" onClick={() => onChange([])} className="-mx-2 -my-3 inline-flex min-h-10 items-center rounded-sm px-2 text-xs text-ink-2 underline underline-offset-2 hover:text-ink md:min-h-0">
              Clear
            </button>
          </span>
        ) : null}
      </div>
      {products.length === 0 ? (
        <p className="rounded-md border border-dashed border-line px-3 py-4 text-center text-xs text-ink-2">Publish products in your catalogue to feature them here.</p>
      ) : (
        <ul className="grid max-h-72 grid-cols-[minmax(0,1fr)] gap-0.5 overflow-y-auto rounded-md border border-line-soft bg-card p-1">
          {products.map((p) => {
            const at = picked.indexOf(p.id)
            const on = at >= 0
            const disabled = !on && full
            const cid = `${id}-${p.id}`
            return (
              <li key={p.id}>
                <label htmlFor={cid} className={cn("flex min-h-11 items-center gap-2.5 rounded-[5px] px-2 py-1.5 transition-colors", disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-white/[0.03]")}>
                  <Checkbox id={cid} checked={on} disabled={disabled} onCheckedChange={(c) => onChange(c ? [...picked, p.id] : picked.filter((v) => v !== p.id))} />
                  <span className="relative size-8 shrink-0 overflow-hidden rounded-[4px] bg-surface">{p.images[0] ? <Image src={p.images[0].src} alt="" fill sizes="32px" className="object-cover" /> : null}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-ink">{p.name}</span>
                    <span className="block truncate text-[11px] text-ink-3 tabular">{formatMoney(p.price, p.currency as CurrencyCode)}</span>
                  </span>
                  {on ? (
                    <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-purple text-[10px] text-ink tabular" aria-label={`Position ${at + 1}`}>
                      {at + 1}
                    </span>
                  ) : null}
                </label>
              </li>
            )
          })}
        </ul>
      )}
      {full ? <p className="text-xs text-ink-3">That&apos;s the most you can feature. Untick one to pick another.</p> : null}
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  )
}

export type PhotoItem = { mediaId: string; src: string; alt: string }

/** Photos with required alt text, reorderable (§6.4 Photos). Only media ids and alt text are ever sent. */
export function PhotoList({ items, onChange, errors }: { items: PhotoItem[]; onChange: (items: PhotoItem[]) => void; errors: Record<string, string> }) {
  if (!items.length) return null
  const move = (i: number, d: -1 | 1) => {
    const next = [...items]
    const [x] = next.splice(i, 1)
    next.splice(i + d, 0, x)
    onChange(next)
  }
  return (
    <ol className="grid gap-2" aria-label="Photos on this place">
      {items.map((p, i) => {
        const src = safePlaceSrc(p.src)
        const err = errors[`images.${i}.alt`] ?? errors[`images.${i}.mediaId`] ?? errors[`images.${i}`]
        return (
          <li key={p.mediaId} className={cn("flex items-start gap-3 rounded-md border border-line-soft p-2", err && "border-danger/50")}>
            <span className="relative size-16 shrink-0 overflow-hidden rounded bg-surface">
              {src ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={src} alt="" className="absolute inset-0 size-full object-cover" />
              ) : null}
            </span>
            <div className="grid min-w-0 flex-1 gap-1">
              <label htmlFor={`photo-alt-${i}`} className="text-xs text-ink-2">
                {i === 0 ? "Cover photo. " : ""}Describe it for people who can&apos;t see it
              </label>
              <Input id={`photo-alt-${i}`} value={p.alt} maxLength={200} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, alt: e.target.value } : x)))} aria-invalid={err ? true : undefined} aria-describedby={err ? `photo-alt-${i}-error` : undefined} className="h-10 md:h-9" />
              {err ? (
                <p id={`photo-alt-${i}-error`} className="text-xs text-danger">
                  {err}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-1">
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Move earlier" disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUpIcon />
              </Button>
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Move later" disabled={i === items.length - 1} onClick={() => move(i, 1)}>
                <ArrowDownIcon />
              </Button>
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove this photo" onClick={() => onChange(items.filter((_, j) => j !== i))}>
                <TrashIcon />
              </Button>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
