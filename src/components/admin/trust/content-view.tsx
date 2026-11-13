"use client"

import { useId, useMemo } from "react"
import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  CheckIcon,
  EyeIcon,
  EyeSlashIcon,
  FlagIcon,
  ImagesSquareIcon,
  LinkBreakIcon,
  MapPinAreaIcon,
  PauseIcon,
  PlayIcon,
  PlugsConnectedIcon,
  TrashIcon,
  XCircleIcon,
} from "@phosphor-icons/react"
import { DataTable, type Column, type RowAction } from "@/components/dashboard/data-table"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { StatCard } from "@/components/dashboard/insight/stat-card"
import { Reveal, RevealItem } from "@/components/admin/ui/motion"
import { Panel } from "@/components/admin/ui/panel"
import { Segmented, segmentedTabId } from "@/components/admin/ui/segmented"
import { DetailSection, DetailSheet, EmptyLine, Facts, insetClass } from "@/components/admin/marketplace/detail-sheet"
import { formatDate, formatDateTime, relDays } from "@/components/admin/marketplace/format"
import { AdminPageHead, PanelRail, StatRow } from "@/components/admin/marketplace/page-head"
import { InPageLinks, useSearchParam, writeParams } from "@/components/admin/marketplace/url-state"
import { useLast } from "@/components/admin/marketplace/use-last"
import { useNow } from "@/hooks/use-now"
import { adminKeys, listContent } from "@/lib/api/admin"
import { CONTENT_TABS, type ContentListDto, type ContentPostDto, type ContentTab, type IntegrationDto, type PlaceDto, type PlaceEventDto, type ReportRef } from "@/lib/api/contracts/admin"
import { useApi } from "@/lib/api/use-api"
import { formatNumber } from "@/lib/money"
import type { AdminPermission } from "@/lib/permissions"
import { cn } from "@/lib/utils"
import { useAdminSampleData } from "../sample"
import { AdminImg, LoadError, SampleTag, ServerActivity, TrustActionBar, TrustGate, useAdminSession, useServerDecision, type TrustAction, RelatedLinks, sheetTrack, useQueueFigures, useQueueLive } from "./shared"

/*
 * Admin › Content (§8.1): posts and uploads, places with their events as child rows, and social
 * integrations. Each tab checks its own permission; a removal locks the item for the brand.
 */

const TABS: Record<ContentTab, { label: string; permission: AdminPermission; empty: string; emptyBody: string }> = {
  posts: { label: "Posts", permission: "content.moderate", empty: "No posts on Yard yet", emptyBody: "Posts that brands show on their storefronts appear here, reported ones first." },
  uploads: { label: "Uploads", permission: "content.moderate", empty: "No uploads yet", emptyBody: "Posts brands upload straight to Yard appear here, reported ones first." },
  places: { label: "Places", permission: "places.moderate", empty: "No places published", emptyBody: "Stores, showrooms, pop-ups and exhibitions brands publish on Yard Around appear here." },
  integrations: { label: "Integrations", permission: "social.manage", empty: "No social accounts connected", emptyBody: "Instagram and TikTok accounts brands connect appear here with their sync status." },
}
const isTab = (v: string | null): v is ContentTab => !!v && (CONTENT_TABS as readonly string[]).includes(v)
const n = (v: number) => formatNumber(Math.round(v))
const sourceLabel: Record<string, string> = { instagram: "Instagram", tiktok: "TikTok", sandbox: "Sandbox", sample: "Sample", upload: "Upload" }
const kindLabel: Record<string, string> = { store: "Store", showroom: "Showroom", popup: "Pop-up", exhibition: "Exhibition", drop_launch: "Drop launch", promotion: "Promotion", talk: "Talk", sale: "Sale", popup_day: "Pop-up day" }

type Tone = "attention" | "info" | "muted" | "danger" | "success" | "neutral"
function postStatus(p: ContentPostDto): { label: string; tone: Tone } {
  if (p.moderationStatus === "removed") return { label: "Removed by Yard", tone: "danger" }
  if (p.moderationStatus === "flagged") return { label: "Hidden by Yard", tone: "attention" }
  return p.visibility === "published" ? { label: "Published", tone: "success" } : { label: p.visibility === "hidden" ? "Hidden by brand" : "Draft", tone: "muted" }
}
const modStatus: Record<string, { label: string; tone: Tone }> = {
  approved: { label: "Approved", tone: "success" },
  pending_review: { label: "Pending review", tone: "attention" },
  rejected: { label: "Rejected", tone: "muted" },
  removed: { label: "Removed by Yard", tone: "danger" },
}

/** When a place was reviewed, saying plainly when no review is on record (approved sample places). */
function reviewedWords(p: PlaceDto, now: number | null) {
  if (p.reviewedAt) return relDays(p.reviewedAt, now)
  if (p.moderationStatus === "approved") return p.sample ? "Approved (sample, no review on record)" : "Approved, no review on record"
  if (p.moderationStatus === "pending_review") return "Not yet"
  return "No review on record"
}

export function ContentView() {
  const sampleOn = useAdminSampleData().on
  return (
    <Reveal ssrVisible className="@container grid gap-3">
      <AdminPageHead
        title="Content"
        description="Brand posts and uploads, places and events on Yard Around, and the social accounts behind them."
        live={!sampleOn}
        note={sampleOn ? "Posts and places with the Sample tag are seeded sample data. Removing something locks it: the brand can delete it but can't show it again." : "Removing something locks it: the brand can delete it but can't show it again."}
      />
      <TrustGate feature="Content" anyOf={["content.moderate", "places.moderate", "social.manage"]}>
        <ContentQueues />
      </TrustGate>
    </Reveal>
  )
}

