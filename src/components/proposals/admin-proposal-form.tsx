"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { MagnifyingGlassIcon, StorefrontIcon } from "@phosphor-icons/react"
import { EmptyState } from "@/components/dashboard/empty-state"
import { PageHeader } from "@/components/dashboard/page-header"
import { ListSkeleton } from "@/components/feedback/skeletons"
import { LoadError, TrustGate } from "@/components/admin/trust/shared"
import { useSearchParam } from "@/components/admin/marketplace/url-state"
import { Field, Panel } from "@/components/studio/catalog/fields"
import { fromStudioCollection, fromStudioProduct } from "@/components/studio/catalog/live"
import { liveBrand, ProductEditor, type ProposalSubmitBody, type ServerEditor } from "@/components/studio/catalog/product-editor"
import { ProductEditorSkeleton } from "@/components/studio/catalog/skeletons"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import type { AdminProposalContextDto, ProposalDetailDto } from "@/lib/api/contracts/proposals"
import type { StudioShippingDto } from "@/lib/api/contracts/shipping"
import { createAdminProposal, getAdminProposal, getProposalContext, reviseAdminProposal, searchProposalBrands } from "@/lib/api/proposals"
import { apiUpload } from "@/lib/api/upload"
import { revalidatePrefix, useApi } from "@/lib/api/use-api"
import { brandById, STUDIO_BRAND_ID } from "@/lib/data/brands"
import { productFromView } from "./proposal-parts"

/*
 * Admin › Products › Suggestions › Add product for brand / Suggest changes / Update. The Studio
 * product form itself (ProductEditor in proposal mode), seeded with the brand's currency, handling
 * time, catalogue (SKUs, photo library) and collections. Photos upload as the brand's own
 * (catalog.propose). Saving sends a suggestion: nothing reaches the catalogue until the brand accepts.
 */

const SUGGESTIONS = "/admin/products/suggestions"

/** Reads ?brand=, ?product= or ?revise= from the URL. */
export function AdminProposalFormRoute() {
  const brandId = useSearchParam("brand") ?? undefined
  const productId = useSearchParam("product") ?? undefined
  const reviseId = useSearchParam("revise") ?? undefined
  return <AdminProposalFormPage key={`${brandId}:${productId}:${reviseId}`} brandId={brandId} productId={productId} reviseId={reviseId} />
}

export function AdminProposalFormPage({ brandId, productId, reviseId }: { brandId?: string; productId?: string; reviseId?: string }) {
  return (
    <TrustGate feature="Suggestions" anyOf={["catalog.propose"]}>
      {reviseId ? <ReviseLoader id={reviseId} /> : brandId || productId ? <FormLoader brandId={brandId} productId={productId} /> : <BrandPicker />}
    </TrustGate>
  )
}

function BackHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="grid gap-2">
      <Link href={SUGGESTIONS} className="inline-flex w-fit items-center gap-1 text-xs text-ink-2 hover:text-ink">
        ← Suggestions
      </Link>
      <PageHeader title={title} description={description} />
    </div>
  )
}

