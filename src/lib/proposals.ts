/**
 * Suggestions from Yard: the pure rules behind a product proposal, shared by the server (which
 * stores and applies them) and the review pages (which show them). Isomorphic, no I/O.
 *
 * A product is compared as a ProductView: the fields the Studio product editor writes, in one
 * canonical form. An edit proposal stores only the fields that differ from the product
 * (`changes`), with those fields' values at proposal time (`base`). At review, a field whose
 * current value no longer equals its base was changed by the brand since: it is flagged.
 *
 * Stock is the exception: in `changes` it is a change per variant (+3, -2) from the count the form
 * opened with, applied as an adjustment the way the Studio editor saves stock, so sales made in the
 * meantime are kept. It is never flagged as changed since.
 */

export const PROPOSAL_FIELDS = [
  "title",
  "description",
  "details",
  "categorySlug",
  "subcategory",
  "tags",
  "badges",
  "priceMinor",
  "compareAtMinor",
  "processingDays",
  "options",
  "variants",
  "images",
  "collectionIds",
  "stock",
] as const
export type ProposalField = (typeof PROPOSAL_FIELDS)[number]

export const proposalFieldLabels: Record<ProposalField, string> = {
  title: "Name",
  description: "Description",
  details: "Details",
  categorySlug: "Category",
  subcategory: "Subcategory",
  tags: "Tags",
  badges: "Badges",
  priceMinor: "Price",
  compareAtMinor: "Compare-at price",
  processingDays: "Processing time",
  options: "Options",
  variants: "Variants",
  images: "Photos",
  collectionIds: "Collections",
  stock: "Stock",
}

export type ViewOption = { name: string; values: { value: string; hex?: string }[] }
export type ViewVariant = { id?: string; sku: string; options: Record<string, string>; priceMinor: number | null; initialStock?: number; /** New variants only: "available, stock not tracked" (an imported shop that shows no count). */ untracked?: true }
export type ViewImage = { id?: string; mediaId?: string; alt: string }

export type ProductView = {
  title: string
  description: string
  details: string[]
  categorySlug: string
  subcategory: string | null
  tags: string[]
  badges: string[]
  priceMinor: number
  compareAtMinor: number | null
  processingDays: [number, number] | null
  options: ViewOption[]
  variants: ViewVariant[]
  images: ViewImage[]
  collectionIds: string[]
  /** On-hand count per existing variant id. */
  stock: Record<string, number>
}

/** A proposal's changes. `stock` here is the change per variant, not a count (see the top of this file). */
export type ProposalChanges = Partial<ProductView>

/** On-hand counts after applying stock changes (never below zero). */
export function stockAfter(counts: Record<string, number>, delta: Record<string, number>): Record<string, number> {
  const out = { ...counts }
  for (const [id, d] of Object.entries(delta)) if (id in out) out[id] = Math.max(0, out[id] + d)
  return out
}

/** The view of a product body (create or proposal), with defaults filled the way the server writes them. */
export function viewOf(body: {
  title: string
  description?: string
  details?: string[]
  categorySlug: string
  subcategory?: string | null
  tags?: string[]
  badges?: string[]
  priceMinor: number
  compareAtMinor?: number | null
  processingDays?: [number, number] | null
  options?: ViewOption[]
  variants: { id?: string; sku: string; options?: Record<string, string>; priceMinor?: number | null; initialStock?: number; untracked?: true }[]
  images?: { id?: string; mediaId?: string; alt?: string }[]
  collectionIds?: string[]
  stock?: Record<string, number>
}): ProductView {
  return normalize({
    title: body.title,
    description: body.description ?? "",
    details: body.details ?? [],
    categorySlug: body.categorySlug,
    subcategory: body.subcategory ?? null,
    tags: body.tags ?? [],
    badges: body.badges ?? [],
    priceMinor: body.priceMinor,
    compareAtMinor: body.compareAtMinor ?? null,
    processingDays: body.processingDays ?? null,
    options: body.options ?? [],
    variants: body.variants.map((v) => ({ ...(v.id ? { id: v.id } : {}), sku: v.sku, options: v.options ?? {}, priceMinor: v.priceMinor ?? null, ...(v.initialStock !== undefined && !v.id ? { initialStock: v.initialStock } : {}), ...(v.untracked && !v.id && !v.initialStock ? { untracked: true as const } : {}) })),
    images: (body.images ?? []).map((i) => ({ ...(i.id ? { id: i.id } : {}), ...(i.mediaId && !i.id ? { mediaId: i.mediaId } : {}), alt: i.alt ?? "" })),
    collectionIds: body.collectionIds ?? [],
    stock: body.stock ?? {},
  })
}

/** The canonical form: trimmed text, tags as the server stores them, SKUs upper-cased, option maps with sorted keys, option values as { value, hex? }. */
export function normalize(v: ProductView): ProductView {
  const sortKeys = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)))
  return {
    ...v,
    title: v.title.trim(),
    description: v.description.trim(),
    subcategory: v.subcategory || null,
    tags: [...new Set(v.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))],
    badges: [...new Set(v.badges)],
    processingDays: v.processingDays ? [Math.min(...v.processingDays), Math.max(...v.processingDays)] : null,
    // One key order (stored jsonb sorts keys, the form doesn't), so an untouched colour isn't a change.
    options: v.options.map((o) => ({ name: o.name, values: o.values.map((x) => (x.hex ? { value: x.value, hex: x.hex } : { value: x.value })) })),
    variants: v.variants.map((x) => ({ ...x, sku: x.sku.trim().toUpperCase(), options: sortKeys(x.options) })),
    stock: { ...v.stock },
  }
}