function ContentQueues() {
  const sampleOn = useAdminSampleData().on
  const qid = useId()
  const { can, reason } = useAdminSession()
  const linked = useSearchParam("tab")
  const firstAllowed = CONTENT_TABS.find((t) => can(TABS[t].permission)) ?? "posts"
  const tab: ContentTab = isTab(linked) ? linked : firstAllowed
  const allowed = can(TABS[tab].permission)
  // Report notifications link to ?report=<id> (F2): it opens the post or place that report is about.
  const reportLink = useSearchParam("report")
  const caseParam = useSearchParam("case")
  const q = useApi(allowed ? adminKeys.content(tab) : null, () => listContent(tab), { refreshInterval: 30_000 })
  useQueueLive(() => void q.revalidate())
  const { ask, dialog } = useServerDecision(() => document.getElementById(segmentedTabId(qid, tab)))
  // Counts come with each tab's response: the last ones stay while another tab loads.
  const figures = useQueueFigures(q.data?.counts, q.error)
  const counts = figures.counts
  const ready = figures.ready
  const caseId =
    caseParam ??
    (reportLink && q.data
      ? q.data.tab === "places"
        ? (q.data.places.find((p) => p.report?.id === reportLink || p.events.some((e) => e.report?.id === reportLink))?.id ?? null)
        : q.data.tab === "posts" || q.data.tab === "uploads"
          ? (q.data.posts.find((p) => p.report?.id === reportLink)?.id ?? null)
          : null
      : null)

  return (
    <div className="grid gap-3">
      <InPageLinks>
        <StatRow label="Content figures">
          <RevealItem className="min-w-0">
            <StatCard surface="admin" variant={ready && counts?.posts ? "brand" : "default"} icon={FlagIcon} label="Reported posts" value={counts?.posts ?? 0} format={figures.format(n)} hint={figures.hint(sampleOn ? "Imported and sample" : "Imported and uploaded")} href="/admin/content?tab=posts#content-queue" hrefLabel="Show posts" ready={ready} className="h-full" />
          </RevealItem>
          <RevealItem className="min-w-0">
            <StatCard surface="admin" variant={ready && counts?.uploads ? "brand" : "default"} icon={ImagesSquareIcon} label="Reported uploads" value={counts?.uploads ?? 0} format={figures.format(n)} hint={figures.hint("Uploaded to Yard")} href="/admin/content?tab=uploads#content-queue" hrefLabel="Show uploads" ready={ready} className="h-full" />
          </RevealItem>
          <RevealItem className="min-w-0">
            <StatCard surface="admin" variant={ready && counts?.places ? "brand" : "default"} icon={MapPinAreaIcon} label="Places to review" value={counts?.places ?? 0} format={figures.format(n)} hint={figures.hint("Pending or reported")} href="/admin/content?tab=places#content-queue" hrefLabel="Show places" ready={ready} className="h-full" />
          </RevealItem>
          <RevealItem className="min-w-0">
            <StatCard surface="admin" icon={PlugsConnectedIcon} label="Integrations failing" value={counts?.integrations ?? 0} format={figures.format(n)} hint={figures.hint("Errors or reconnects")} href="/admin/content?tab=integrations#content-queue" hrefLabel="Show integrations" ready={ready} className="h-full" />
          </RevealItem>
        </StatRow>
      </InPageLinks>

      <Panel id="content-queue" title="Content queue" description="Open an item for its media, the report and its history. Every decision asks for a reason." className="scroll-mt-24 rounded-[20px]" bodyClassName="px-0 pb-0 md:px-0 md:pb-0">
        <PanelRail value={tab}>
          <Segmented
            label="Content queue"
            size="sm"
            value={tab}
            onChange={(t) => writeParams({ tab: t, case: null })}
            loading={allowed && !counts}
            idBase={qid}
            panelId={`${qid}-panel`}
            options={CONTENT_TABS.map((t) => ({ value: t, label: TABS[t].label, count: counts?.[t] }))}
          />
        </PanelRail>
        <div id={`${qid}-panel`} role="tabpanel" aria-labelledby={segmentedTabId(qid, tab)} className="border-t border-[var(--admin-hairline)] p-3 sm:p-4 md:p-5">
          {!allowed ? (
            <EmptyLine>{reason(TABS[tab].permission)?.replace(/\.$/, "")} to open {TABS[tab].label.toLowerCase()}.</EmptyLine>
          ) : q.error && !q.data ? (
            <LoadError error={q.error} onRetry={() => void q.revalidate()} what={TABS[tab].label.toLowerCase()} />
          ) : tab === "places" ? (
            <PlacesTable data={q.data?.tab === "places" ? q.data.places : undefined} ask={ask} caseId={caseId} />
          ) : tab === "integrations" ? (
            <Integrations data={q.data?.tab === "integrations" ? q.data : undefined} ask={ask} />
          ) : (
            <PostsTable tab={tab} data={q.data && (q.data.tab === "posts" || q.data.tab === "uploads") && q.data.tab === tab ? q.data.posts : undefined} ask={ask} caseId={caseId} />
          )}
        </div>
      </Panel>
      {dialog}
    </div>
  )
}

type Ask = ReturnType<typeof useServerDecision>["ask"]

/* ── Posts and uploads ─────────────────────────────────────────────── */

