"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowRightIcon, CaretLeftIcon, CheckIcon, ChecksIcon, PencilSimpleIcon, SparkleIcon, WarningIcon, XIcon } from "@phosphor-icons/react"
import { surfaceClass } from "@/components/dashboard/insight/insight-panel"
import { EmptyState } from "@/components/dashboard/empty-state"
import { PageHeader } from "@/components/dashboard/page-header"
import { relativeTime } from "@/components/feedback/notification-bell"
import { ListSkeleton } from "@/components/feedback/skeletons"
import { SessionGate } from "@/components/session/session-gate"
import { fromStudioCollection, fromStudioProduct, loadStudioCollections, loadStudioProductDtos, studioCollectionsKey } from "@/components/studio/catalog/live"
import { liveBrand, ProductEditor, type ProposalSubmitBody, type ServerEditor } from "@/components/studio/catalog/product-editor"
import { ProductEditorSkeleton } from "@/components/studio/catalog/skeletons"
import { formatDate } from "@/components/studio/catalog/utils"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import type { ProposalDetailDto, ProposalSummaryDto } from "@/lib/api/contracts/proposals"
import type { StudioShippingDto } from "@/lib/api/contracts/shipping"
import { errorMessage } from "@/lib/api/errors"
import { acceptAllStudioProposals, acceptStudioProposal, declineAllStudioProposals, declineStudioProposal, getStudioProposal, listStudioProposals, STUDIO_PROPOSALS_KEY, type ProposalBatchResult } from "@/lib/api/proposals"
import { actionKey } from "@/lib/api/founding"
import { ACCEPT_ALL_HREF, preparedLine } from "@/lib/batch-accept"
import { getStudioShipping, STUDIO_SHIPPING_KEY } from "@/lib/api/shipping"
import { apiUpload } from "@/lib/api/upload"
import { revalidatePrefix, useApi } from "@/lib/api/use-api"
import { brandById, STUDIO_BRAND_ID } from "@/lib/data/brands"
import { canBrand, roleCantSentence } from "@/lib/permissions"
import { useRealtimeEvent } from "@/lib/realtime/use-realtime"
import { useServerSession } from "@/lib/session/use-server-session"
import { cn } from "@/lib/utils"
import { ProposalChangeList, ProposalStatusBadge, ProposalThumb, ProposedProduct, productFromView } from "./proposal-parts"

/*
 * Studio › Products › Suggestions from Yard. Yard's team suggests a product, or changes to one of
 * the brand's products; nothing changes until a member who can manage products accepts. Accept
 * creates and publishes the product (or applies only the suggested fields), "Edit before accepting"
 * opens the product form with the suggestion in it (saving accepts), Decline takes an optional reason.
 */

const SUGGESTIONS = "/studio/products/suggestions"
const hrefOf = (id: string) => `${SUGGESTIONS}/${encodeURIComponent(id)}`

/** Pending suggestions for the active brand, live. The Products page banner and the list read it. */
export function useStudioProposals(status: "pending" | "all" = "pending") {
  const brandId = useServerSession((s) => s.brand?.brand.id ?? null)
  const q = useApi(brandId ? `${STUDIO_PROPOSALS_KEY}:${brandId}:${status}` : null, () => listStudioProposals(status))
  const revalidate = q.revalidate
  useRealtimeEvent("proposal.updated", () => void revalidate())
  return q
}

/** The Products page's "Suggestions from Yard" banner: only while something is waiting. */
export function SuggestionsBanner() {
  const q = useStudioProposals("pending")
  const n = q.data?.counts.pending ?? 0
  if (!n) return null
  return (
    <Link href={SUGGESTIONS} className={cn(surfaceClass, "group flex items-center gap-3 p-4 transition-colors hover:border-white/15")}>
      <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-purple/20 text-violet">
        <SparkleIcon className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-ink">Suggestions from Yard</span>
        <span className="block text-xs text-ink-2">
          {n} waiting for you. Nothing changes until you accept.
        </span>
      </span>
      <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-acid px-2 text-xs font-medium text-obsidian tabular">{n}</span>
      <ArrowRightIcon className="size-4 text-ink-3 transition-transform group-hover:translate-x-0.5" aria-hidden />
    </Link>
  )
}