/** What a field is compared by: photos by which upload and in what order (alt text is not a change). */
function comparable(field: ProposalField, value: unknown): string {
  if (field === "images") return JSON.stringify(((value as ViewImage[]) ?? []).map((i) => i.id ?? i.mediaId ?? ""))
  if (field === "variants") return JSON.stringify(((value as ViewVariant[]) ?? []).map((x) => [x.id ?? null, x.sku, x.options, x.priceMinor ?? null, x.initialStock ?? null, x.untracked ?? null]))
  if (field === "stock") {
    const s = (value as Record<string, number>) ?? {}
    return JSON.stringify(Object.keys(s).sort().map((k) => [k, s[k]]))
  }
  return JSON.stringify(value ?? null)
}

export const sameField = (field: ProposalField, a: unknown, b: unknown) => comparable(field, a) === comparable(field, b)

export type DiffContext = {
  /** The brand's default processing time: a product without its own time shows this in the editor. */
  defaultProcessing?: [number, number] | null
  /** The stock change per existing variant, from the counts the form opened with. */
  stockDelta?: Record<string, number>
}

/**
 * The fields `proposed` changes on `current`, and their values in `current` (the base).
 * Stock comes from `ctx.stockDelta`: only variants that stay on the product, only non-zero changes
 * (the base is the count now, for the review's before → after).
 */
export function diffProposal(currentRaw: ProductView, proposedRaw: ProductView, ctx: DiffContext = {}): { changes: ProposalChanges; base: ProposalChanges; fields: ProposalField[] } {
  const current = normalize(currentRaw)
  const proposed = normalize(proposedRaw)
  if (!current.processingDays && ctx.defaultProcessing && proposed.processingDays && sameField("processingDays", proposed.processingDays, normalize({ ...current, processingDays: ctx.defaultProcessing }).processingDays)) {
    proposed.processingDays = null
  }
  const kept = new Set(proposed.variants.map((v) => v.id).filter(Boolean) as string[])
  const stock: Record<string, number> = {}
  const stockBase: Record<string, number> = {}
  for (const [id, n] of Object.entries(ctx.stockDelta ?? {})) {
    if (!kept.has(id) || !(id in current.stock) || !Number.isInteger(n) || n === 0) continue
    stock[id] = n
    stockBase[id] = current.stock[id]
  }
  const changes: ProposalChanges = {}
  const base: ProposalChanges = {}
  const fields: ProposalField[] = []
  for (const f of PROPOSAL_FIELDS) {
    if (f === "stock") {
      if (Object.keys(stock).length) {
        changes.stock = stock
        base.stock = stockBase
        fields.push("stock")
      }
      continue
    }
    if (sameField(f, current[f], proposed[f])) continue
    ;(changes as Record<string, unknown>)[f] = proposed[f]
    ;(base as Record<string, unknown>)[f] = current[f]
    fields.push(f)
  }
  return { changes, base, fields }
}

/**
 * The proposed fields the brand changed after the proposal was made (their current value isn't the
 * base any more). Stock isn't one: it's applied as a change, so sales since then are kept.
 */
export function changedSince(base: ProposalChanges, currentRaw: ProductView): ProposalField[] {
  const current = normalize(currentRaw)
  const out: ProposalField[] = []
  for (const f of PROPOSAL_FIELDS) {
    if (!(f in base) || f === "stock") continue
    if (!sameField(f, base[f], current[f])) out.push(f)
  }
  return out
}

/** The product as it would be with the changes applied (what the review shows as "after"). */
export function applyChanges(current: ProductView, changes: ProposalChanges): ProductView {
  const next = { ...current, ...changes, stock: stockAfter(current.stock, changes.stock ?? {}) }
  return normalize(next)
}

/**
 * The Studio update body for the changes (everything but stock), and the stock change per variant
 * (applied as an adjustment). Only the proposed fields are sent, so anything else the brand changed
 * since stays as it is.
 */
export function updateBodyOf(changes: ProposalChanges): { body: Record<string, unknown>; stockDelta: Record<string, number> } {
  const body: Record<string, unknown> = {}
  for (const f of PROPOSAL_FIELDS) {
    if (f === "stock" || !(f in changes)) continue
    const value = changes[f]
    if (f === "images") body.images = (value as ViewImage[]).map((i) => (i.id ? { id: i.id, alt: i.alt } : { mediaId: i.mediaId, alt: i.alt }))
    else if (f === "variants") body.variants = (value as ViewVariant[]).map((v) => (v.id ? { id: v.id, sku: v.sku, options: v.options, priceMinor: v.priceMinor } : { sku: v.sku, options: v.options, priceMinor: v.priceMinor, ...(v.initialStock ? { initialStock: v.initialStock } : {}), ...(v.untracked && !v.initialStock ? { untracked: true } : {}) }))
    else body[f] = value
  }
  return { body, stockDelta: { ...(changes.stock ?? {}) } }
}

/** Every upload a proposal names (new photos only: kept photos are already the product's). */
export function proposalMediaIds(payload: { images?: ViewImage[] } | null | undefined): string[] {
  return [...new Set((payload?.images ?? []).map((i) => (!i.id ? i.mediaId : undefined)).filter((x): x is string => !!x))]
}