function postDecisions(ask: Ask) {
  const name = (p: ContentPostDto) => `${p.brand.name}'s ${p.source === "upload" ? "upload" : "post"}`
  return {
    hide: (p: ContentPostDto) =>
      ask({
        action: "set-post-moderation",
        body: { id: p.id, action: "hide", ...(p.report ? { reportId: p.report.id } : {}) },
        title: `Hide ${name(p)}?`,
        description: `It leaves the storefront feed at once and stays hidden until Yard restores it. Its reports are closed as acted on. ${p.brand.name} is notified in Studio and sees your reason.`,
        fieldLabel: `Reason, shown to ${p.brand.name}`,
        confirmLabel: "Hide post",
        destructive: true,
        done: "Post hidden",
      }),
    remove: (p: ContentPostDto) =>
      ask({
        action: "set-post-moderation",
        body: { id: p.id, action: "remove", ...(p.report ? { reportId: p.report.id } : {}) },
        title: `Remove ${name(p)}?`,
        description: `Its files stop loading everywhere and the post is locked: ${p.brand.name} can delete it but can't show it again. Its reports are closed as acted on. ${p.brand.name} is notified in Studio and sees your reason.`,
        fieldLabel: `Reason, shown to ${p.brand.name}`,
        confirmLabel: "Remove post",
        destructive: true,
        presets: ["Misleading claim", "Counterfeit product", "Uses someone else's work"],
        done: "Post removed",
      }),
    restore: (p: ContentPostDto) =>
      ask({
        action: "set-post-moderation",
        body: { id: p.id, action: "restore" },
        title: `Restore ${name(p)}?`,
        description: `It can show on the storefront again if ${p.brand.name} keeps it published. Your reason stays in the audit log.`,
        fieldLabel: "Reason, for the audit log",
        confirmLabel: "Restore post",
        done: "Post restored",
      }),
    dismiss: (p: ContentPostDto) => dismissReport(ask, p.report!, `${name(p)}`),
  }
}

function dismissReport(ask: Ask, report: ReportRef, what: string) {
  return ask({
    action: "decide-report",
    body: { id: report.id, outcome: "dismiss" },
    title: `Dismiss the report on ${what}?`,
    description: `Closes the report with no action. ${report.reporter.name} is told it was reviewed; your reason stays in the audit log.`,
    fieldLabel: "Reason, for the audit log",
    confirmLabel: "Dismiss report",
    done: "Report dismissed",
  })
}

function PostsTable({ tab, data, ask, caseId }: { tab: "posts" | "uploads"; data?: ContentPostDto[]; ask: Ask; caseId: string | null }) {
  const now = useNow(60_000)
  const { reason } = useAdminSession()
  const d = postDecisions(ask)
  const r = reason("content.moderate")
  const open = (p: ContentPostDto) => writeParams({ case: p.id })
  const columns: Column<ContentPostDto>[] = [
    {
      key: "post",
      header: tab === "uploads" ? "Upload" : "Post",
      cell: (p) => (
        <button type="button" onClick={() => open(p)} className="group flex min-h-10 max-w-full min-w-0 items-center gap-2.5 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-violet">
          <AdminImg src={p.media[0]?.poster ?? p.media[0]?.src} alt="" className="h-10 w-8 shrink-0 rounded-md border border-white/8" />
          <span className="min-w-0">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="block max-w-[40vw] truncate font-medium text-ink group-hover:text-violet sm:max-w-[240px]">{p.brand.name}</span>
              {p.sample ? <SampleTag /> : null}
            </span>
            <span className="block max-w-[40vw] truncate text-[11.5px] text-ink-3 sm:max-w-[240px]">
              <span className="sm:hidden">{p.report ? `Reported: ${p.report.reasonLabel.toLowerCase()}` : postStatus(p).label}</span>
              <span className="hidden sm:inline">{p.caption || "No caption"}</span>
            </span>
          </span>
        </button>
      ),
    },
    { key: "source", header: "Source", hideBelow: "md", cell: (p) => <span className="whitespace-nowrap text-ink-2">{sourceLabel[p.source] ?? p.source}</span> },
    { key: "reason", header: "Reason", hideBelow: "sm", cell: (p) => (p.report ? <StatusBadge tone="attention">{p.report.reasonLabel}</StatusBadge> : <span className="text-ink-3">No reports</span>) },
    { key: "status", header: "Status", hideBelow: "md", cell: (p) => <StatusBadge tone={postStatus(p).tone}>{postStatus(p).label}</StatusBadge> },
    { key: "posted", header: "Posted", hideBelow: "lg", cell: (p) => <time dateTime={p.postedAt} title={formatDateTime(p.postedAt)} className="whitespace-nowrap text-ink-2">{relDays(p.postedAt, now)}</time> },
  ]
  const rowActions: RowAction<ContentPostDto>[] = [
    { label: "Open", icon: EyeIcon, onSelect: open },
    { label: "Hide", icon: EyeSlashIcon, separatorBefore: true, hidden: (p) => p.moderationStatus !== "ok", disabled: () => !!r, disabledReason: () => r, onSelect: (p) => void d.hide(p) },
    { label: "Remove", icon: TrashIcon, destructive: true, hidden: (p) => p.moderationStatus === "removed", disabled: () => !!r, disabledReason: () => r, onSelect: (p) => void d.remove(p) },
    { label: "Restore", icon: ArrowCounterClockwiseIcon, hidden: (p) => p.moderationStatus === "ok", disabled: () => !!r, disabledReason: () => r, onSelect: (p) => void d.restore(p) },
    { label: "Dismiss report", icon: XCircleIcon, hidden: (p) => !p.report, disabled: () => !!r, disabledReason: () => r, onSelect: (p) => void d.dismiss(p) },
  ]
  const shown = data?.find((p) => p.id === caseId)
  return (
    <>
      <DataTable
        key={tab}
        label={TABS[tab].label}
        rows={data ?? []}
        columns={columns}
        getId={(p) => p.id}
        loading={!data}
        search={{ placeholder: "Search brand, caption or reason", text: (p) => [p.brand.name, p.caption, p.report?.reasonLabel ?? ""].join(" ") }}
        rowActions={rowActions}
        empty={{ title: TABS[tab].empty, body: TABS[tab].emptyBody }}
        minWidth={300}
      />
      <PostSheet post={shown} open={!!shown} decisions={d} reason={r} onOpenChange={(o) => !o && writeParams({ case: null, report: null })} />
    </>
  )
}

