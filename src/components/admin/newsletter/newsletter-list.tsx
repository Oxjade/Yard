"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { EnvelopeSimpleOpenIcon, PaperPlaneTiltIcon, PencilSimpleIcon, PlusIcon, StopCircleIcon, XCircleIcon } from "@phosphor-icons/react"
import { EmptyState } from "@/components/dashboard/empty-state"
import { MetricTile } from "@/components/dashboard/metric-tile"
import { ListSkeleton } from "@/components/feedback/skeletons"
import { AdminPageHead } from "@/components/admin/marketplace/page-head"
import { ActionBar, DetailSection, DetailSheet, Facts } from "@/components/admin/marketplace/detail-sheet"
import { useLast } from "@/components/admin/marketplace/use-last"
import { useSearchParam, writeParams } from "@/components/admin/marketplace/url-state"
import { Segmented } from "@/components/admin/ui/segmented"
import { LoadError, ServerActivity, TrustGate, useAdminSession } from "@/components/admin/trust/shared"
import { Button } from "@/components/ui/button"
import type { NewsletterDetailDto, NewsletterSummaryDto } from "@/lib/api/contracts/newsletter"
import { errorMessage } from "@/lib/api/errors"
import { cancelNewsletter, createNewsletter, getNewsletter, listNewsletters, newsletterKeys, newsletterRecipients } from "@/lib/api/newsletter"
import { revalidatePrefix, useApi } from "@/lib/api/use-api"
import { newsletterKindMeta, newsletterRecipientStatusLabels, type NewsletterStatus } from "@/lib/newsletter"
import { cn } from "@/lib/utils"
import { CampaignStatus, campaignWhen, composeHref, KindChip, localTime, people, statsLine } from "./parts"

/*
 * Admin › Newsletter (comms.newsletter): every campaign by status, with its numbers. A draft opens
 * the composer; anything that went out (or is about to) opens the detail panel: counts, per-recipient
 * status, the activity log, and Cancel schedule / Stop sending.
 */

type Filter = NewsletterStatus | "all"
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "draft", label: "Drafts" },
  { value: "scheduled", label: "Scheduled" },
  { value: "sending", label: "Sending" },
  { value: "sent", label: "Sent" },
]
const isFilter = (v: string | null): v is Filter => FILTERS.some((f) => f.value === v) || v === "cancelled"

export function NewsletterListView() {
  const { can } = useAdminSession()
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const create = async () => {
    setCreating(true)
    try {
      const r = await createNewsletter()
      revalidatePrefix(newsletterKeys.list)
      router.push(composeHref(r.campaign.id))
    } catch (e) {
      toast.error(errorMessage(e, "The draft couldn't be created. Try again."))
      setCreating(false)
    }
  }
  return (
    <div className="@container grid gap-3">
      <AdminPageHead
        live
        title="Newsletter"
        description="Write to shoppers and brands in Yard's voice. You write the words, the email looks like Yard. Marketing only reaches people who said yes."
        actions={
          can("comms.newsletter") ? (
            <Button size="sm" variant="primary" className="h-10 sm:h-9" loading={creating} onClick={() => void create()}>
              <PlusIcon /> New campaign
            </Button>
          ) : undefined
        }
      />
      <TrustGate feature="Newsletter" anyOf={["comms.newsletter"]}>
        <Workspace onCreate={() => void create()} creating={creating} />
      </TrustGate>
    </div>
  )
}