/**
 * Studio Overview: "Yard prepared N products for you. Accept all in one tap", straight to the list
 * with Accept all in focus. Only while something is waiting.
 */
export function SuggestionsCard({ className }: { className?: string }) {
  const q = useStudioProposals("pending")
  const items = q.data?.items.filter((p) => p.status === "pending") ?? []
  const n = items.length
  if (!n) return null
  const line = items.every((p) => p.kind === "new") ? preparedLine(n) : `Yard has ${n} ${n === 1 ? "suggestion" : "suggestions"} for you. Accept ${n === 1 ? "it" : "all"} in one tap`
  return (
    <Link href={ACCEPT_ALL_HREF} className={cn(surfaceClass, "group flex items-center gap-3 p-4 transition-colors hover:border-white/15", className)}>
      <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-purple/20 text-violet">
        <SparkleIcon className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-ink">{line}</span>
        <span className="block text-xs text-ink-2">{n === 1 ? "Nothing goes live until you accept." : "Each one is checked on its own. Nothing goes live until you accept."}</span>
      </span>
      <span className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-acid px-3.5 text-xs font-medium text-obsidian">
        <ChecksIcon className="size-4" aria-hidden /> {n === 1 ? "Accept" : "Accept all"}
      </span>
    </Link>
  )
}

function BackLink({ href = "/studio/products", label = "Products" }: { href?: string; label?: string }) {
  return (
    <Link href={href} className="inline-flex w-fit items-center gap-1 text-xs text-ink-2 hover:text-ink">
      <CaretLeftIcon className="size-3.5" /> {label}
    </Link>
  )
}

export function StudioProposalsPage() {
  return (
    <div className="grid gap-5">
      <div className="grid gap-2">
        <BackLink />
        <PageHeader title="Suggestions from Yard" description="Products and changes the Yard team suggested for your catalogue. Nothing changes until you accept." />
      </div>
      <SessionGate surface="studio" feature="Suggestions from Yard">
        <StudioProposalsList />
      </SessionGate>
    </div>
  )
}