function PostSheet({ post, open, decisions, reason, onOpenChange }: { post?: ContentPostDto; open: boolean; decisions: ReturnType<typeof postDecisions>; reason?: string; onOpenChange: (o: boolean) => void }) {
  const now = useNow(60_000)
  const last = useLast(post)
  const p = post ?? last
  if (!p) return null
  const st = postStatus(p)
  const actions: TrustAction[] = []
  if (p.report) actions.push({ key: "dismiss", label: "Dismiss report", icon: XCircleIcon, variant: "secondary", onSelect: () => void decisions.dismiss(p), disabledReason: reason })
  if (p.moderationStatus === "ok") actions.push({ key: "hide", label: "Hide", icon: EyeSlashIcon, variant: "secondary", onSelect: () => void decisions.hide(p), disabledReason: reason })
  if (p.moderationStatus !== "removed") actions.push({ key: "remove", label: "Remove", icon: TrashIcon, variant: "destructive", onSelect: () => void decisions.remove(p), disabledReason: reason })
  if (p.moderationStatus !== "ok") actions.push({ key: "restore", label: "Restore", icon: ArrowCounterClockwiseIcon, variant: "secondary", onSelect: () => void decisions.restore(p), disabledReason: reason })
  return (
    <DetailSheet
      open={open}
      onOpenChange={onOpenChange}
      title={`${p.brand.name}, ${sourceLabel[p.source]?.toLowerCase() ?? p.source} post`}
      description={formatDate(p.postedAt)}
      badges={
        <>
          {p.report ? <StatusBadge tone="attention">{p.report.reasonLabel}</StatusBadge> : null}
          <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
          {p.sample ? <StatusBadge tone="muted">Sample</StatusBadge> : null}
        </>
      }
      actions={<TrustActionBar note="Every decision needs a reason and is recorded in the audit log." actions={actions} />}
    >
      <div className="grid grid-cols-3 gap-2">
        {p.media.slice(0, 6).map((m, i) => (
          <AdminImg key={i} src={m.kind === "video" ? (m.poster ?? null) : m.src} alt={m.alt} className="aspect-[4/5] w-full rounded-[10px] border border-white/[0.07]" />
        ))}
        {!p.media.length ? <EmptyLine>No media on this post.</EmptyLine> : null}
      </div>
      <Facts
        items={[
          { label: "Brand", value: p.brand.name },
          { label: "Source", value: sourceLabel[p.source] ?? p.source },
          { label: "Posted", value: relDays(p.postedAt, now) },
          { label: "Kind", value: p.kind.charAt(0).toUpperCase() + p.kind.slice(1) },
        ]}
      />
      <DetailSection title="Caption" className={sheetTrack}>
        {p.caption ? <blockquote className="rounded-[10px] border-l-2 border-violet/60 bg-white/[0.02] px-3 py-2.5 text-[13px] whitespace-pre-wrap text-ink-2">{p.caption}</blockquote> : <EmptyLine>No caption.</EmptyLine>}
        {p.removedReason ? <p className="text-[12px] text-ink-3">Yard&apos;s reason: {p.removedReason}</p> : null}
      </DetailSection>
      <DetailSection title="Report" className={sheetTrack}>
        {p.report ? (
          <Facts
            items={[
              { label: "Reason", value: p.report.reasonLabel },
              { label: "Reported by", value: `${p.report.reporter.name} (${p.report.reporter.kind})` },
              { label: "Reported", value: relDays(p.report.createdAt, now) },
              { label: "Other open reports", value: <span className="tabular">{p.report.others}</span> },
            ]}
          />
        ) : (
          <EmptyLine>No open reports on this post.</EmptyLine>
        )}
      </DetailSection>
      <RelatedLinks links={[!!p.brand.handle && { href: `/brands/${p.brand.handle}`, label: `${p.brand.name}'s storefront`, hint: "Where the feed shows" }]} />
      <DetailSection title="Activity" className={sheetTrack}>
        <ServerActivity subjectIds={[p.id, p.report?.id ?? "", ...p.reportIds]} extra={p.report ? [{ at: p.report.createdAt, label: "Report received", detail: p.report.reasonLabel }] : undefined} />
      </DetailSection>
    </DetailSheet>
  )
}

/* ── Places with their events as child rows ────────────────────────── */

type PlaceRowItem = { id: string; kind: "place"; place: PlaceDto } | { id: string; kind: "event"; place: PlaceDto; event: PlaceEventDto }
const eventNeeds = (e: PlaceEventDto) => e.moderationStatus !== "approved" || !!e.report

function placeDecisions(ask: Ask) {
  return {
    place: (p: PlaceDto, action: "approve" | "reject" | "remove" | "restore") =>
      ask({
        action: "set-place-moderation",
        body: { id: p.id, action, ...(p.report ? { reportId: p.report.id } : {}) },
        title: { approve: `Approve ${p.name}?`, reject: `Reject ${p.name}?`, remove: `Remove ${p.name}?`, restore: `Restore ${p.name}?` }[action],
        description: {
          approve: `It shows on Yard Around once ${p.brand.name} publishes it, with its photos. ${p.brand.name} is notified in Studio; your reason stays in the audit log.`,
          reject: `It stays off Yard Around. ${p.brand.name} can fix it and publish it again for another review. Its reports are closed as acted on. ${p.brand.name} is notified in Studio and sees your reason.`,
          remove: `It leaves Yard Around with its events and photos, and is locked: ${p.brand.name} can delete it but can't publish it again. ${p.brand.name} is notified in Studio and sees your reason.`,
          restore: `It's approved again and can show on Yard Around if ${p.brand.name} publishes it. ${p.brand.name} is notified in Studio; your reason stays in the audit log.`,
        }[action],
        fieldLabel: action === "reject" || action === "remove" ? `Reason, shown to ${p.brand.name}` : "Reason, for the audit log",
        confirmLabel: { approve: "Approve place", reject: "Reject place", remove: "Remove place", restore: "Restore place" }[action],
        destructive: action === "remove" || action === "reject",
        presets: action === "reject" || action === "remove" ? ["Address or pin is wrong", "Place isn't real or has closed", "Misleading details"] : undefined,
        done: { approve: "Place approved", reject: "Place rejected", remove: "Place removed", restore: "Place restored" }[action],
      }),
    event: (e: PlaceEventDto, p: PlaceDto, action: "approve" | "hide" | "remove") =>
      ask({
        action: "set-event-moderation",
        body: { id: e.id, action, ...(e.report ? { reportId: e.report.id } : {}) },
        title: { approve: `Approve ${e.title}?`, hide: `Hide ${e.title}?`, remove: `Remove ${e.title}?` }[action],
        description: {
          approve: `It shows in "Happening here" at ${p.name}. ${p.brand.name} is notified in Studio; your reason stays in the audit log.`,
          hide: `It leaves "Happening here" at ${p.name}. ${p.brand.name} can fix it and resubmit. ${p.brand.name} is notified in Studio and sees your reason.`,
          remove: `It leaves "Happening here" and is locked: ${p.brand.name} can delete it but can't publish it again. ${p.brand.name} is notified in Studio and sees your reason.`,
        }[action],
        fieldLabel: action === "approve" ? "Reason, for the audit log" : `Reason, shown to ${p.brand.name}`,
        confirmLabel: { approve: "Approve event", hide: "Hide event", remove: "Remove event" }[action],
        destructive: action !== "approve",
        done: { approve: "Event approved", hide: "Event hidden", remove: "Event removed" }[action],
      }),
    dismissPlace: (p: PlaceDto) => dismissReport(ask, p.report!, p.name),
    dismissEvent: (e: PlaceEventDto) => dismissReport(ask, e.report!, e.title),
  }
}