function BrandPicker() {
  const [term, setTerm] = useState("")
  const [q, setQ] = useState("")
  useEffect(() => {
    const t = window.setTimeout(() => setQ(term.trim()), 250)
    return () => window.clearTimeout(t)
  }, [term])
  const list = useApi(`admin.proposals.brands:${q}`, () => searchProposalBrands(q))
  const brands = list.data?.brands ?? []
  return (
    <div className="grid max-w-2xl gap-5">
      <BackHeader title="Add product for brand" description="Pick the brand. You fill in the same form brands use, and the brand accepts it before it goes live." />
      <label className="relative">
        <span className="sr-only">Search brands</span>
        <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
        <input autoFocus value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Brand name or handle" className="h-11 w-full rounded-md border border-line-soft bg-card pr-3 pl-9 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-white/15" />
      </label>
      {list.isLoading && !list.data ? (
        <ListSkeleton rows={5} />
      ) : list.error && !list.data ? (
        <LoadError error={list.error} onRetry={() => void list.revalidate()} what="brands" />
      ) : !brands.length ? (
        <EmptyState icon={StorefrontIcon} title={q ? `No brand matches “${q}”` : "No brands yet"} />
      ) : (
        <ul className="grid gap-1" aria-label="Brands">
          {brands.map((b) => (
            <li key={b.id}>
              <Link href={`${SUGGESTIONS}/new?brand=${encodeURIComponent(b.id)}`} className="flex min-h-12 items-center justify-between gap-3 rounded-lg border border-white/[0.06] px-3 py-2 transition-colors hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-violet">
                <span className="min-w-0">
                  <span className="block truncate text-sm text-ink">{b.name}</span>
                  <span className="block truncate text-xs text-ink-3">
                    @{b.handle}
                    {b.city ? `, ${b.city}` : ""}
                  </span>
                </span>
                <span className="text-xs text-violet">Choose</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ReviseLoader({ id }: { id: string }) {
  const q = useApi(`admin.proposals.one:${id}`, () => getAdminProposal(id), { revalidateOnFocus: false })
  const p = q.data?.proposal
  if (q.error && !p) return <LoadError error={q.error} onRetry={() => void q.revalidate()} what="this suggestion" />
  if (!p) return <ProductEditorSkeleton />
  if (p.status !== "pending")
    return (
      <EmptyState
        title="This suggestion can't be updated"
        body="It was already answered or withdrawn. Start a new one instead."
        action={
          <Button asChild variant="secondary" size="sm">
            <Link href={`${SUGGESTIONS}?proposal=${encodeURIComponent(id)}`}>Open it</Link>
          </Button>
        }
      />
    )
  return <FormLoader brandId={p.kind === "new" ? p.brand.id : undefined} productId={p.kind === "edit" ? (p.productId ?? undefined) : undefined} revise={p} />
}

function FormLoader({ brandId, productId, revise }: { brandId?: string; productId?: string; revise?: ProposalDetailDto }) {
  const key = `admin.proposals.context:${brandId ?? ""}:${productId ?? ""}`
  const ctx = useApi<AdminProposalContextDto>(key, () => getProposalContext({ brandId, productId }), { revalidateOnFocus: false, keepPrevious: false })
  if (ctx.error && !ctx.data) return <LoadError error={ctx.error} onRetry={() => void ctx.revalidate()} what="the brand's catalogue" />
  if (!ctx.data) return <ProductEditorSkeleton />
  const data = ctx.data
  if (productId && data.pendingId && data.pendingId !== revise?.id)
    return (
      <div className="grid gap-5">
        <BackHeader title="Suggest changes" description={data.product?.title ?? "Product"} />
        <EmptyState
          title="A suggestion is already waiting"
          body={`${data.brand.name} hasn't answered the last suggestion for this product. Update that one instead.`}
          action={
            <Button asChild variant="secondary" size="sm">
              <Link href={`${SUGGESTIONS}/new?revise=${encodeURIComponent(data.pendingId)}`}>Update it</Link>
            </Button>
          }
        />
      </div>
    )
  return <AdminProposalEditor ctx={data} revise={revise} />
}

function AdminProposalEditor({ ctx, revise }: { ctx: AdminProposalContextDto; revise?: ProposalDetailDto }) {
  const router = useRouter()
  const [note, setNote] = useState(revise?.note ?? "")
  const noteRef = useRef(note)
  useEffect(() => {
    noteRef.current = note
  })
  const editing = !!ctx.product
  const base = brandById.get(STUDIO_BRAND_ID)!
  const brand = useMemo(
    () =>
      liveBrand(base, { id: ctx.brand.id, handle: ctx.brand.handle, name: ctx.brand.name }, {
        brand: { country: ctx.brand.country, currency: ctx.brand.currency },
        profile: { originCity: ctx.brand.city, handlingMin: ctx.brand.processingDays[0], handlingMax: ctx.brand.processingDays[1] },
      } as unknown as StudioShippingDto),
    [base, ctx.brand],
  )
  const current = ctx.product ? fromStudioProduct(ctx.product) : undefined
  // Updating a suggestion starts from what it proposed.
  const product = revise && current ? productFromView(revise.proposed, revise, { asNew: false, base: current }) : current
  const prefill = revise && !current ? productFromView(revise.proposed, revise, { asNew: true }) : undefined

  const submit = async (body: ProposalSubmitBody) => {
    const n = noteRef.current.trim() || undefined
    const result = revise ? await reviseAdminProposal(revise.id, { product: body, note: n ?? "" }) : editing ? await createAdminProposal({ kind: "edit", productId: ctx.product!.id, product: body, note: n }) : await createAdminProposal({ kind: "new", brandId: ctx.brand.id, product: body, note: n })
    revalidatePrefix("admin.proposals")
    toast.success(revise ? "Suggestion updated" : "Suggestion sent", { description: `${ctx.brand.name} gets a notification and an email. Nothing changes until they accept.` })
    router.push(`${SUGGESTIONS}?proposal=${encodeURIComponent(result.proposal.id)}`)
  }

  const server: ServerEditor = {
    dto: ctx.product ?? undefined,
    allProducts: ctx.products.map(fromStudioProduct),
    collections: ctx.collections.map((c) => fromStudioCollection(c, ctx.brand.id)),
    onSaved: () => {},
    reload: () => {},
    upload: async (file) => {
      const media = await apiUpload(file, { purpose: "social_post", as: "admin", brandId: ctx.brand.id }).promise
      return { src: media.src, width: media.width ?? 1200, height: media.height ?? 1500, mediaId: media.id }
    },
    proposal: {
      title: revise ? "Update suggestion" : editing ? `Suggest changes to ${ctx.product!.title}` : `Add product for ${ctx.brand.name}`,
      description: editing ? "Change what should be different. Only the fields you change are suggested." : "Fill in the product as the brand would. They review it before it goes live.",
      backHref: revise ? `${SUGGESTIONS}?proposal=${encodeURIComponent(revise.id)}` : SUGGESTIONS,
      backLabel: "Suggestions",
      saveLabel: revise ? "Update suggestion" : "Send to brand",
      publishNote: editing ? `The changes apply when ${ctx.brand.name} accepts them.` : `It goes live when ${ctx.brand.name} accepts it.`,
      prefill,
      aside: (
        <Panel title="Note to the brand" description="Optional. Shown with the suggestion and in the email.">
          <Field id="pp-note" label="Note" optional aside={<span className="text-xs text-ink-3 tabular">{note.length}/300</span>}>
            <Textarea id="pp-note" value={note} maxLength={300} rows={3} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Photos from the lookbook shoot" />
          </Field>
        </Panel>
      ),
      submit,
    },
  }
  return <ProductEditor key={revise?.id ?? ctx.product?.id ?? `new:${ctx.brand.id}`} product={product} brand={brand} server={server} />
}
