"use client"

import { useId, useState } from "react"
import {
  ArrowUpRightIcon,
  ChatsCircleIcon,
  EyeIcon,
  FlagIcon,
  GavelIcon,
  HandPalmIcon,
  LockSimpleIcon,
  PaperPlaneTiltIcon,
  ProhibitIcon,
  ShieldWarningIcon,
  TrashIcon,
  XCircleIcon,
} from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { DataTable, type Column, type RowAction } from "@/components/dashboard/data-table"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { StatCard } from "@/components/dashboard/insight/stat-card"
import { Reveal, RevealItem } from "@/components/admin/ui/motion"
import { Panel } from "@/components/admin/ui/panel"
import { Segmented, segmentedTabId } from "@/components/admin/ui/segmented"
import { DetailSection, DetailSheet, EmptyLine, Facts, insetClass } from "@/components/admin/marketplace/detail-sheet"
import { formatDateTime, relDays } from "@/components/admin/marketplace/format"
import { AdminPageHead, PanelRail, StatRow } from "@/components/admin/marketplace/page-head"
import { InPageLinks, useSearchParam, writeParams } from "@/components/admin/marketplace/url-state"
import { useLast } from "@/components/admin/marketplace/use-last"
import { useNow } from "@/hooks/use-now"
import { adminKeys, getMessageCase, listMessages, viewEvidence, viewHeldMessage } from "@/lib/api/admin"
import { MESSAGE_TABS, type EvidenceDto, type EvidenceMessage, type HeldViewResult, type MessageCaseDto, type MessageTab } from "@/lib/api/contracts/admin"
import { useApi } from "@/lib/api/use-api"
import { useAsyncAction } from "@/hooks/use-async-action"
import { formatNumber } from "@/lib/money"
import { cn } from "@/lib/utils"
import { useAdminSampleData } from "../sample"
import { DURATIONS, restrictDecision } from "./restrict"
import { durationLabels } from "@/lib/api/contracts/admin"
import { LoadError, NotInQueue, RelatedLinks, SampleTag, ServerActivity, TrustActionBar, TrustGate, pushAudit, sheetTrack, useAdminSession, useQueueFigures, useQueueLive, useServerDecision, type TrustAction } from "./shared"

/*
 * Admin › Messages (§8.1). Metadata first: the rows say who, which brand and why, never what was
 * said. The report's frozen evidence and a held message's own text open through audited POSTs.
 * There's no way to browse a conversation from here.
 */

const TABS: Record<MessageTab, { label: string; empty: string; emptyBody: string }> = {
  reported: { label: "Reported", empty: "No open message reports", emptyBody: "Reports from shoppers and brands about messages land here." },
  held: { label: "Held", empty: "No held messages", emptyBody: "Messages Yard's spam rules hold for review wait here. They reach nobody until you release them." },
  spam: { label: "Spam signals", empty: "No spam signals", emptyBody: "Conversations a brand marked as spam, or the rules suspect, show here." },
  closed: { label: "Closed", empty: "Nothing closed yet", emptyBody: "Reports that were dismissed or acted on are kept here." },
}
const isTab = (v: string | null): v is MessageTab => !!v && (MESSAGE_TABS as readonly string[]).includes(v)
const n = (v: number) => formatNumber(Math.round(v))

const statusMeta: Record<string, { label: string; tone: "attention" | "info" | "muted" | "danger" | "success" | "neutral" }> = {
  open: { label: "Open", tone: "attention" },
  in_review: { label: "In review", tone: "info" },
  escalated: { label: "Escalated", tone: "info" },
  actioned: { label: "Acted on", tone: "success" },
  dismissed: { label: "Dismissed", tone: "muted" },
  held: { label: "Held", tone: "attention" },
  sent: { label: "Released", tone: "success" },
  removed: { label: "Removed", tone: "danger" },
  suspected: { label: "Suspected", tone: "attention" },
  confirmed: { label: "Marked as spam", tone: "danger" },
}
/** The case's title: its two parties, or the brand alone when the reported conversation is gone. */
const partiesOf = (c: MessageCaseDto) => (c.subjectGone && !c.customer.id ? `${c.brand.name}, subject deleted` : `${c.customer.name} and ${c.brand.name}`)
const sideWord = (s: MessageCaseDto["side"]) => (s === "brand" ? "Brand" : s === "system" ? "Yard" : "Shopper")
const openReport = (c: MessageCaseDto) => c.kind === "report" && (c.status === "open" || c.status === "in_review" || c.status === "escalated")