function PlacesTable({ data, ask, caseId }: { data?: PlaceDto[]; ask: Ask; caseId: string | null }) {
  const { reason } = useAdminSession()
  const r = reason("places.moderate")
  const d = placeDecisions(ask)
  const rows: PlaceRowItem[] = useMemo(
    () => (data ?? []).flatMap((p) => [{ id: p.id, kind: "place" as const, place: p }, ...p.events.filter(eventNeeds).map((e) => ({ id: e.id, kind: "event" as const, place: p, event: e }))]),
    [data],
  )
  const open = (row: PlaceRowItem) => writeParams({ case: row.place.id })
  const status = (row: PlaceRowItem) => modStatus[row.kind === "place" ? row.place.moderationStatus : row.event.moderationStatus]
  const report = (row: PlaceRowItem) => (row.kind === "place" ? row.place.report : row.event.report)
  // Phones hide the Reason and Status columns, so the row's second line says why it's here.
  const phoneLine = (row: PlaceRowItem) => {
    const rep = report(row)
    if (rep) return `Reported: ${rep.reasonLabel.toLowerCase()}`
    return status(row)?.label ?? ""
  }
  const columns: Column<PlaceRowItem>[] = [
    {
      key: "place",
      header: "Place or event",
      cell: (row) =>
        row.kind === "place" ? (
          <button type="button" onClick={() => open(row)} className="group flex min-h-10 max-w-full min-w-0 items-center gap-2.5 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-violet">
            <AdminImg src={row.place.image?.src} alt="" className="size-9 shrink-0 rounded-md border border-white/8" />
            <span className="min-w-0">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="block max-w-[40vw] truncate font-medium text-ink group-hover:text-violet sm:max-w-[240px]">{row.place.name}</span>
                {row.place.sample ? <SampleTag /> : null}
              </span>
              <span className="block max-w-[40vw] truncate text-[11.5px] text-ink-3 sm:max-w-[240px]">
                <span className="sm:hidden">{phoneLine(row)}</span>
                <span className="hidden sm:inline">
                  {row.place.brand.name}, {kindLabel[row.place.kind] ?? row.place.kind}
                </span>
              </span>
            </span>
          </button>
        ) : (
          <button type="button" onClick={() => open(row)} className="group flex min-h-10 max-w-full min-w-0 items-center gap-2 rounded-md pl-5 text-left outline-none focus-visible:ring-2 focus-visible:ring-violet">
            <span aria-hidden className="-mt-3 h-4 w-3 shrink-0 rounded-bl-md border-b border-l border-white/15" />
            <span className="min-w-0">
              <span className="block max-w-[40vw] truncate text-[13px] text-ink group-hover:text-violet sm:max-w-[220px]">{row.event.title}</span>
              <span className="block max-w-[40vw] truncate text-[11.5px] text-ink-3 sm:max-w-[220px]">
                <span className="sm:hidden">{phoneLine(row)}</span>
                <span className="hidden sm:inline">Event, {kindLabel[row.event.kind] ?? row.event.kind}</span>
              </span>
            </span>
          </button>
        ),
    },
    { key: "where", header: "Where or when", hideBelow: "lg", cell: (row) => <span className="whitespace-nowrap text-ink-2">{row.kind === "place" ? [row.place.neighbourhood, row.place.city].filter(Boolean).join(", ") : `Starts ${formatDate(row.event.startsAt)}`}</span> },
    {
      key: "reason",
      header: "Reason",
      hideBelow: "sm",
      cell: (row) => {
        const rep = report(row)
        if (rep) return <StatusBadge tone="attention">{rep.reasonLabel}</StatusBadge>
        if (row.kind === "place" && row.place.moderationStatus === "pending_review") return <span className="text-ink-2">{row.place.brand.verified ? "Changed after review" : "New place from an unverified brand"}</span>
        if (row.kind === "event" && row.event.moderationStatus === "pending_review") return <span className="text-ink-2">New event to review</span>
        return <span className="text-ink-3">No reports</span>
      },
    },
    { key: "status", header: "Status", hideBelow: "md", cell: (row) => <StatusBadge tone={status(row)?.tone ?? "neutral"}>{status(row)?.label}</StatusBadge> },
  ]
  const isPlace = (row: PlaceRowItem): row is Extract<PlaceRowItem, { kind: "place" }> => row.kind === "place"
  const isEvent = (row: PlaceRowItem): row is Extract<PlaceRowItem, { kind: "event" }> => row.kind === "event"
  const dis = { disabled: () => !!r, disabledReason: () => r }
  const rowActions: RowAction<PlaceRowItem>[] = [
    { label: "Open", icon: EyeIcon, onSelect: open },
    { label: "Approve", icon: CheckIcon, separatorBefore: true, ...dis, hidden: (row) => !(isPlace(row) ? ["pending_review", "rejected"].includes(row.place.moderationStatus) : ["pending_review", "rejected"].includes(row.event.moderationStatus)), onSelect: (row) => void (isPlace(row) ? d.place(row.place, "approve") : isEvent(row) && d.event(row.event, row.place, "approve")) },
    { label: "Reject", icon: XCircleIcon, ...dis, hidden: (row) => !(isPlace(row) && ["pending_review", "approved"].includes(row.place.moderationStatus)), onSelect: (row) => void d.place(row.place, "reject") },
    { label: "Hide event", icon: EyeSlashIcon, ...dis, hidden: (row) => !(isEvent(row) && ["pending_review", "approved"].includes(row.event.moderationStatus)), onSelect: (row) => void (isEvent(row) && d.event(row.event, row.place, "hide")) },
    { label: "Remove", icon: TrashIcon, destructive: true, ...dis, hidden: (row) => (isPlace(row) ? row.place.moderationStatus === "removed" : isEvent(row) && row.event.moderationStatus === "removed"), onSelect: (row) => void (isPlace(row) ? d.place(row.place, "remove") : isEvent(row) && d.event(row.event, row.place, "remove")) },
    { label: "Restore", icon: ArrowCounterClockwiseIcon, ...dis, hidden: (row) => !(isPlace(row) && row.place.moderationStatus === "removed"), onSelect: (row) => void d.place(row.place, "restore") },
    { label: "Dismiss report", icon: XCircleIcon, ...dis, hidden: (row) => !report(row), onSelect: (row) => void (isPlace(row) ? d.dismissPlace(row.place) : isEvent(row) && d.dismissEvent(row.event)) },
  ]
  const shown = data?.find((p) => p.id === caseId)
  return (
    <>
      <DataTable
        label="Places and events"
        rows={rows}
        columns={columns}
        getId={(row) => row.id}
        loading={!data}
        search={{ placeholder: "Search place, event or brand", text: (row) => [row.place.name, row.place.brand.name, row.place.city, row.kind === "event" ? row.event.title : ""].join(" ") }}
        rowActions={rowActions}
        empty={{ title: TABS.places.empty, body: TABS.places.emptyBody }}
        minWidth={300}
        initialPageSize={25}
      />
      <PlaceSheet place={shown} open={!!shown} decisions={d} reason={r} onOpenChange={(o) => !o && writeParams({ case: null, report: null })} />
    </>
  )
}