function Workspace({ onCreate, creating }: { onCreate: () => void; creating: boolean }) {
  const router = useRouter()
  const statusParam = useSearchParam("status")
  const status: Filter = isFilter(statusParam) ? statusParam : "all"
  const open = useSearchParam("campaign")
  const list = useApi(newsletterKeys.list, () => listNewsletters(), { refreshInterval: 5000 })
  const all = list.data?.items ?? []
  const items = status === "all" ? all : all.filter((c) => c.status === status)
  const counts = list.data?.counts

  return (
    <>
      <div className="grid gap-3 rounded-[20px] border border-[var(--admin-hairline)] p-3 sm:p-4 md:p-5">
        <div className="rail overflow-x-auto">
          <Segmented
            label="Campaign status"
            size="sm"
            value={status === "cancelled" ? "all" : status}
            onChange={(v) => writeParams({ status: v === "all" ? null : v, campaign: null })}
            loading={!counts}
            options={FILTERS.map((f) => ({ ...f, count: f.value === "all" ? undefined : counts?.[f.value as NewsletterStatus], countTone: f.value === "sending" || f.value === "scheduled" ? ("attention" as const) : ("neutral" as const) }))}
          />
        </div>
        {list.isLoading && !list.data ? (
          <ListSkeleton rows={5} />
        ) : list.error && !list.data ? (
          <LoadError error={list.error} onRetry={() => void list.revalidate()} what="campaigns" />
        ) : !items.length ? (
          <EmptyState
            icon={EnvelopeSimpleOpenIcon}
            title={status === "all" ? "No campaigns yet" : `No ${FILTERS.find((f) => f.value === status)?.label.toLowerCase() ?? "campaigns"}`}
            body={status === "all" ? "Start one: pick who it's for, write the words and send yourself a test first." : "Campaigns show up here as they move along."}
            action={
              status === "all" ? (
                <Button size="sm" variant="secondary" loading={creating} onClick={onCreate}>
                  <PlusIcon /> New campaign
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,170px)_120px_minmax(0,220px)] gap-3 px-2.5 pb-1 text-[11px] tracking-[0.08em] text-ink-3 uppercase @3xl:grid" aria-hidden>
              <span>Campaign</span>
              <span>Audience</span>
              <span>Status</span>
              <span>Results</span>
            </div>
            <ul className="grid gap-0.5" aria-label="Campaigns">
              {items.map((c) => (
                <li key={c.id}>
                  <Row c={c} selected={c.id === open} onOpen={() => (c.status === "draft" ? router.push(composeHref(c.id)) : writeParams({ campaign: c.id }))} />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <CampaignDetail id={open} onChanged={() => void list.revalidate()} />
    </>
  )
}

function Row({ c, selected, onOpen }: { c: NewsletterSummaryDto; selected: boolean; onOpen: () => void }) {
  const when = campaignWhen(c)
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-lg px-2.5 py-2.5 text-left transition-colors focus-visible:bg-white/[0.05] focus-visible:outline-none @3xl:grid-cols-[minmax(0,1fr)_minmax(0,170px)_120px_minmax(0,220px)]",
        selected ? "bg-purple/15" : "hover:bg-white/[0.04]",
      )}
    >
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm text-ink">{c.name || c.subject || "Untitled campaign"}</span>
          <KindChip kind={c.kind} />
        </span>
        <span className="mt-0.5 block truncate text-[12px] text-ink-3">
          {c.name && c.subject ? `${c.subject} · ` : ""}
          {when.label} <time dateTime={when.at}>{localTime(when.at)}</time>
        </span>
      </span>
      <span className="row-start-2 min-w-0 truncate text-[12px] text-ink-2 @3xl:row-start-auto">{c.audience.label}</span>
      <span className="col-start-2 row-start-1 justify-self-end @3xl:col-start-auto @3xl:row-start-auto @3xl:justify-self-start">
        <CampaignStatus status={c.status} />
      </span>
      <span className="col-span-2 min-w-0 text-[12px] text-ink-3 tabular @3xl:col-span-1">{statsLine(c)}</span>
    </button>
  )
}

function CampaignDetail({ id, onChanged }: { id: string | null; onChanged: () => void }) {
  const router = useRouter()
  const q = useApi(id ? newsletterKeys.one(id) : null, () => getNewsletter(id!), { keepPrevious: false, refreshInterval: 3000 })
  const current = q.data?.campaign && q.data.campaign.id === id ? q.data.campaign : null
  const c = useLast(current)
  const { can } = useAdminSession()
  const [busy, setBusy] = useState(false)
  const close = () => writeParams({ campaign: null })

  const cancel = async () => {
    if (!c) return
    setBusy(true)
    try {
      const r = await cancelNewsletter(c.id)
      q.mutate(() => r)
      onChanged()
      toast(c.status === "scheduled" ? "Schedule cancelled" : "Sending stopped", { description: c.status === "scheduled" ? "It's a draft again. Nothing went out." : "Nobody else gets it. Emails already sent stay sent." })
      if (c.status === "scheduled") router.push(composeHref(c.id))
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <DetailSheet
      open={!!id}
      onOpenChange={(o) => !o && close()}
      title={c ? c.name || c.subject || "Untitled campaign" : q.error ? "Campaign" : "Loading…"}
      description={c ? `${newsletterKindMeta[c.kind].label} to ${c.audience.label.toLowerCase()}` : undefined}
      badges={c ? <CampaignStatus status={c.status} /> : null}
      actions={
        c && can("comms.newsletter") ? (
          c.status === "scheduled" ? (
            <ActionBar
              note={c.scheduledFor ? `Goes out ${localTime(c.scheduledFor)}. Cancelling makes it a draft again, so you can edit it.` : undefined}
              actions={[{ key: "cancel", label: busy ? "Cancelling…" : "Cancel schedule", icon: XCircleIcon, variant: "destructive", onSelect: () => void cancel() }]}
            />
          ) : c.status === "sending" ? (
            <ActionBar note="Stopping keeps everyone who hasn't been handed over yet from getting it." actions={[{ key: "stop", label: busy ? "Stopping…" : "Stop sending", icon: StopCircleIcon, variant: "destructive", onSelect: () => void cancel() }]} />
          ) : c.status === "draft" ? (
            <ActionBar actions={[{ key: "edit", label: "Open the composer", icon: PencilSimpleIcon, variant: "secondary", onSelect: () => router.push(composeHref(c.id)) }]} />
          ) : null
        ) : null
      }
    >
      {q.error && !c ? <LoadError error={q.error} onRetry={() => void q.revalidate()} what="this campaign" /> : !c || (id && !current && q.isLoading) ? <ListSkeleton rows={4} /> : <DetailBody c={c} />}
    </DetailSheet>
  )
}

function DetailBody({ c }: { c: NewsletterDetailDto }) {
  const n = c.counts
  const handed = n.total - n.pending - n.cancelled
  const skipped = n.suppressed + n.cancelled
  return (
    <>
      {c.status === "sending" || c.status === "sent" || c.status === "cancelled" ? (
        <div className="grid grid-cols-2 gap-2">
          <MetricTile density="dense" label="Sent" value={n.sent} format={(x) => x.toLocaleString("en-US")} hint={n.stub ? `${n.stub.toLocaleString("en-US")} more not sent: no email provider is set up` : `of ${people(n.total)}`} highlight />
          <MetricTile density="dense" label="Unsubscribed" value={n.unsubscribed} format={(x) => x.toLocaleString("en-US")} hint="From this email's link" />
          <MetricTile density="dense" label="Failed" value={n.failed} format={(x) => x.toLocaleString("en-US")} hint="Bounced or refused by the provider" />
          <MetricTile density="dense" label="Skipped" value={skipped} format={(x) => x.toLocaleString("en-US")} hint={n.cancelled ? "Stopped before their turn, or unsubscribed since" : "Unsubscribed or bounced since it was queued"} />
        </div>
      ) : null}
      {c.status === "sending" ? (
        <div className="grid gap-1.5" role="status">
          <div className="flex items-center justify-between text-[12px] text-ink-2">
            <span>Handing over to the outbox</span>
            <span className="tabular">
              {handed.toLocaleString("en-US")} / {n.total.toLocaleString("en-US")}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
            <div className="h-full rounded-full bg-violet transition-[width] duration-500" style={{ width: `${n.total ? Math.round((handed / n.total) * 100) : 0}%` }} />
          </div>
          <p className="text-[11.5px] text-ink-3">A batch goes out every minute, so big audiences take a little while. Nobody gets it twice.</p>
        </div>
      ) : null}
      <Facts
        items={[
          { label: "Subject", value: c.subject || "—" },
          { label: "Type", value: newsletterKindMeta[c.kind].label },
          { label: "Audience", value: c.audience.label },
          ...(c.scheduledFor ? [{ label: c.status === "scheduled" ? "Goes out" : "Scheduled for", value: localTime(c.scheduledFor) }] : []),
          ...(c.startedAt ? [{ label: "Started", value: localTime(c.startedAt) }] : []),
          ...(c.finishedAt ? [{ label: c.status === "cancelled" ? "Stopped" : "Finished", value: localTime(c.finishedAt) }] : []),
          ...(c.sentBy ? [{ label: "Sent by", value: c.sentBy }] : []),
          ...(c.status !== "draft" && c.status !== "scheduled" ? [{ label: "Emails in the outbox", value: `${c.outboxRows.toLocaleString("en-US")} (one per person)` }] : []),
        ]}
      />
      {c.status !== "draft" && c.status !== "scheduled" ? <Recipients id={c.id} /> : null}
      <DetailSection title="Activity">
        <ServerActivity subjectIds={[c.id]} empty="No activity recorded yet." />
      </DetailSection>
    </>
  )
}

const RECIPIENT_FILTERS = [
  { value: "all", label: "Everyone" },
  { value: "sent", label: "Sent" },
  { value: "failed", label: "Failed" },
  { value: "unsubscribed", label: "Unsubscribed" },
  { value: "suppressed", label: "Skipped" },
] as const
type RecipientFilter = (typeof RECIPIENT_FILTERS)[number]["value"]

function Recipients({ id }: { id: string }) {
  const [filter, setFilter] = useState<RecipientFilter>("all")
  const [offset, setOffset] = useState(0)
  const q = useApi(`admin.newsletters.recipients:${id}:${filter}:${offset}`, () => newsletterRecipients(id, filter, offset), { refreshInterval: 5000 })
  const items = q.data?.items ?? []
  return (
    <DetailSection title="Recipients" className="min-w-0 grid-cols-[minmax(0,1fr)]">
      <div className="rail overflow-x-auto">
        <Segmented
          label="Recipient status"
          size="sm"
          value={filter}
          onChange={(v) => {
            setFilter(v)
            setOffset(0)
          }}
          options={RECIPIENT_FILTERS.map((f) => ({ ...f }))}
        />
      </div>
      {q.isLoading && !q.data ? (
        <ListSkeleton rows={3} />
      ) : q.error && !q.data ? (
        <LoadError error={q.error} onRetry={() => void q.revalidate()} what="recipients" />
      ) : !items.length ? (
        <p className="rounded-[10px] border border-dashed border-white/10 px-3 py-2.5 text-[12px] text-ink-3">Nobody here.</p>
      ) : (
        <ul className="divide-y divide-white/[0.07] rounded-[12px] border border-white/[0.07]">
          {items.map((r) => (
            <li key={r.userId} className="flex min-w-0 items-start gap-2.5 px-3 py-2.5">
              <PaperPlaneTiltIcon className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-ink">{r.name || r.email}</span>
                <span className="block truncate text-[11.5px] text-ink-3">{r.email}</span>
              </span>
              <span className="shrink-0 text-right text-[11.5px] text-ink-2">
                {newsletterRecipientStatusLabels[r.status]}
                {r.unsubscribed ? <span className="block text-ink-3">Unsubscribed</span> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      {q.data && (offset > 0 || q.data.nextOffset != null) ? (
        <div className="flex justify-between gap-2">
          <Button size="sm" variant="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>
            Previous
          </Button>
          <Button size="sm" variant="ghost" disabled={q.data.nextOffset == null} onClick={() => setOffset(q.data!.nextOffset ?? offset)}>
            Next 50
          </Button>
        </div>
      ) : null}
    </DetailSection>
  )
}