/** Who sent what's being moderated: the reported or held message's sender, or the reported party of a conversation report. */
function senderOf(c: MessageCaseDto): { kind: "user" | "brand"; id: string; name: string } {
  const brandSide = c.side ? c.side === "brand" : c.reporter?.kind === "shopper"
  return brandSide ? { kind: "brand", id: c.brand.id, name: c.brand.name } : { kind: "user", id: c.customer.id, name: c.customer.name }
}

export function MessagesView() {
  const sampleOn = useAdminSampleData().on
  return (
    <Reveal ssrVisible className="@container grid gap-3">
      <AdminPageHead
        title="Messages"
        description="Reported and held messages between shoppers and brands. Rows show who and why, never what was said."
        live={!sampleOn}
        note={sampleOn ? "Opening a report's evidence or a held message is recorded in the audit log. Conversations with the Sample tag are seeded sample data." : "Opening a report's evidence or a held message is recorded in the audit log."}
      />
      <TrustGate feature="Messages" anyOf={["messages.view_reports"]}>
        <MessagesQueue />
      </TrustGate>
    </Reveal>
  )
}

function MessagesQueue() {
  const qid = useId()
  const now = useNow(60_000)
  const linked = useSearchParam("tab")
  const tab: MessageTab = isTab(linked) ? linked : "reported"
  // Report notifications link to ?report=<id> (F2); the queue's own links use ?case=.
  const reportLink = useSearchParam("report")
  const caseParam = useSearchParam("case")
  const caseId = caseParam ?? reportLink
  const q = useApi(adminKeys.messages(tab), () => listMessages(tab), { refreshInterval: 30_000 })
  useQueueLive(() => void q.revalidate())
  const { reason } = useAdminSession()
  const { ask, dialog } = useServerDecision(() => document.getElementById(segmentedTabId(qid, tab)))
  // Counts come with each tab's response: the last ones stay while another tab loads.
  const figures = useQueueFigures(q.data?.counts, q.error)
  const counts = figures.counts
  const ready = figures.ready
  const rows = q.data?.tab === tab ? q.data.items : []

  const open = (c: MessageCaseDto) => writeParams({ case: c.id })
  // The case a decision just returned: the open sheet shows it at once (a released message leaves the
  // Held tab, so its row can't be the sheet's source any more).
  const [decided, setDecided] = useState<MessageCaseDto | null>(null)
  const decisions = useMessageDecisions(ask, setDecided)

  const columns: Column<MessageCaseDto>[] = [
    {
      key: "parties",
      header: "Conversation",
      sortValue: (c) => `${c.customer.name} ${c.brand.name}`.toLowerCase(),
      cell: (c) => (
        <button type="button" onClick={() => open(c)} className="group flex min-h-10 max-w-full min-w-0 items-center gap-2.5 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-violet">
          <span aria-hidden className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-ink-2">
            <ChatsCircleIcon className="size-4" />
          </span>
          <span className="min-w-0">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="block max-w-[40vw] truncate font-medium text-ink group-hover:text-violet sm:max-w-[240px]">{partiesOf(c)}</span>
              {c.sample ? <SampleTag /> : null}
            </span>
            <span className="block max-w-[40vw] truncate text-[11.5px] text-ink-3 sm:max-w-[240px]">
              <span className="sm:hidden">{c.reasonLabel}</span>
              <span className="hidden sm:inline">{c.kind === "report" ? `Reported by ${c.reporter?.name ?? "someone"}` : c.kind === "held" ? `Sent by the ${sideWord(c.side).toLowerCase()}` : "Conversation"}</span>
            </span>
          </span>
        </button>
      ),
    },
    { key: "reason", header: "Reason", hideBelow: "sm", sortValue: (c) => c.reasonLabel, cell: (c) => <StatusBadge tone={c.reason === "scam_or_offplatform_payment" || c.reason?.includes("offplatform") ? "danger" : "attention"}>{c.reasonLabel}</StatusBadge> },
    { key: "side", header: tab === "held" ? "Sender" : "Reporter", hideBelow: "lg", cell: (c) => <span className="whitespace-nowrap text-ink-2">{c.kind === "report" ? `${c.reporter?.name}, ${c.reporter?.kind}` : sideWord(c.side)}</span> },
    { key: "age", header: tab === "closed" ? "Decided" : "Age", hideBelow: "md", sortValue: (c) => c.decidedAt ?? c.createdAt, cell: (c) => <time dateTime={c.decidedAt ?? c.createdAt} title={formatDateTime(c.decidedAt ?? c.createdAt)} className="whitespace-nowrap text-ink-2">{relDays(c.decidedAt ?? c.createdAt, now)}</time> },
    { key: "status", header: "Status", hideBelow: "md", cell: (c) => <StatusBadge tone={statusMeta[c.status]?.tone ?? "neutral"}>{statusMeta[c.status]?.label ?? c.status}</StatusBadge> },
  ]

  const rowActions: RowAction<MessageCaseDto>[] = [
    { label: "Open case", icon: EyeIcon, onSelect: open },
    { label: "Dismiss report", icon: XCircleIcon, separatorBefore: true, hidden: (c) => !openReport(c), disabled: () => !!reason("messages.moderate"), disabledReason: () => reason("messages.moderate"), onSelect: (c) => void decisions.dismiss(c) },
    { label: "Escalate", icon: GavelIcon, hidden: (c) => !(openReport(c) && c.status !== "escalated"), disabled: () => !!reason("messages.view_reports"), disabledReason: () => reason("messages.view_reports"), onSelect: (c) => void decisions.escalate(c) },
    { label: "Release message", icon: PaperPlaneTiltIcon, hidden: (c) => !(c.kind === "held" && c.status === "held"), disabled: (c) => !!releaseOff(c, reason), disabledReason: (c) => releaseOff(c, reason), onSelect: (c) => void decisions.release(c) },
    { label: "Remove message", icon: TrashIcon, destructive: true, hidden: (c) => !(c.messageId && c.messageStatus !== "removed" && (openReport(c) || c.status === "held")), disabled: () => !!reason("messages.moderate"), disabledReason: () => reason("messages.moderate"), onSelect: (c) => void decisions.remove(c) },
    { label: "Lock conversation", icon: LockSimpleIcon, destructive: true, hidden: (c) => c.conversationLocked || c.kind === "held" || (c.kind === "report" && !openReport(c)), disabled: () => !!reason("messages.moderate"), disabledReason: () => reason("messages.moderate"), onSelect: (c) => void decisions.lock(c) },
  ]

  const meta = TABS[tab]
  return (
    <div className="grid gap-3">
      <InPageLinks>
        <StatRow label="Message figures">
          <RevealItem className="min-w-0">
            <StatCard surface="admin" variant={ready && counts?.reported ? "brand" : "default"} icon={FlagIcon} label="Open reports" value={counts?.reported ?? 0} format={figures.format(n)} hint={figures.hint("Oldest first")} href="/admin/messages#message-queue" hrefLabel="Show open reports" ready={ready} className="h-full" />
          </RevealItem>
          <RevealItem className="min-w-0">
            <StatCard surface="admin" variant={ready && counts?.held ? "brand" : "default"} icon={HandPalmIcon} label="Held" value={counts?.held ?? 0} format={figures.format(n)} hint={figures.hint("Delivered to nobody yet")} href="/admin/messages?tab=held#message-queue" hrefLabel="Show held messages" ready={ready} className="h-full" />
          </RevealItem>
          <RevealItem className="min-w-0">
            <StatCard surface="admin" icon={ShieldWarningIcon} label="Spam signals" value={counts?.spam ?? 0} format={figures.format(n)} hint={figures.hint("Marked or suspected")} href="/admin/messages?tab=spam#message-queue" hrefLabel="Show spam signals" ready={ready} className="h-full" />
          </RevealItem>
          <RevealItem className="min-w-0">
            <StatCard surface="admin" icon={ProhibitIcon} label="Closed reports" value={counts?.closed ?? 0} format={figures.format(n)} hint={figures.hint("Dismissed or acted on")} href="/admin/messages?tab=closed#message-queue" hrefLabel="Show closed reports" ready={ready} className="h-full" />
          </RevealItem>
        </StatRow>
      </InPageLinks>

      <Panel id="message-queue" title="Message queue" description="Open a case for its parties, the evidence and its history. Every decision asks for a reason." className="scroll-mt-24 rounded-[20px]" bodyClassName="px-0 pb-0 md:px-0 md:pb-0">
        <PanelRail value={tab}>
          <Segmented
            label="Message queue"
            size="sm"
            value={tab}
            onChange={(t) => writeParams({ tab: t === "reported" ? null : t })}
            loading={!counts}
            idBase={qid}
            panelId={`${qid}-panel`}
            options={MESSAGE_TABS.map((t) => ({ value: t, label: TABS[t].label, count: t === "closed" ? undefined : counts?.[t] }))}
          />
        </PanelRail>
        <div id={`${qid}-panel`} role="tabpanel" aria-labelledby={segmentedTabId(qid, tab)} className="border-t border-[var(--admin-hairline)] p-3 sm:p-4 md:p-5">
          {q.error && !q.data ? (
            <LoadError error={q.error} onRetry={() => void q.revalidate()} what="the message queue" />
          ) : (
            <DataTable
              key={tab}
              label={`${meta.label} messages`}
              rows={rows}
              columns={columns}
              getId={(c) => c.id}
              loading={!q.data || q.data.tab !== tab}
              search={{ placeholder: "Search shopper, brand or reason", text: (c) => [c.customer.name, c.brand.name, c.reasonLabel, c.reporter?.name ?? ""].join(" ") }}
              rowActions={rowActions}
              empty={{ title: meta.empty, body: meta.emptyBody }}
              minWidth={300}
            />
          )}
        </div>
      </Panel>

      <MessageCaseSheet
        id={caseId}
        listed={rows.find((r) => r.id === caseId)}
        decided={decided?.id === caseId ? decided : null}
        decisions={decisions}
        onOpenChange={(o) => {
          if (o) return
          setDecided(null)
          writeParams({ case: null, report: null })
        }}
      />
      {dialog}
    </div>
  )
}