function PlaceSheet({ place, open, decisions, reason, onOpenChange }: { place?: PlaceDto; open: boolean; decisions: ReturnType<typeof placeDecisions>; reason?: string; onOpenChange: (o: boolean) => void }) {
  const now = useNow(60_000)
  const last = useLast(place)
  const p = place ?? last
  if (!p) return null
  const st = modStatus[p.moderationStatus]
  const actions: TrustAction[] = []
  if (p.report) actions.push({ key: "dismiss", label: "Dismiss report", icon: XCircleIcon, variant: "secondary", onSelect: () => void decisions.dismissPlace(p), disabledReason: reason })
  if (["pending_review", "approved"].includes(p.moderationStatus)) actions.push({ key: "reject", label: "Reject", icon: XCircleIcon, variant: "secondary", onSelect: () => void decisions.place(p, "reject"), disabledReason: reason })
  if (p.moderationStatus !== "removed") actions.push({ key: "remove", label: "Remove", icon: TrashIcon, variant: "destructive", onSelect: () => void decisions.place(p, "remove"), disabledReason: reason })
  if (p.moderationStatus === "removed") actions.push({ key: "restore", label: "Restore", icon: ArrowCounterClockwiseIcon, variant: "secondary", onSelect: () => void decisions.place(p, "restore"), disabledReason: reason })
  if (["pending_review", "rejected"].includes(p.moderationStatus)) actions.push({ key: "approve", label: "Approve", icon: CheckIcon, variant: "primary", onSelect: () => void decisions.place(p, "approve"), disabledReason: reason })
  return (
    <DetailSheet
      open={open}
      onOpenChange={onOpenChange}
      title={p.name}
      description={`${p.brand.name}, ${kindLabel[p.kind] ?? p.kind}`}
      badges={
        <>
          {p.report ? <StatusBadge tone="attention">{p.report.reasonLabel}</StatusBadge> : null}
          <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
          {!p.brand.verified ? <StatusBadge tone="info">Unverified brand</StatusBadge> : null}
          {p.sample ? <StatusBadge tone="muted">Sample place</StatusBadge> : null}
        </>
      }
      actions={<TrustActionBar note="Every decision needs a reason and is recorded in the audit log." actions={actions} />}
    >
      {p.image ? <AdminImg src={p.image.src} alt={p.image.alt} className="aspect-[16/9] w-full rounded-[10px] border border-white/[0.07]" /> : null}
      <Facts
        items={[
          { label: "Address", value: p.address },
          { label: "Area", value: [p.neighbourhood, p.city, p.country].filter(Boolean).join(", ") },
          { label: "Visibility", value: p.visibility === "published" ? "Published by the brand" : p.visibility === "hidden" ? "Hidden by the brand" : "Draft" },
          { label: p.startsAt ? "Dates" : "Reviewed", value: p.startsAt ? `${formatDate(p.startsAt)} to ${formatDate(p.endsAt!)}` : reviewedWords(p, now) },
        ]}
      />
      <DetailSection title={p.report ? "Evidence" : "Description"} className={sheetTrack}>
        {p.report ? (
          <blockquote className="grid gap-1 rounded-[10px] border-l-2 border-violet/60 bg-white/[0.02] px-3 py-2.5 text-[13px] text-ink-2">
            <p>
              {p.report.reporter.name} reported it as <span className="text-ink">{p.report.reasonLabel.toLowerCase()}</span>, {relDays(p.report.createdAt, now).toLowerCase()}.
            </p>
            {p.report.others ? <p className="text-[12px] text-ink-3">{p.report.others} more open {p.report.others === 1 ? "report" : "reports"} on this place.</p> : null}
          </blockquote>
        ) : null}
        {p.description ? (
          <blockquote aria-label="The brand's description" className="rounded-[10px] border-l-2 border-white/15 bg-white/[0.02] px-3 py-2.5 text-[13px] text-ink-2">
            {p.report ? <span className="block text-[11px] text-ink-3">The brand&apos;s description</span> : null}
            {p.description}
          </blockquote>
        ) : !p.report ? (
          <EmptyLine>The brand wrote no description, and there are no open reports.</EmptyLine>
        ) : null}
        {p.moderationReason ? <p className="text-[12px] text-ink-3">Yard&apos;s reason: {p.moderationReason}</p> : null}
      </DetailSection>
      <DetailSection title="Events" className={sheetTrack} aside={<span className="text-[11px] text-ink-3 tabular">{p.events.length}</span>}>
        {p.events.length ? (
          <ul className={cn("divide-y divide-white/[0.07]", insetClass)}>
            {p.events.map((e) => {
              const es = modStatus[e.moderationStatus]
              return (
                <li key={e.id} className="grid gap-2 px-3 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] text-ink">{e.title}</span>
                      <span className="block text-[11px] text-ink-3">
                        {kindLabel[e.kind] ?? e.kind}, {formatDate(e.startsAt)}
                        {e.report ? `, reported: ${e.report.reasonLabel.toLowerCase()}` : ""}
                      </span>
                    </span>
                    <StatusBadge tone={es.tone}>{es.label}</StatusBadge>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {["pending_review", "rejected"].includes(e.moderationStatus) ? <EventButton label="Approve" icon={CheckIcon} disabled={reason} onClick={() => void decisions.event(e, p, "approve")} /> : null}
                    {["pending_review", "approved"].includes(e.moderationStatus) ? <EventButton label="Hide event" icon={EyeSlashIcon} disabled={reason} onClick={() => void decisions.event(e, p, "hide")} /> : null}
                    {e.moderationStatus !== "removed" ? <EventButton label="Remove event" icon={TrashIcon} destructive disabled={reason} onClick={() => void decisions.event(e, p, "remove")} /> : null}
                    {e.report ? <EventButton label="Dismiss report" icon={XCircleIcon} disabled={reason} onClick={() => void decisions.dismissEvent(e)} /> : null}
                  </div>
                </li>
              )
            })}
          </ul>
        ) : (
          <EmptyLine>No events at this place.</EmptyLine>
        )}
      </DetailSection>
      <DetailSection title="Activity" className={sheetTrack}>
        <ServerActivity subjectIds={[p.id, p.report?.id ?? "", ...p.reportIds, ...p.events.flatMap((e) => [e.id, ...e.reportIds])]} extra={p.report ? [{ at: p.report.createdAt, label: "Report received", detail: p.report.reasonLabel }] : undefined} />
      </DetailSection>
    </DetailSheet>
  )
}