function StudioProposalsList() {
  const q = useStudioProposals("all")
  const items = q.data?.items ?? []
  const waiting = items.filter((p) => p.status === "pending")
  const past = items.filter((p) => p.status !== "pending")
  // Why a suggestion stayed pending after the last batch (it's still in the list, with the reason).
  const [reasons, setReasons] = useState<Record<string, string>>({})
  if (q.isLoading && !q.data) return <ListSkeleton rows={4} />
  if (q.error && !q.data) return <EmptyState title="Suggestions couldn't load" body={errorMessage(q.error)} action={<Button size="sm" variant="secondary" onClick={() => void q.revalidate()}>Try again</Button>} />
  if (!items.length) return <EmptyState icon={SparkleIcon} title="No suggestions yet" body="When the Yard team suggests a product or a change, it shows here and you get a notification." />
  return (
    <div className="grid gap-6">
      <section className="grid gap-2" aria-labelledby="sg-waiting">
        <h2 id="sg-waiting" className="text-sm text-ink">Waiting for you</h2>
        {waiting.length ? (
          <WaitingSuggestions
            items={waiting}
            reasons={reasons}
            onDone={(r, kind) => {
              setReasons((x) => {
                const next = { ...x }
                for (const id of r.accepted) delete next[id]
                for (const s of r.skipped) next[s.id] = kind === "accept" ? s.reason : `Not declined: ${s.reason}`
                return next
              })
              void q.revalidate()
            }}
          />
        ) : (
          <p className="text-sm text-ink-2">Nothing waiting.</p>
        )}
      </section>
      {past.length ? (
        <section className="grid gap-2" aria-labelledby="sg-past">
          <h2 id="sg-past" className="text-sm text-ink">Answered</h2>
          <ProposalRows items={past} />
        </section>
      ) : null}
    </div>
  )
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/**
 * The waiting list with one-tap answers: Accept all (N) up front (in focus when arriving from the
 * Overview card or an email, ?focus=accept-all), checkboxes with Accept selected, and Decline all
 * behind an inline confirm. Each suggestion is still accepted on its own on the server, so one that
 * can't be (a product that changed since, a missing photo) stays here with the reason.
 */
function WaitingSuggestions({ items, reasons, onDone }: { items: ProposalSummaryDto[]; reasons: Record<string, string>; onDone: (r: ProposalBatchResult, kind: "accept" | "decline") => void }) {
  const { can, reason: cantReason } = useCanDecide()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<null | "all" | "selected" | "decline">(null)
  const [confirmDecline, setConfirmDecline] = useState(false)
  const [why, setWhy] = useState("")
  const key = useRef(actionKey())
  const allRef = useRef<HTMLButtonElement>(null)
  // Arriving from the Overview card or an email (?focus=accept-all): Accept all is in focus, one tap away.
  useEffect(() => {
    if (can && new URLSearchParams(window.location.search).get("focus") === "accept-all") {
      allRef.current?.focus()
      allRef.current?.scrollIntoView({ block: "center" })
    }
  }, [can])

  // Only ids still waiting count (a row answered elsewhere drops out of the selection).
  const ids = items.map((p) => p.id)
  const chosen = ids.filter((id) => selected.has(id))
  const allOn = chosen.length === ids.length
  const toggleAll = () => setSelected(allOn ? new Set() : new Set(ids))
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  async function run(kind: "all" | "selected" | "decline") {
    setBusy(kind)
    try {
      const body = { ids: kind === "selected" || (kind === "decline" && chosen.length) ? chosen : undefined, idempotencyKey: key.current }
      const r = kind === "decline" ? await declineAllStudioProposals({ ...body, reason: why.trim() || undefined }) : await acceptAllStudioProposals(body)
      key.current = actionKey()
      setSelected(new Set())
      setConfirmDecline(false)
      setWhy("")
      revalidatePrefix(STUDIO_PROPOSALS_KEY)
      if (kind !== "decline") revalidatePrefix("studio.catalog")
      onDone(r, kind === "decline" ? "decline" : "accept")
      const left = r.skipped.length ? ` ${plural(r.skipped.length, "suggestion")} still ${r.skipped.length === 1 ? "needs" : "need"} you: the reason is next to ${r.skipped.length === 1 ? "it" : "each"}.` : ""
      if (kind === "decline") toast(r.accepted.length ? `${plural(r.accepted.length, "suggestion")} declined` : "Nothing was declined", { description: `Nothing in your catalogue changed.${left}` })
      else if (r.accepted.length) toast.success(`${plural(r.accepted.length, "suggestion")} accepted`, { description: `New products are in your catalogue, live when your brand can publish.${left}` })
      else toast.error("Nothing could be accepted", { description: left.trim() || "Reload and try again." })
    } catch (e) {
      // The same action key goes again on a retry, so a request that did land isn't run twice.
      toast.error("That didn't go through", { description: errorMessage(e) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="grid gap-3">
      {can ? (
        <div className={cn(surfaceClass, "grid gap-3 p-4")}>
          <div className="flex flex-wrap items-center gap-2">
            <Button ref={allRef} id="accept-all" type="button" variant="primary" className="h-11 flex-1 sm:flex-none" loading={busy === "all"} disabled={!!busy} onClick={() => void run("all")}>
              <ChecksIcon aria-hidden /> Accept all ({items.length})
            </Button>
            {chosen.length && !allOn ? (
              <Button type="button" variant="secondary" className="h-11 flex-1 sm:flex-none" loading={busy === "selected"} disabled={!!busy} onClick={() => void run("selected")}>
                <CheckIcon aria-hidden /> Accept selected ({chosen.length})
              </Button>
            ) : null}
            <Button type="button" variant="ghost" className="h-11 sm:ml-auto" disabled={!!busy} aria-expanded={confirmDecline} onClick={() => setConfirmDecline((v) => !v)}>
              <XIcon aria-hidden /> {chosen.length && !allOn ? `Decline selected (${chosen.length})` : "Decline all"}
            </Button>
          </div>
          <p className="text-xs text-ink-3">Each one is added exactly as if you accepted it by itself. Anything that can&apos;t be stays here with the reason.</p>
          {confirmDecline ? (
            <div role="group" aria-label="Confirm declining" className="grid gap-2 rounded-lg border border-danger/30 bg-danger/[0.05] p-3">
              <p className="text-sm text-ink">
                Decline {chosen.length && !allOn ? plural(chosen.length, "selected suggestion") : `all ${plural(items.length, "suggestion")}`}? Nothing in your catalogue changes, and Yard sees your answer.
              </p>
              <label htmlFor="sg-decline-all-why" className="text-xs text-ink-2">
                Tell Yard why (optional)
              </label>
              <Textarea id="sg-decline-all-why" value={why} onChange={(e) => setWhy(e.target.value)} maxLength={300} rows={2} placeholder="e.g. We don't stock these any more." />
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="destructive" size="sm" loading={busy === "decline"} disabled={!!busy} onClick={() => void run("decline")}>
                  Decline {chosen.length && !allOn ? chosen.length : items.length}
                </Button>
                <Button type="button" variant="ghost" size="sm" disabled={!!busy} onClick={() => setConfirmDecline(false)}>
                  Keep them
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-ink-3">{cantReason}</p>
      )}
      <ul className={cn(surfaceClass, "grid grid-cols-[minmax(0,1fr)] divide-y divide-white/[0.06] p-0")}>
        {can ? (
          <li className="flex min-w-0 items-center gap-3 px-4 py-2.5">
            <Checkbox id="sg-select-all" checked={allOn ? true : chosen.length ? "indeterminate" : false} onCheckedChange={toggleAll} aria-label="Select all waiting suggestions" />
            <label htmlFor="sg-select-all" className="text-xs text-ink-2">
              {chosen.length ? `${chosen.length} of ${items.length} selected` : "Select all"}
            </label>
          </li>
        ) : null}
        {items.map((p) => (
          <li key={p.id} className="flex min-w-0 items-center gap-3 pl-4">
            {can ? <Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggle(p.id)} aria-label={`Select ${p.kind === "new" ? p.title : `changes to ${p.title}`}`} /> : null}
            <ProposalLink p={p} reason={reasons[p.id]} />
          </li>
        ))}
      </ul>
    </div>
  )
}

function ProposalLink({ p, reason }: { p: ProposalSummaryDto; reason?: string }) {
  return (
    <Link href={hrefOf(p.id)} className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.03]">
      <ProposalThumb src={p.cover} size={36} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-ink">{p.kind === "new" ? p.title : `Changes to ${p.title}`}</span>
        <span className="block truncate text-xs text-ink-3">{p.kind === "new" ? "New product" : `${p.fields.length} ${p.fields.length === 1 ? "change" : "changes"}`}</span>
        {reason ? (
          <span role="status" className="mt-1 flex items-start gap-1 text-xs text-danger">
            <WarningIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0">{reason}</span>
          </span>
        ) : null}
      </span>
      <span className="hidden shrink-0 text-[11px] text-ink-3 sm:block">{relativeTime(p.createdAt)}</span>
      <ProposalStatusBadge status={p.status} />
    </Link>
  )
}

function ProposalRows({ items }: { items: ProposalSummaryDto[] }) {
  return (
    <ul className={cn(surfaceClass, "grid grid-cols-[minmax(0,1fr)] divide-y divide-white/[0.06] p-0")}>
      {items.map((p) => (
        <li key={p.id} className="flex min-w-0">
          <ProposalLink p={p} />
        </li>
      ))}
    </ul>
  )
}

export function StudioProposalReviewPage({ id }: { id: string }) {
  return (
    <div className="grid gap-5">
      <SessionGate surface="studio" feature="Suggestions from Yard">
        <Review id={id} />
      </SessionGate>
    </div>
  )
}

function useCanDecide() {
  const role = useServerSession((s) => s.brand?.role)
  return { can: !!role && role !== "yard_setup" && canBrand(role, "content.publish"), reason: role && role !== "yard_setup" ? roleCantSentence(role, "content.publish") : "Only the brand's team can answer Yard's suggestions." }
}

function Review({ id }: { id: string }) {
  const brandId = useServerSession((s) => s.brand?.brand.id ?? null)
  const q = useApi(brandId ? `${STUDIO_PROPOSALS_KEY}.one:${brandId}:${id}` : null, () => getStudioProposal(id))
  const revalidate = q.revalidate
  useRealtimeEvent("proposal.updated", (e) => {
    if (e.proposalId === id) void revalidate()
  })
  const { can, reason } = useCanDecide()
  const [busy, setBusy] = useState<null | "accept" | "decline">(null)
  const [declining, setDeclining] = useState(false)
  const [why, setWhy] = useState("")
  const p = q.data?.proposal
  const router = useRouter()
  // An earlier version's link (an older email): the server answers with the version that replaced it.
  const replacedBy = p && p.id !== id ? p.id : null
  useEffect(() => {
    if (replacedBy) router.replace(hrefOf(replacedBy))
  }, [replacedBy, router])

  if (q.error && !p)
    return (
      <>
        <BackLink href={SUGGESTIONS} label="Suggestions" />
        <EmptyState title="This suggestion isn't here" body={errorMessage(q.error)} action={<Button asChild size="sm" variant="secondary"><Link href={SUGGESTIONS}>All suggestions</Link></Button>} />
      </>
    )
  if (!p || replacedBy) return <ListSkeleton rows={5} />

  const accept = async () => {
    setBusy("accept")
    try {
      const r = await acceptStudioProposal(p.id)
      q.mutate(() => ({ proposal: r.proposal }))
      revalidatePrefix(STUDIO_PROPOSALS_KEY)
      revalidatePrefix("studio.catalog")
      toast.success(p.kind === "new" ? (r.published ? "Product added and published" : "Product added as a draft") : "Changes applied", {
        description: p.kind === "new" ? (r.published ? "It's live in your catalogue." : "Publish it once your brand can publish.") : "Only the suggested fields changed.",
      })
    } catch (e) {
      toast.error("This couldn't be accepted", { description: errorMessage(e) })
      void q.revalidate()
    } finally {
      setBusy(null)
    }
  }
  const decline = async () => {
    setBusy("decline")
    try {
      const r = await declineStudioProposal(p.id, why.trim() || undefined)
      q.mutate(() => r)
      revalidatePrefix(STUDIO_PROPOSALS_KEY)
      setDeclining(false)
      toast("Suggestion declined", { description: "Nothing changed. Yard can see your answer." })
    } catch (e) {
      toast.error("This couldn't be declined", { description: errorMessage(e) })
    } finally {
      setBusy(null)
    }
  }

  const pending = p.status === "pending"
  return (
    <>
      <div className="grid gap-2">
        <BackLink href={SUGGESTIONS} label="Suggestions" />
        <PageHeader
          title={p.kind === "new" ? "Yard suggested a new product" : `Yard suggested changes to ${p.title}`}
          description={p.kind === "new" ? "Review it as it would look in your catalogue." : "Only these fields change when you accept. Everything else stays as it is."}
        >
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <ProposalStatusBadge status={p.status} />
            <span className="text-xs text-ink-3">Sent {formatDate(p.createdAt)}</span>
          </div>
        </PageHeader>
      </div>

      {p.note ? (
        <div className={cn(surfaceClass, "p-4")}>
          <p className="text-xs text-ink-3">Note from Yard</p>
          <p className="mt-1 text-sm whitespace-pre-line text-ink">{p.note}</p>
        </div>
      ) : null}

      {p.conflicts.length ? (
        <div role="status" className="flex items-start gap-2 rounded-lg border border-acid/40 bg-acid/[0.05] p-4 text-sm text-ink-2">
          <WarningIcon className="mt-0.5 size-4 shrink-0 text-acid" aria-hidden />
          <span>
            You changed {p.conflicts.length === 1 ? "one of these fields" : `${p.conflicts.length} of these fields`} after Yard sent this. Accepting replaces your value with Yard&apos;s. Check the flagged fields, or edit before accepting.
          </span>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="grid min-w-0 gap-5">
          {p.kind === "edit" ? (
            <section className={cn(surfaceClass, "grid gap-3 p-4")} aria-labelledby="sg-changes">
              <h2 id="sg-changes" className="text-sm text-ink">Changes</h2>
              <ProposalChangeList detail={p} />
            </section>
          ) : null}
          <section className={cn(surfaceClass, "grid gap-3 p-4")} aria-labelledby="sg-look">
            <h2 id="sg-look" className="text-sm text-ink">{p.status === "accepted" ? "As accepted" : p.kind === "new" ? "As it would look" : "After the changes"}</h2>
            <ProposedProduct detail={p} />
          </section>
        </div>

        <aside className={cn(surfaceClass, "grid gap-3 p-4 lg:sticky lg:top-20")} aria-label="Your answer">
          {pending ? (
            declining ? (
              <div className="grid gap-2">
                <label htmlFor="sg-why" className="text-[13px] text-ink">
                  Why not? <span className="text-ink-3">(optional)</span>
                </label>
                <Textarea id="sg-why" value={why} onChange={(e) => setWhy(e.target.value)} maxLength={300} rows={3} placeholder="Yard sees this" />
                <div className="flex flex-wrap justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setDeclining(false)} disabled={busy === "decline"}>
                    Cancel
                  </Button>
                  <Button size="sm" variant="destructive" loading={busy === "decline"} onClick={() => void decline()}>
                    Decline
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <p className="text-sm text-ink-2">{p.kind === "new" ? (p.willPublish ? "Accepting adds it to your catalogue and publishes it." : "Accepting adds it to your catalogue as a draft. Publish it once your brand can publish.") : "Accepting applies only the changes listed here. Everything else stays as it is."}</p>
                <Button variant="primary" disabled={!can || !!busy} loading={busy === "accept"} onClick={() => void accept()}>
                  <CheckIcon /> Accept
                </Button>
                {can ? (
                  <Button asChild variant="secondary" disabled={!!busy}>
                    <Link href={`${hrefOf(p.id)}/edit`}>
                      <PencilSimpleIcon /> Edit before accepting
                    </Link>
                  </Button>
                ) : (
                  <Button variant="secondary" disabled>
                    <PencilSimpleIcon /> Edit before accepting
                  </Button>
                )}
                <Button variant="ghost" disabled={!can || !!busy} onClick={() => setDeclining(true)}>
                  <XIcon /> Decline
                </Button>
                {!can ? <p className="text-xs text-ink-3">{reason}</p> : null}
              </>
            )
          ) : (
            <AnsweredNote p={p} />
          )}
        </aside>
      </div>
    </>
  )
}

function AnsweredNote({ p }: { p: ProposalDetailDto }) {
  if (p.status === "accepted")
    return (
      <div className="grid gap-2">
        <p className="text-sm text-ink">
          You accepted this.{p.productStatus === "published" ? " The product is live." : p.productStatus === "draft" ? " The product is a draft." : p.productStatus === "scheduled" ? " The product is scheduled." : p.productStatus === "archived" ? " The product is archived." : ""}
        </p>
        {p.productId ? (
          <Button asChild size="sm" variant="secondary">
            <Link href={`/studio/products/${encodeURIComponent(p.productId)}`}>Open the product</Link>
          </Button>
        ) : null}
      </div>
    )
  if (p.status === "declined") return <p className="text-sm text-ink-2">You declined this.{p.declineReason ? ` Your reason: “${p.declineReason}”` : ""}</p>
  return <p className="text-sm text-ink-2">Yard withdrew this suggestion. Nothing changed.</p>
}

/** "Edit before accepting": the Studio product form with the suggestion in it. Saving accepts it. */
export function StudioProposalEditPage({ id }: { id: string }) {
  return (
    <SessionGate surface="studio" feature="Suggestions from Yard">
      <EditLoader id={id} />
    </SessionGate>
  )
}

function EditLoader({ id }: { id: string }) {
  const member = useServerSession((s) => s.brand?.brand ?? null)
  const memberId = member?.id ?? null
  const proposalQ = useApi(memberId ? `${STUDIO_PROPOSALS_KEY}.one:${memberId}:${id}` : null, () => getStudioProposal(id), { revalidateOnFocus: false })
  const productsQ = useApi(memberId ? `studio.catalog:${memberId}` : null, loadStudioProductDtos, { keepPrevious: false })
  const collectionsQ = useApi(memberId ? studioCollectionsKey(memberId) : null, loadStudioCollections, { keepPrevious: false })
  const shippingQ = useApi<StudioShippingDto>(memberId ? `${STUDIO_SHIPPING_KEY}:${memberId}` : null, () => getStudioShipping(), { revalidateOnFocus: false })
  const base = brandById.get(STUDIO_BRAND_ID)!
  const brand = useMemo(() => (member ? liveBrand(base, member, shippingQ.data) : null), [base, member, shippingQ.data])
  const failure = proposalQ.error ?? productsQ.error ?? collectionsQ.error
  if (failure && !proposalQ.data) return <EmptyState title="This suggestion couldn't load" body={errorMessage(failure)} />
  if (!proposalQ.data || !productsQ.data || !collectionsQ.data || shippingQ.isLoading || !brand) return <ProductEditorSkeleton />
  const p = proposalQ.data.proposal
  if (p.id !== id) return <ReplacedRedirect to={`${hrefOf(p.id)}/edit`} />
  if (p.status !== "pending") return <EmptyState title="This suggestion was already answered" action={<Button asChild size="sm" variant="secondary"><Link href={hrefOf(id)}>Open it</Link></Button>} />
  return <ProposalEditor p={p} brand={brand} products={productsQ.data} collections={collectionsQ.data} memberId={member!.id} />
}

function ReplacedRedirect({ to }: { to: string }) {
  const router = useRouter()
  useEffect(() => {
    router.replace(to)
  }, [router, to])
  return <ProductEditorSkeleton />
}

function ProposalEditor({ p, brand, products, collections, memberId }: { p: ProposalDetailDto; brand: ReturnType<typeof liveBrand>; products: Awaited<ReturnType<typeof loadStudioProductDtos>>; collections: Awaited<ReturnType<typeof loadStudioCollections>>; memberId: string }) {
  const router = useRouter()
  const all = products.map(fromStudioProduct)
  const current = p.productId && p.kind === "edit" ? all.find((x) => x.id === p.productId) : undefined
  const product = current ? productFromView(p.proposed, p, { asNew: false, base: current }) : undefined
  const prefill = p.kind === "new" ? productFromView(p.proposed, p, { asNew: true }) : undefined
  const dto = current ? products.find((x) => x.id === current.id) : undefined
  const submit = async (body: ProposalSubmitBody) => {
    const r = await acceptStudioProposal(p.id, body)
    revalidatePrefix(STUDIO_PROPOSALS_KEY)
    revalidatePrefix("studio.catalog")
    toast.success(p.kind === "new" ? (r.published ? "Product added and published" : "Product added as a draft") : "Changes applied", { description: "You accepted Yard's suggestion with your edits." })
    router.replace(hrefOf(p.id))
  }
  const server: ServerEditor = {
    dto,
    allProducts: all,
    collections: collections.map((c) => fromStudioCollection(c, memberId)),
    onSaved: () => {},
    reload: () => {},
    upload: async (file) => {
      const media = await apiUpload(file, { purpose: "social_post", as: "brand" }).promise
      return { src: media.src, width: media.width ?? 1200, height: media.height ?? 1500, mediaId: media.id }
    },
    proposal: {
      title: p.kind === "new" ? "Edit before accepting" : `Edit changes to ${p.title}`,
      description: "This is Yard's suggestion. Change anything, then save to accept it.",
      backHref: hrefOf(p.id),
      backLabel: "Suggestion",
      saveLabel: "Save and accept",
      publishNote: p.kind === "new" ? (p.willPublish ? "Saving adds it to your catalogue and publishes it." : "Saving adds it to your catalogue as a draft. Publish it once your brand can publish.") : "Saving applies your version. It keeps the product's current status.",
      stockDelta: p.stockDelta,
      prefill,
      submit,
    },
  }
  return <ProductEditor key={p.id} product={product} brand={brand} server={server} />
}