type Ask = ReturnType<typeof useServerDecision>["ask"]

/** Why Release is off for this case: the role, or what would refuse the send now (a lock, a block, a status). */
function releaseOff(c: MessageCaseDto, reason: (p: "messages.moderate") => string | undefined) {
  return reason("messages.moderate") ?? (c.blockers?.length ? `Release is off. ${c.blockers.join(" ")}` : undefined)
}

const isCase = (v: unknown): v is MessageCaseDto => !!v && typeof v === "object" && "kind" in v && "conversationId" in v && "status" in v

/** The decisions a message case can take, worded for who hears about them. `onCase`: the case each one returns. */
function useMessageDecisions(ask: Ask, onCase: (c: MessageCaseDto) => void) {
  const keep = (r: { item: unknown }) => {
    if (isCase(r.item)) onCase(r.item)
  }
  return {
    dismiss: (c: MessageCaseDto) =>
      ask({
        action: "decide-report",
        body: { id: c.id, outcome: "dismiss" },
        title: `Dismiss the report on ${c.customer.name} and ${c.brand.name}'s conversation?`,
        description: `Closes the report with no action. ${c.reporter?.name ?? "The reporter"} is told it was reviewed; your reason stays in the audit log.`,
        fieldLabel: "Reason, for the audit log",
        confirmLabel: "Dismiss report",
        done: "Report dismissed",
        onDone: keep,
      }),
    escalate: (c: MessageCaseDto) =>
      ask({
        action: "decide-report",
        body: { id: c.id, outcome: "escalate" },
        title: "Escalate this report?",
        description: "Moves it to the escalated list for a Trust & safety decision. Nobody outside the Control Center is told; your reason stays in the audit log.",
        fieldLabel: "Reason, for the audit log",
        confirmLabel: "Escalate",
        done: "Report escalated",
        onDone: keep,
      }),
    remove: (c: MessageCaseDto) => {
      const sender = senderOf(c)
      // A held message only ever reached its sender: the other side never got it and sees nothing.
      const wasHeld = c.kind === "held" || c.messageStatus === "held"
      const other = sender.kind === "brand" ? c.customer.name : c.brand.name
      return ask({
        action: "remove-message",
        body: { id: c.messageId!, ...(c.kind === "report" ? { reportId: c.id } : {}) },
        title: "Remove this message?",
        description: wasHeld
          ? `${sender.name} sees "Message removed by Yard" in place of it; ${other} never received it and sees nothing. ${sender.name} is notified and sees your reason.`
          : `Both ${c.customer.name} and ${c.brand.name} see "Message removed by Yard" in place of it, and its reports are closed as acted on. ${sender.name} is notified and sees your reason.`,
        fieldLabel: `Reason, shown to ${sender.name}`,
        confirmLabel: "Remove message",
        destructive: true,
        presets: ["Asks for payment outside Yard", "Spam or scam links", "Harassment"],
        done: "Message removed",
        onDone: keep,
      })
    },
    release: (c: MessageCaseDto) =>
      ask({
        action: "release-held-message",
        body: { id: c.messageId ?? c.id },
        title: "Release this held message?",
        description: `It's delivered to ${c.side === "brand" ? c.customer.name : c.brand.name} as if it had just been sent, with the usual notification. Your reason stays in the audit log.`,
        fieldLabel: "Reason, for the audit log",
        confirmLabel: "Release message",
        done: "Message released",
        onDone: keep,
      }),
    lock: (c: MessageCaseDto) =>
      ask({
        action: "lock-conversation",
        body: { id: c.conversationId, ...(c.kind === "report" ? { reportId: c.id } : {}) },
        title: `Lock ${c.customer.name} and ${c.brand.name}'s conversation?`,
        description: "Nobody can send in it any more. Both sides keep reading it and see Yard's notice that it was closed. Your reason stays in the audit log.",
        fieldLabel: "Reason, for the audit log",
        confirmLabel: "Lock conversation",
        destructive: true,
        done: "Conversation locked",
        onDone: keep,
      }),
    restrict: (c: MessageCaseDto, duration: (typeof DURATIONS)[number]) => ask(restrictDecision(senderOf(c), duration)),
  }
}