function EventButton({ label, icon: Icon, onClick, destructive, disabled }: { label: string; icon: React.ComponentType<{ className?: string }>; onClick: () => void; destructive?: boolean; disabled?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!!disabled}
      title={disabled}
      className={cn(
        "inline-flex h-10 items-center gap-1.5 rounded-md border px-2.5 text-[12px] transition-colors focus-visible:outline-2 focus-visible:outline-violet disabled:opacity-40 sm:h-8",
        destructive ? "border-danger/40 text-danger hover:bg-danger/10" : "border-line text-ink-2 hover:bg-elevated hover:text-ink",
      )}
    >
      <Icon className="size-3.5" aria-hidden /> {label}
    </button>
  )
}

/* ── Integrations ──────────────────────────────────────────────────── */

const providerName = { instagram: "Instagram", tiktok: "TikTok" } as const
const accountStatus: Record<string, { label: string; tone: Tone }> = {
  connected: { label: "Connected", tone: "success" },
  needs_reauth: { label: "Needs reconnecting", tone: "attention" },
  error: { label: "Sync error", tone: "danger" },
  revoked: { label: "Access revoked", tone: "muted" },
  disconnected: { label: "Disconnected", tone: "muted" },
}

function Integrations({ data, ask }: { data?: Extract<ContentListDto, { tab: "integrations" }>; ask: Ask }) {
  const now = useNow(60_000)
  const { reason } = useAdminSession()
  const r = reason("social.manage")
  const pause = (a: { brand: IntegrationDto["brand"] }, paused: boolean) =>
    ask({
      action: "set-social-paused",
      body: { id: a.brand.id, paused },
      title: paused ? `Pause ${a.brand.name}'s social feed?` : `Resume ${a.brand.name}'s social feed?`,
      description: paused
        ? `Every post leaves ${a.brand.name}'s storefront and their files stop loading publicly until you resume it. ${a.brand.name} is notified in Studio and sees your reason.`
        : `Posts ${a.brand.name} shows become public again. ${a.brand.name} is notified in Studio; your reason stays in the audit log.`,
      fieldLabel: paused ? `Reason, shown to ${a.brand.name}` : "Reason, for the audit log",
      confirmLabel: paused ? "Pause social" : "Resume social",
      destructive: paused,
      done: paused ? "Social feed paused" : "Social feed resumed",
    })
  const columns: Column<IntegrationDto>[] = [
    {
      key: "account",
      header: "Account",
      cell: (a) => (
        <span className="block min-w-0">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="block max-w-[40vw] truncate font-medium text-ink sm:max-w-[220px]">
              {providerName[a.provider]}
              {a.handle ? ` @${a.handle}` : ""}
            </span>
            {a.mode === "sandbox" ? <span className="inline-flex h-5 items-center rounded-full border border-white/10 px-1.5 text-[10.5px] text-ink-3">Sandbox</span> : null}
          </span>
          <span className="block max-w-[40vw] truncate text-[11.5px] text-ink-3 sm:max-w-[220px]">{a.brand.name}</span>
        </span>
      ),
    },
    { key: "status", header: "Status", hideBelow: "sm", cell: (a) => <span className="flex flex-wrap gap-1"><StatusBadge tone={accountStatus[a.status]?.tone ?? "neutral"}>{accountStatus[a.status]?.label ?? a.status}</StatusBadge>{a.paused ? <StatusBadge tone="attention">Paused by Yard</StatusBadge> : null}</span> },
    { key: "sync", header: "Last sync", hideBelow: "md", cell: (a) => <span className="whitespace-nowrap text-ink-2">{a.lastSyncAt ? relDays(a.lastSyncAt, now) : "Never"}</span> },
    { key: "error", header: "Problem", hideBelow: "lg", cell: (a) => <span className="block max-w-[220px] truncate text-ink-2">{a.statusDetail ?? a.lastErrorCode ?? "None"}</span> },
  ]
  const rowActions: RowAction<IntegrationDto>[] = [
    {
      label: "Retry sync",
      icon: ArrowClockwiseIcon,
      hidden: (a) => a.status === "disconnected" || a.status === "revoked",
      disabled: () => !!r,
      disabledReason: () => r,
      onSelect: (a) =>
        void ask({
          action: "retry-social-sync",
          body: { id: a.id },
          title: `Retry the sync for ${providerName[a.provider]}${a.handle ? ` @${a.handle}` : ""}?`,
          description: `The account is synced again straight away, with ${providerName[a.provider]}'s own limits. Nobody is notified; your reason stays in the audit log.`,
          fieldLabel: "Reason, for the audit log",
          confirmLabel: "Retry sync",
          done: "Sync requested",
        }),
    },
    {
      label: "Force disconnect",
      icon: LinkBreakIcon,
      destructive: true,
      hidden: (a) => a.status === "disconnected",
      disabled: () => !!r,
      disabledReason: () => r,
      onSelect: (a) =>
        void ask({
          action: "force-disconnect-social",
          body: { id: a.id },
          title: `Disconnect ${a.brand.name}'s ${providerName[a.provider]}?`,
          description: `Yard deletes the stored access, stops syncing and hides the imported posts. ${a.brand.name} can connect again later. ${a.brand.name} is notified in Studio and sees your reason.`,
          fieldLabel: `Reason, shown to ${a.brand.name}`,
          confirmLabel: "Disconnect",
          destructive: true,
          done: "Account disconnected",
        }),
    },
    { label: "Pause social for brand", icon: PauseIcon, destructive: true, hidden: (a) => a.paused, disabled: () => !!r, disabledReason: () => r, onSelect: (a) => void pause(a, true) },
    { label: "Resume social for brand", icon: PlayIcon, hidden: (a) => !a.paused, disabled: () => !!r, disabledReason: () => r, onSelect: (a) => void pause(a, false) },
  ]
  return (
    <div className="grid gap-4">
      <section aria-label="Platform setup" className="grid gap-2 @xl:grid-cols-2">
        {data
          ? data.setup.providers.map((p) => (
              <div key={p.provider} className="admin-inset grid gap-2 p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[13px] text-ink">{providerName[p.provider]}</p>
                  <StatusBadge tone={p.configured ? "success" : "attention"}>{p.configured ? "Keys set" : "Not switched on"}</StatusBadge>
                </div>
                <p className="text-[12px] text-ink-2">
                  {p.configured
                    ? "Yard's app keys are set. Live connections are untested in this sandbox, which can't reach the provider."
                    : `Brands see "${providerName[p.provider]} connections aren't switched on for Yard yet" and can upload posts instead.`}
                </p>
                {!p.configured ? (
                  <dl className="grid gap-1 text-[12px]">
                    <div className="flex flex-wrap gap-x-2">
                      <dt className="text-ink-3">Environment variables</dt>
                      <dd className="font-mono text-[11.5px] text-ink">{p.envVars.join(", ")}</dd>
                    </div>
                    <div className="flex flex-wrap gap-x-2">
                      <dt className="text-ink-3">Redirect URI to register</dt>
                      <dd className="font-mono text-[11.5px] break-all text-ink">{p.redirectUri}</dd>
                    </div>
                  </dl>
                ) : null}
              </div>
            ))
          : [0, 1].map((i) => <div key={i} className="skeleton h-28 rounded-[12px]" />)}
        {data?.setup.sandboxEnabled ? <p className="text-[11.5px] text-ink-3 @xl:col-span-2">The development sandbox is on: accounts marked Sandbox are simulated and their posts are sample data.</p> : null}
      </section>
      <DataTable
        label="Social accounts"
        rows={data?.integrations ?? []}
        columns={columns}
        getId={(a) => a.id}
        loading={!data}
        search={{ placeholder: "Search brand or handle", text: (a) => `${a.brand.name} ${a.handle ?? ""} ${a.provider}` }}
        rowActions={rowActions}
        empty={{ title: TABS.integrations.empty, body: TABS.integrations.emptyBody }}
        minWidth={300}
      />
      {data?.paused.length ? (
        <section aria-label="Paused social feeds" className="grid gap-2">
          <h3 className="font-label text-[13px] text-ink">Paused by Yard</h3>
          <ul className={cn("divide-y divide-white/[0.07]", insetClass)}>
            {data.paused.map((p) => (
              <li key={p.restrictionId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                <span className="min-w-0">
                  <span className="block text-[13px] text-ink">{p.brand.name}</span>
                  <span className="block text-[11.5px] text-ink-3">Since {relDays(p.since, now).toLowerCase()}: {p.reason}</span>
                </span>
                <EventButton label="Resume social" icon={PlayIcon} disabled={r} onClick={() => void pause(p, false)} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