/* ── The case sheet ────────────────────────────────────────────────── */

function MessageCaseSheet({ id, listed, decided, decisions, onOpenChange }: { id: string | null; listed?: MessageCaseDto; decided: MessageCaseDto | null; decisions: ReturnType<typeof useMessageDecisions>; onOpenChange: (o: boolean) => void }) {
  const shown = useLast(id)
  const now = useNow(60_000)
  const { reason } = useAdminSession()
  // A case linked from elsewhere (a notification) loads on its own when it isn't in this tab.
  const one = useApi(shown && !listed ? `admin:message-case:${shown}` : null, () => getMessageCase(shown!))
  // After a decision the case can leave this tab: the decision's own result comes first, then the
  // row, then the case loaded on its own; the last one shown stays while the next loads.
  const kept = useLast(decided ?? listed ?? one.data ?? null)
  const c = decided ?? listed ?? one.data ?? (kept?.id === shown ? kept : undefined)
  const [evidence, setEvidence] = useState<{ id: string; data: EvidenceDto; details: string | null } | null>(null)
  const [held, setHeld] = useState<{ id: string; data: HeldViewResult["message"] } | null>(null)
  const openEvidence = useAsyncAction(
    async (reportId: string) => {
      const r = await viewEvidence(reportId)
      pushAudit(r.audit)
      setEvidence({ id: reportId, data: r.evidence, details: r.details })
    },
    { error: "Couldn't open the evidence. Nothing was recorded; try again." },
  )
  const openHeld = useAsyncAction(
    async (messageId: string) => {
      const r = await viewHeldMessage(messageId)
      pushAudit(r.audit)
      setHeld({ id: messageId, data: r.message })
    },
    { error: "Couldn't open the held message. Nothing was recorded; try again." },
  )
  const isOpen = !!id && !!c

  if (!shown) return null
  if (!c) {
    if (one.error && id)
      return (
        <DetailSheet open={!!id} onOpenChange={onOpenChange} title="Case not found">
          <NotInQueue what="case" href="/admin/messages" queue="the message queue" />
        </DetailSheet>
      )
    return null
  }

  const meta = statusMeta[c.status]
  const sender = senderOf(c)
  const actions: TrustAction[] = []
  if (openReport(c)) {
    actions.push({ key: "dismiss", label: "Dismiss", icon: XCircleIcon, variant: "secondary", onSelect: () => void decisions.dismiss(c), disabledReason: reason("messages.moderate") })
    if (c.status !== "escalated") actions.push({ key: "escalate", label: "Escalate", icon: GavelIcon, variant: "secondary", onSelect: () => void decisions.escalate(c), disabledReason: reason("messages.view_reports") })
  }
  if (c.kind === "held" && c.status === "held") actions.push({ key: "release", label: "Release", icon: PaperPlaneTiltIcon, variant: "primary", onSelect: () => void decisions.release(c), disabledReason: releaseOff(c, reason) })
  if (c.messageId && c.messageStatus !== "removed" && (openReport(c) || c.status === "held")) actions.push({ key: "remove", label: "Remove message", icon: TrashIcon, variant: "destructive", onSelect: () => void decisions.remove(c), disabledReason: reason("messages.moderate") })
  if (!c.conversationLocked && c.kind !== "held" && (c.kind === "spam" || openReport(c))) actions.push({ key: "lock", label: "Lock conversation", icon: LockSimpleIcon, variant: "destructive", onSelect: () => void decisions.lock(c), disabledReason: reason("messages.moderate") })
  if (openReport(c) || c.status === "held" || c.kind === "spam")
    actions.push({
      key: "restrict",
      label: "Restrict sender",
      icon: ProhibitIcon,
      variant: "destructive",
      disabledReason: reason(sender.kind === "brand" ? "brands.restrict" : "users.restrict"),
      menu: DURATIONS.map((d) => ({ label: `Pause messaging for ${durationLabels[d]}`, onSelect: () => void decisions.restrict(c, d) })),
    })

  const ev = evidence?.id === c.id ? evidence.data : null
  const evDetails = evidence?.id === c.id ? evidence.details : null
  // The text shows only while the message is still held: once released or removed it's no longer evidence here.
  const heldMsg = held?.id === c.messageId && c.status === "held" ? held.data : null

  return (
    <DetailSheet
      open={isOpen}
      onOpenChange={onOpenChange}
      title={partiesOf(c)}
      description={c.kind === "report" ? `Report on a ${c.subjectType ?? "message"}` : c.kind === "held" ? `Held message from the ${sideWord(c.side).toLowerCase()}` : "Spam signal"}
      badges={
        <>
          <StatusBadge tone={c.reason?.includes("offplatform") ? "danger" : "attention"}>{c.reasonLabel}</StatusBadge>
          <StatusBadge tone={meta?.tone ?? "neutral"}>{meta?.label ?? c.status}</StatusBadge>
          {c.conversationLocked ? <StatusBadge tone="muted">Locked</StatusBadge> : null}
          {c.subjectGone ? <StatusBadge tone="muted">Subject deleted</StatusBadge> : null}
          {c.sample ? <StatusBadge tone="muted">Sample</StatusBadge> : null}
        </>
      }
      actions={actions.length ? <TrustActionBar note="Every decision needs a reason and is recorded in the audit log." actions={actions} /> : undefined}
    >
      <Facts
        items={[
          { label: c.kind === "report" ? "Reported by" : "Sent by", value: c.kind === "report" ? `${c.reporter?.name} (${c.reporter?.kind})` : sideWord(c.side) },
          { label: c.kind === "report" ? "Reported" : "Held", value: <time dateTime={c.createdAt} title={formatDateTime(c.createdAt)}>{relDays(c.createdAt, now)}</time> },
          { label: "Shopper", value: c.customer.name },
          { label: "Brand", value: c.brand.name },
          ...(c.spamScore != null ? [{ label: "Spam score", value: <span className="tabular">{c.spamScore}</span> }] : []),
          ...(c.messageStatus ? [{ label: "Message", value: c.messageStatus === "sent" ? (c.kind === "held" ? "Released" : "Delivered") : (statusMeta[c.messageStatus]?.label ?? c.messageStatus) }] : []),
        ]}
      />

      {c.kind === "report" ? (
        <DetailSection title="Evidence" aside={<span className="text-[11px] text-ink-3">Frozen when it was reported</span>}>
          {ev ? (
            <div className="grid gap-2">
              {evDetails ? (
                <p className="text-[12.5px] text-ink-2">
                  <span className="text-ink-3">The reporter&apos;s note: </span>
                  {evDetails}
                </p>
              ) : null}
              <Evidence evidence={ev} />
            </div>
          ) : (
            <div className={cn("grid gap-2.5 p-3", insetClass)}>
              <p className="text-[12.5px] text-ink-2">
                {c.subjectGone ? "The reported conversation has since been deleted; the snapshot frozen at the report is kept. " : ""}The messages around the report, as the reporter saw them, and the reporter&apos;s note. Opening them is recorded in the audit log with your name.
              </p>
              {reason("messages.view_reports") ? (
                <p className="text-[12px] text-ink-3">{reason("messages.view_reports")}.</p>
              ) : (
                <Button type="button" size="sm" variant="secondary" className="h-10 justify-self-start sm:h-9" loading={openEvidence.pending} onClick={() => void openEvidence.run(c.id)}>
                  <EyeIcon aria-hidden /> View evidence
                </Button>
              )}
              {openEvidence.error ? <p role="alert" className="text-[12px] text-danger">{openEvidence.error}</p> : null}
            </div>
          )}
        </DetailSection>
      ) : null}

      {c.kind === "held" ? (
        <DetailSection title="Held message">
          {heldMsg ? (
            <div className="grid gap-2">
              <EvidenceBubble m={heldMsg} />
              <p className="text-[11.5px] text-ink-3">Held because: {heldMsg.heldReasonLabel.toLowerCase()}. Only this message is shown; the rest of the conversation stays private.</p>
            </div>
          ) : c.status !== "held" ? (
            <EmptyLine>
              {c.status === "sent"
                ? `Released: it was delivered to ${c.side === "brand" ? c.customer.name : c.brand.name}, so its text isn't shown here any more.`
                : "This message isn't held any more, so its text isn't shown here."}
            </EmptyLine>
          ) : (
            <div className={cn("grid gap-2.5 p-3", insetClass)}>
              <p className="text-[12.5px] text-ink-2">The held message is the evidence. Opening it is recorded in the audit log with your name.</p>
              {reason("messages.view_reports") ? (
                <p className="text-[12px] text-ink-3">{reason("messages.view_reports")}.</p>
              ) : (
                <Button type="button" size="sm" variant="secondary" className="h-10 justify-self-start sm:h-9" loading={openHeld.pending} onClick={() => void openHeld.run(c.messageId!)}>
                  <EyeIcon aria-hidden /> View held message
                </Button>
              )}
              {openHeld.error ? <p role="alert" className="text-[12px] text-danger">{openHeld.error}</p> : null}
            </div>
          )}
        </DetailSection>
      ) : null}

      {c.kind === "held" && c.status === "held" && c.blockers?.length ? (
        <DetailSection title="Release is off" className={sheetTrack}>
          <ul className="grid gap-1.5 text-[12.5px] text-ink-2">
            {c.blockers.map((b) => (
              <li key={b} className="flex items-start gap-2">
                <ProhibitIcon className="mt-0.5 size-3.5 shrink-0 text-ink-3" aria-hidden />
                {b}
              </li>
            ))}
          </ul>
          <p className="text-[11.5px] text-ink-3">Releasing delivers the message as if it had just been sent, so Yard refuses it while a send would be refused. Remove the message or leave it held.</p>
        </DetailSection>
      ) : null}

      {c.kind === "spam" ? (
        <DetailSection title="Signal">
          <EmptyLine>{c.status === "confirmed" ? `${c.brand.name} marked this conversation as spam. Brands' marks only count towards an abuse alert when they come from people who share no brand.` : "Yard's spam rules suspect this conversation."} Messages aren&apos;t shown for spam signals.</EmptyLine>
        </DetailSection>
      ) : null}

      <RelatedLinks
        links={[
          !!c.customer.id && { href: `/admin/users?tab=abuse&case=${encodeURIComponent(c.customer.id)}`, label: `${c.customer.name}'s abuse signals`, hint: "Spam marks, holds, restrictions" },
          !!c.brand.handle && { href: `/admin/brands?review=app_${encodeURIComponent(c.brand.handle ?? "")}`, label: c.brand.name, hint: "Brand review and status" },
        ]}
      />

      <DetailSection title="Activity" className={sheetTrack}>
        <ServerActivity subjectIds={[c.id, c.messageId ?? "", c.conversationId]} extra={[{ at: c.createdAt, label: c.kind === "report" ? "Report received" : c.kind === "held" ? "Held by Yard's spam rules" : "Spam signal raised" }]} />
      </DetailSection>
    </DetailSheet>
  )
}

function Evidence({ evidence }: { evidence: EvidenceDto }) {
  if (evidence.kind === "record")
    return (
      <blockquote className="grid gap-1.5 rounded-[10px] border-l-2 border-violet/60 bg-white/[0.02] px-3 py-2.5 text-[13px] text-ink-2">
        {evidence.fields.map((f) => (
          <p key={f.label}>
            <span className="text-ink-3">{f.label}: </span>
            {f.value}
          </p>
        ))}
      </blockquote>
    )
  if (!evidence.messages.length) return <EmptyLine>The snapshot holds no messages.</EmptyLine>
  const only = evidence.messages.length === 1
  return (
    <blockquote aria-label="Messages around the report" className="grid gap-2 rounded-[10px] border-l-2 border-violet/60 bg-white/[0.02] p-3">
      {evidence.messages.map((m) => (
        <EvidenceBubble key={m.id} m={m} />
      ))}
      {evidence.note ? <p className="text-[11.5px] text-ink-3">{evidence.note}</p> : null}
      {only && !evidence.note ? <p className="text-[11.5px] text-ink-3">The reporter could see no other messages in this conversation when they reported it.</p> : null}
    </blockquote>
  )
}

function EvidenceBubble({ m }: { m: EvidenceMessage }) {
  const right = m.side === "brand"
  return (
    <div className={cn("grid max-w-[88%] gap-1", right ? "justify-self-end" : "justify-self-start", m.side === "system" && "max-w-full justify-self-center")}>
      <p className={cn("text-[11px] text-ink-3", right && "text-right")}>
        {m.sender}
        {m.at ? `, ${formatDateTime(m.at)}` : ""}
        {m.reported ? <span className="ml-1.5 font-medium text-ink">Reported</span> : null}
      </p>
      <div className={cn("rounded-[12px] border px-3 py-2 text-[13px] leading-snug", m.reported ? "border-white/35 bg-white/[0.06] text-ink" : "border-white/[0.07] bg-white/[0.03] text-ink-2")}>
        {m.body ? <p className="whitespace-pre-wrap break-words">{m.body}</p> : null}
        {m.product ? <p className="text-[12px] text-ink-3">Product card: {m.product}</p> : null}
        {m.order ? <p className="text-[12px] text-ink-3">Order card: {m.order}</p> : null}
        {m.attachments.length ? (
          <p className="mt-1 flex flex-wrap gap-1.5 text-[12px]">
            {m.attachments.map((a, i) => (
              <a key={a.mediaId} href={a.src} target="_blank" rel="noreferrer" className="inline-flex min-h-8 items-center gap-1 text-violet hover:underline">
                Attachment {i + 1} <ArrowUpRightIcon className="size-3" aria-hidden />
              </a>
            ))}
          </p>
        ) : null}
        {!m.body && !m.product && !m.order && !m.attachments.length ? <p className="text-[12px] text-ink-3">{m.status === "removed" ? "Removed by Yard" : "No text"}</p> : null}
      </div>
    </div>
  )
}
