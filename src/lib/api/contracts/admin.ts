import { z } from "zod"
import { auditEntryDto, CONTROL_CHARS, isoDate } from "./common"
import { COMPLAINT_KINDS, HOLIDAY_KINDS, MESSAGE_STATUSES, REPORTER_KINDS, RESTRICTION_KINDS } from "./enums"

/**
 * Admin contracts (§8, cluster M). Decisions return the entity's DTO plus their audit entry,
 * never a row. Rows in the message queues never carry a message body: bodies appear only in the
 * audited evidence and held-message views (POST).
 */

/**
 * Free text an admin writes that other people read: the reason (audit log, CSV export, and the
 * "Reason: …" line of brand and shopper notifications), a resolution, a holiday name. The shared rule
 * of contracts/common.ts (no control characters; no line breaks in a one-line field), plus bidi
 * controls and zero-width characters stripped first, as I's cleanBody does for message bodies.
 */
const INVISIBLE_TEXT = /[\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g
const LINE_BREAKS = /[\r\n\t]/
const shownText = (o: { min: number; max: number; short: string; long: string; line?: boolean }) =>
  z
    .string()
    .transform((v) => v.replace(INVISIBLE_TEXT, "").trim())
    .pipe(
      z
        .string()
        .min(o.min, { error: o.short })
        .max(o.max, { error: o.long })
        .refine((v) => !CONTROL_CHARS.test(v) && (!o.line || !LINE_BREAKS.test(v)), { error: "Remove the hidden characters." }),
    )
const reason = shownText({ min: 8, max: 500, short: "Give a reason of at least 8 characters.", long: "Keep the reason to 500 characters." })
export const decisionBase = z.object({ id: z.string().min(1).max(80), reason })

/** A real calendar date (2027-13-45 and 0000-00-00 are refused), from a year ago to two years ahead. */
const DAY_MS = 86_400_000
export const holidayDate = isoDate.refine(
  (v) => {
    const [y, m, d] = v.split("-").map(Number)
    const t = Date.UTC(y, m - 1, d)
    if (new Date(t).toISOString().slice(0, 10) !== v) return false
    const now = Date.now()
    return t >= now - 366 * DAY_MS && t <= now + 2 * 366 * DAY_MS
  },
  { error: "Use a real date from a year ago to two years ahead, like 2026-12-25." },
)

/* ── Shared pieces ─────────────────────────────────────────────────── */

export const brandRef = z.object({ id: z.string(), name: z.string(), handle: z.string().nullable() })
export type BrandRef = z.infer<typeof brandRef>
export const personRef = z.object({ id: z.string(), name: z.string() })
export type PersonRef = z.infer<typeof personRef>

export const reportRef = z.object({
  id: z.string(),
  reason: z.string(),
  reasonLabel: z.string(),
  status: z.enum(["open", "in_review", "actioned", "dismissed", "escalated"]),
  reporter: z.object({ kind: z.enum(REPORTER_KINDS), id: z.string(), name: z.string() }),
  createdAt: z.string(),
  /** Other open reports on the same subject. */
  others: z.number(),
})
export type ReportRef = z.infer<typeof reportRef>

/* ── Queue counts ──────────────────────────────────────────────────── */

export const queueCountsDto = z.object({
  messages: z.number().optional(),
  content: z.number().optional(),
  places: z.number().optional(),
  charts: z.number().optional(),
  delivery: z.number().optional(),
  abuse: z.number().optional(),
})
export type QueueCountsDto = z.infer<typeof queueCountsDto>

/* ── Messages ──────────────────────────────────────────────────────── */

export const MESSAGE_TABS = ["reported", "held", "spam", "closed"] as const
export type MessageTab = (typeof MESSAGE_TABS)[number]
export const messagesQuery = z.object({ tab: z.enum(MESSAGE_TABS).default("reported"), cursor: z.string().max(200).optional() })

/** One row of Admin › Messages. Metadata only: there is no body here, by design (§8.1). */
export const messageCaseDto = z.object({
  id: z.string(),
  kind: z.enum(["report", "held", "spam"]),
  /** Report: open | in_review | escalated | actioned | dismissed. Held: held | sent | removed. Spam: suspected | confirmed. */
  status: z.string(),
  reason: z.string().nullable(),
  reasonLabel: z.string(),
  /** The sending side of the held or reported message. */
  side: z.enum(["customer", "brand", "system"]).nullable(),
  subjectType: z.enum(["message", "conversation"]).nullable(),
  reporter: z.object({ kind: z.enum(REPORTER_KINDS), id: z.string(), name: z.string() }).nullable(),
  brand: brandRef,
  customer: personRef,
  conversationId: z.string(),
  messageId: z.string().nullable(),
  messageStatus: z.enum(MESSAGE_STATUSES).nullable(),
  conversationLocked: z.boolean(),
  spamScore: z.number().nullable(),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
  decision: z.string().nullable(),
  sample: z.boolean(),
  /** The reported message or conversation no longer exists (deleted since; the frozen evidence stays). */
  subjectGone: z.boolean(),
  /**
   * Held messages only: why Release would be refused right now (the conversation is locked, a block
   * either way, the brand's status, the sender's suspension or messaging restriction). Empty when it can go.
   */
  blockers: z.array(z.string()).optional(),
})
export type MessageCaseDto = z.infer<typeof messageCaseDto>

export const messageCountsDto = z.object({ reported: z.number(), held: z.number(), spam: z.number(), closed: z.number() })
export const messageListDto = z.object({ tab: z.enum(MESSAGE_TABS), items: z.array(messageCaseDto), counts: messageCountsDto, nextCursor: z.string().nullable() })
export type MessageListDto = z.infer<typeof messageListDto>

export const evidenceMessage = z.object({
  id: z.string(),
  side: z.enum(["customer", "brand", "system"]),
  sender: z.string(),
  kind: z.string(),
  body: z.string().nullable(),
  at: z.string().nullable(),
  /** The message the report is about. */
  reported: z.boolean(),
  status: z.string().nullable(),
  attachments: z.array(z.object({ mediaId: z.string(), src: z.string() })),
  product: z.string().nullable(),
  order: z.string().nullable(),
})
export type EvidenceMessage = z.infer<typeof evidenceMessage>

export const evidenceDto = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("messages"), messages: z.array(evidenceMessage), note: z.string().nullable() }),
  z.object({
    kind: z.literal("record"),
    title: z.string(),
    fields: z.array(z.object({ label: z.string(), value: z.string() })),
    media: z.array(z.object({ src: z.string(), alt: z.string() })),
  }),
])
export type EvidenceDto = z.infer<typeof evidenceDto>

/** `details`: the reporter's own note, if they wrote one (shown with the evidence, never in queue rows). */
export const evidenceResult = z.object({ reportId: z.string(), capturedAt: z.string(), details: z.string().nullable(), evidence: evidenceDto, audit: auditEntryDto })
export type EvidenceResult = z.infer<typeof evidenceResult>
export const heldViewResult = z.object({ message: evidenceMessage.extend({ heldReason: z.string().nullable(), heldReasonLabel: z.string() }), audit: auditEntryDto })
export type HeldViewResult = z.infer<typeof heldViewResult>

/* ── Content: posts, uploads, places, integrations ─────────────────── */

export const CONTENT_TABS = ["posts", "uploads", "places", "integrations"] as const
export type ContentTab = (typeof CONTENT_TABS)[number]
export const contentQuery = z.object({ tab: z.enum(CONTENT_TABS).default("posts"), cursor: z.string().max(200).optional() })

export const adminMedia = z.object({ src: z.string(), alt: z.string(), kind: z.enum(["image", "video"]), poster: z.string().nullable() })
export const contentPostDto = z.object({
  id: z.string(),
  brand: brandRef,
  source: z.string(),
  kind: z.string(),
  caption: z.string(),
  permalink: z.string().nullable(),
  media: z.array(adminMedia),
  visibility: z.string(),
  moderationStatus: z.enum(["ok", "flagged", "removed"]),
  removedReason: z.string().nullable(),
  postedAt: z.string(),
  sample: z.boolean(),
  report: reportRef.nullable(),
  /** Every report about the post, open or closed, newest first (for its history). */
  reportIds: z.array(z.string()),
})
export type ContentPostDto = z.infer<typeof contentPostDto>

export const placeEventDto = z.object({
  id: z.string(),
  locationId: z.string(),
  title: z.string(),
  kind: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  promo: z.string().nullable(),
  description: z.string().nullable(),
  visibility: z.string(),
  moderationStatus: z.enum(["approved", "pending_review", "rejected", "removed"]),
  moderationReason: z.string().nullable(),
  sample: z.boolean(),
  report: reportRef.nullable(),
  reportIds: z.array(z.string()),
})
export type PlaceEventDto = z.infer<typeof placeEventDto>

export const placeDto = z.object({
  id: z.string(),
  brand: brandRef.extend({ verified: z.boolean() }),
  name: z.string(),
  kind: z.string(),
  address: z.string(),
  neighbourhood: z.string().nullable(),
  city: z.string(),
  country: z.string(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  description: z.string().nullable(),
  image: z.object({ src: z.string(), alt: z.string() }).nullable(),
  visibility: z.string(),
  moderationStatus: z.enum(["approved", "pending_review", "rejected", "removed"]),
  moderationReason: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  sample: z.boolean(),
  report: reportRef.nullable(),
  reportIds: z.array(z.string()),
  events: z.array(placeEventDto),
})
export type PlaceDto = z.infer<typeof placeDto>

export const integrationDto = z.object({
  id: z.string(),
  brand: brandRef,
  provider: z.enum(["instagram", "tiktok"]),
  mode: z.enum(["live", "sandbox"]),
  handle: z.string().nullable(),
  status: z.string(),
  statusDetail: z.string().nullable(),
  lastErrorCode: z.string().nullable(),
  connectedAt: z.string(),
  lastSyncAt: z.string().nullable(),
  nextSyncAfter: z.string().nullable(),
  tokenExpiresAt: z.string().nullable(),
  /** Yard paused social for this brand (an active social_disabled restriction). */
  paused: z.boolean(),
})
export type IntegrationDto = z.infer<typeof integrationDto>

export const socialPauseDto = z.object({ restrictionId: z.string(), brand: brandRef, since: z.string(), reason: z.string() })
export const providerSetupDto = z.object({ provider: z.enum(["instagram", "tiktok"]), configured: z.boolean(), envVars: z.array(z.string()), redirectUri: z.string() })
export const integrationsSetupDto = z.object({ providers: z.array(providerSetupDto), sandboxEnabled: z.boolean() })

export const contentCountsDto = z.object({ posts: z.number(), uploads: z.number(), places: z.number(), integrations: z.number() })
export const contentListDto = z.discriminatedUnion("tab", [
  z.object({ tab: z.literal("posts"), posts: z.array(contentPostDto), counts: contentCountsDto }),
  z.object({ tab: z.literal("uploads"), posts: z.array(contentPostDto), counts: contentCountsDto }),
  z.object({ tab: z.literal("places"), places: z.array(placeDto), counts: contentCountsDto }),
  z.object({ tab: z.literal("integrations"), integrations: z.array(integrationDto), paused: z.array(socialPauseDto), setup: integrationsSetupDto, counts: contentCountsDto }),
])
export type ContentListDto = z.infer<typeof contentListDto>

/* ── Charts ────────────────────────────────────────────────────────── */

export const chartBoardHealthDto = z.object({
  chart: z.string(),
  label: z.string(),
  cohort: z.number().nullable(),
  edition: z.string().nullable(),
  totalEvents: z.number(),
  excludedEvents: z.number(),
  excludedShare: z.number(),
  openFlags: z.number(),
})
/** One open high-severity flag that holds a brand from the public boards (auto-action held_from_charts). */
export const chartHoldFlagDto = z.object({ id: z.string(), detector: z.string(), detectorLabel: z.string(), windowStart: z.string(), windowEnd: z.string(), excludedEvents: z.number() })
/**
 * A brand held from every public board. C's rule (not changed here): a brand is held while ANY open
 * high-severity flag holds it, so every flag listed must be cleared or confirmed before it returns.
 */
export const chartHoldDto = z.object({ brand: brandRef, since: z.string(), flags: z.array(chartHoldFlagDto), frozen: z.boolean() })
export type ChartHoldDto = z.infer<typeof chartHoldDto>

export const chartsOverviewDto = z.object({
  boards: z.array(chartBoardHealthDto),
  /** One row per day for 14 days. excludedShare is null on a day with no signals (drawn as a gap, never as 0 %). */
  daily: z.array(z.object({ date: z.string(), total: z.number(), excludedShare: z.number().nullable(), threshold: z.number() })),
  threshold: z.number(),
  verifiedShare: z.number().nullable(),
  totals: z.object({ counted: z.number(), excluded: z.number(), total: z.number() }),
  surface: z.object({ organic: z.number(), sponsored: z.number() }),
  flags: z.object({ open: z.number(), high: z.number(), frozen: z.number(), pendingFreeze: z.number() }),
  ipSignal: z.enum(["available", "unavailable"]),
  /** YARD_TRUSTED_PROXY_HOPS as the server reads it (0 = client IPs unknown, IP detectors off). */
  proxyHops: z.number(),
  orderSignals: z.literal("not_connected"),
  /** Brands held from every public board by open high-severity flags, with the flags holding each. */
  holds: z.array(chartHoldDto),
  /** The sample baseline is part of every board in this build. */
  sample: z.boolean(),
})
export type ChartsOverviewDto = z.infer<typeof chartsOverviewDto>

export const freezeDto = z.object({
  id: z.string(),
  brand: brandRef,
  status: z.enum(["pending_approval", "active", "lifted", "expired"]),
  until: z.string().nullable(),
  reason: z.string(),
  requestedBy: personRef,
  approvedBy: personRef.nullable(),
  createdAt: z.string(),
  liftedAt: z.string().nullable(),
})
export type FreezeDto = z.infer<typeof freezeDto>


export const chartFlagDto = z.object({
  id: z.string(),
  brand: brandRef,
  detector: z.string(),
  detectorLabel: z.string(),
  severity: z.enum(["low", "medium", "high"]),
  windowStart: z.string(),
  windowEnd: z.string(),
  excludedEvents: z.number(),
  autoAction: z.enum(["none", "excluded_signals", "held_from_charts"]),
  status: z.enum(["open", "cleared", "confirmed", "frozen"]),
  decidedAt: z.string().nullable(),
  createdAt: z.string(),
  freeze: freezeDto.nullable(),
  /**
   * Whether this flag holds its brand from the public boards right now (open and held_from_charts),
   * and the brand's OTHER open flags that hold it too: deciding this one alone doesn't re-list it.
   */
  hold: z.object({ holding: z.boolean(), others: z.array(z.object({ id: z.string(), detectorLabel: z.string() })) }),
  /** coordinated_ring only: the other brands the same ring followed (each flagged and held the same way). */
  ringPeers: z.array(brandRef),
})
export type ChartFlagDto = z.infer<typeof chartFlagDto>

export const chartFlagDetailDto = chartFlagDto.extend({
  /** Counts and ratios only; IP hashes are cut to 8 characters, never raw IPs. */
  evidence: z.array(z.object({ label: z.string(), value: z.string() })),
  components: z.array(z.object({ chart: z.string(), period: z.string(), scope: z.string(), edition: z.string(), rank: z.number(), components: z.record(z.string(), z.number()) })),
})
export type ChartFlagDetailDto = z.infer<typeof chartFlagDetailDto>

export const chartFlagsQuery = z.object({ status: z.enum(["open", "decided", "frozen", "all"]).default("open") })
export const chartFlagsDto = z.object({ items: z.array(chartFlagDto), freezes: z.array(freezeDto), holds: z.array(chartHoldDto), counts: z.object({ open: z.number(), decided: z.number(), frozen: z.number() }) })
export type ChartFlagsDto = z.infer<typeof chartFlagsDto>

export const sponsoredRowDto = z.object({ campaignId: z.string(), name: z.string(), brand: brandRef, status: z.string(), placements: z.array(z.string()), sample: z.boolean() })
export const sponsoredListDto = z.object({ items: z.array(sponsoredRowDto) })
export type SponsoredRowDto = z.infer<typeof sponsoredRowDto>

/* ── Delivery ──────────────────────────────────────────────────────── */

export const DELIVERY_TABS = ["late", "complaints", "exceptions", "resolved", "holidays"] as const
export type DeliveryTab = (typeof DELIVERY_TABS)[number]
export const deliveryQuery = z.object({ tab: z.enum(DELIVERY_TABS).default("late") })

export const range = z.object({ from: z.string().nullable(), to: z.string().nullable() })
export const deliveryIssueDto = z.object({
  /** dc_* for a complaint; the order id for a late order or an exception without one. */
  id: z.string(),
  kind: z.enum(["complaint", "late", "exception"]),
  orderId: z.string(),
  reference: z.string(),
  brand: brandRef,
  customer: personRef,
  city: z.string().nullable(),
  country: z.string(),
  promised: range.nullable(),
  /** The promised ship-by date (the first estimate's). */
  shipBy: z.string().nullable(),
  current: range.extend({ basis: z.string() }).nullable(),
  /** Days past the promise; null when no promise or ship-by is on record, so it can't be measured. */
  daysLate: z.number().nullable(),
  /** Whether a promise (arrival window or ship-by) is on record to measure lateness against. */
  measurable: z.boolean(),
  complaintKind: z.enum(COMPLAINT_KINDS).nullable(),
  details: z.string().nullable(),
  brandResponse: z.string().nullable(),
  resolution: z.string().nullable(),
  status: z.string(),
  shipment: z.string().nullable(),
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
  /** A complaint whose brand reply D's screen held: `brandResponse` is null and the shopper hasn't seen the reply. */
  brandResponseHeld: z.boolean(),
  /** The shopper saw the brand's reply under "Keep payments on Yard". */
  brandResponseNotice: z.boolean(),
  /**
   * The brand's notes on this order, newest first (at most 6, plus any held one): its notes on
   * shipment updates and its complaint replies (status "complaint_reply", id = the complaint's).
   * `held`: D's screen held the text (links or payment outside Yard), so the shopper never saw it, and
   * `text` is null here: it opens through POST /api/admin/delivery/notes/{id}/view (audited,
   * shipping.resolve or messages.view_reports). `notice`: the shopper saw it under "Keep payments on Yard".
   */
  brandNotes: z.array(z.object({ id: z.string(), status: z.string(), at: z.string(), text: z.string().nullable(), held: z.boolean(), notice: z.boolean() })),
  /** How many of those notes are held for review. */
  heldNotes: z.number(),
})
export const heldNoteViewResult = z.object({ id: z.string(), orderId: z.string(), kind: z.enum(["shipment_note", "complaint_reply"]), at: z.string(), text: z.string(), audit: auditEntryDto })
export type HeldNoteViewResult = z.infer<typeof heldNoteViewResult>
export type DeliveryIssueDto = z.infer<typeof deliveryIssueDto>

export const holidayDto = z.object({ id: z.string(), country: z.string(), date: z.string(), name: z.string(), kind: z.enum(HOLIDAY_KINDS), estimated: z.boolean(), source: z.enum(["config", "admin"]) })
export type HolidayDto = z.infer<typeof holidayDto>
export const holidaysQuery = z.object({ country: z.string().regex(/^[A-Z]{2}$/).optional() })

/** late: orders late against a recorded promise (the queue's work); unmeasured: late recomputes with no promise on record. */
export const deliveryCountsDto = z.object({ late: z.number(), unmeasured: z.number(), complaints: z.number(), exceptions: z.number(), resolved: z.number(), holidays: z.number() })
/** On the Late tab, `items` are the measurable late orders and `unmeasured` the rest (sample orders with no promise on record). */
export const deliveryListDto = z.object({ tab: z.enum(DELIVERY_TABS), items: z.array(deliveryIssueDto), unmeasured: z.array(deliveryIssueDto), holidays: z.array(holidayDto), countries: z.array(z.string()), counts: deliveryCountsDto })
export type DeliveryListDto = z.infer<typeof deliveryListDto>

/* ── Abuse and restrictions ────────────────────────────────────────── */

export const restrictionDto = z.object({
  id: z.string(),
  subjectKind: z.enum(["user", "brand"]),
  subjectId: z.string(),
  kind: z.enum(RESTRICTION_KINDS),
  status: z.enum(["pending_approval", "active", "lifted"]),
  until: z.string().nullable(),
  reason: z.string(),
  requestedBy: personRef,
  approvedBy: personRef.nullable(),
  createdAt: z.string(),
  liftedAt: z.string().nullable(),
})
export type RestrictionDto = z.infer<typeof restrictionDto>

export const abuseAlertDto = z.object({
  id: z.string(),
  subjectKind: z.enum(["user", "brand"]),
  subjectId: z.string(),
  kind: z.enum(["spam_marks", "rate_limit_burst", "report_volume"]),
  status: z.enum(["open", "confirmed", "dismissed"]),
  /** Counts and the marking brands only; never message text. */
  summary: z.string(),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
})
export type AbuseAlertDto = z.infer<typeof abuseAlertDto>

export const abuseRowDto = z.object({
  user: z.object({ id: z.string(), name: z.string(), email: z.string(), status: z.enum(["active", "restricted", "suspended"]), kind: z.string(), demo: z.boolean() }),
  rateLimitHits: z.number(),
  heldMessages: z.number(),
  spamMarks: z.number(),
  reportsFiled: z.number(),
  reportsDismissed: z.number(),
  alerts: z.array(abuseAlertDto),
  restrictions: z.array(restrictionDto),
  lastSignalAt: z.string().nullable(),
})
export type AbuseRowDto = z.infer<typeof abuseRowDto>
export const abuseListDto = z.object({ items: z.array(abuseRowDto), windowDays: z.number(), nextCursor: z.string().nullable() })
export type AbuseListDto = z.infer<typeof abuseListDto>
export const restrictionsQuery = z.object({ subject: z.string().max(80).optional() })
export const restrictionsListDto = z.object({ items: z.array(restrictionDto) })

/* ── Audit ─────────────────────────────────────────────────────────── */

export const auditQuery = z.object({
  subjectType: z.string().max(40).optional(),
  /** One id, or up to 24 comma-separated ids (a record's history: a place, its reports and its events). */
  subjectId: z.string().max(2000).optional(),
  actorKind: z.enum(["admin", "brand", "shopper", "system", "all"]).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
})
/** `totals`: on the first page only, how many rows match the filter in all, and how many name a second approver. */
export const auditListResult = z.object({ items: z.array(auditEntryDto), nextCursor: z.string().nullable(), totals: z.object({ entries: z.number(), withApprover: z.number() }).optional() })
export type AuditListResult = z.infer<typeof auditListResult>

/* ── Decisions (POST /api/admin/decisions/{kebab-case}) ────────────── */

const strict = <T extends z.ZodRawShape>(shape: T) => decisionBase.extend(shape).strict()
const optionalReport = z.string().max(80).optional()

export const decisionBodies = {
  "decide-report": strict({ outcome: z.enum(["dismiss", "escalate"]) }),
  "remove-message": strict({ reportId: optionalReport }),
  "release-held-message": strict({}),
  "lock-conversation": strict({ reportId: optionalReport }),
  "set-post-moderation": strict({ action: z.enum(["hide", "remove", "restore"]), reportId: optionalReport }),
  "set-place-moderation": strict({ action: z.enum(["approve", "reject", "remove", "restore"]), reportId: optionalReport }),
  "set-event-moderation": strict({ action: z.enum(["approve", "hide", "remove"]), reportId: optionalReport }),
  "retry-social-sync": strict({}),
  "force-disconnect-social": strict({}),
  "set-social-paused": strict({ paused: z.boolean() }),
  "decide-chart-flag": strict({ outcome: z.enum(["clear", "confirm"]) }),
  "recompute-charts": strict({}),
  "request-chart-freeze": strict({ days: z.union([z.literal(7), z.literal(14), z.literal(30)]), flagId: z.string().max(80).optional() }),
  "approve-chart-freeze": strict({}),
  "lift-chart-freeze": strict({}),
  "contact-brand-about-delivery": strict({}),
  "resolve-delivery-issue": strict({ resolution: shownText({ min: 8, max: 500, short: "Describe the resolution in at least 8 characters.", long: "Keep the resolution to 500 characters." }) }),
  "escalate-delivery-issue": strict({}),
  "add-holiday": strict({ date: holidayDate, name: shownText({ min: 2, max: 80, short: "Name the holiday.", long: "Keep the name to 80 characters.", line: true }), kind: z.enum(HOLIDAY_KINDS).default("public"), estimated: z.boolean().default(false) }),
  "remove-holiday": strict({}),
  "set-user-status": strict({ status: z.enum(["active", "restricted", "suspended"]) }),
  "add-restriction": strict({ subjectKind: z.enum(["user", "brand"]).default("user"), kind: z.enum(["messaging", "uploads", "reports"]), duration: z.enum(["24h", "7d", "30d"]), alertId: z.string().max(80).optional() }),
  "lift-restriction": strict({}),
  /** "reinstate" restores the status the brand had before its restriction or suspension (the server reads it from the audit log; unknown → pending_review). */
  "set-brand-status": strict({ status: z.enum(["pending_review", "verified", "restricted", "suspended", "reinstate"]) }),
  "dismiss-abuse-alert": strict({}),
  /** The server builds the CSV and counts the rows itself (no client count): exact ids, or filters. */
  "export-audit": z
    .object({
      id: z.literal("audit_log"),
      ids: z.array(z.string().min(1).max(80)).max(2000).optional(),
      actorKind: z.enum(["admins", "all"]).optional(),
      actor: z.string().max(120).optional(),
      action: z.string().max(120).optional(),
      reason: shownText({ min: 0, max: 500, short: "", long: "Keep the reason to 500 characters." }).optional(),
    })
    .strict(),
} as const
export type DecisionKey = keyof typeof decisionBodies
export type DecisionBody<K extends DecisionKey> = z.input<(typeof decisionBodies)[K]>

export const decisionResult = z.object({ item: z.unknown(), audit: auditEntryDto })
export type DecisionResult<T = unknown> = { item: T; audit: z.infer<typeof auditEntryDto> }

/** Older names kept for importers of the F1 draft. */
export const setUserStatusBody = decisionBodies["set-user-status"]
export const setBrandStatusBody = decisionBodies["set-brand-status"]

/* ── Labels shared by the server DTOs and the admin UI ─────────────── */

const human = (s: string) => (s.charAt(0).toUpperCase() + s.slice(1)).replace(/_/g, " ")

export const heldReasonLabels: Record<string, string> = {
  spam_duplicate: "Same text sent to several brands",
  spam_links: "Several links",
  spam_offplatform: "Payment outside Yard",
  spam_brand_offplatform: "Brand asked for payment outside Yard",
  spam_marked_by_brand: "Sender has an open spam alert",
  new_account: "New account",
  burst: "Many messages at once",
}
export const heldReasonLabel = (r: string | null | undefined) => (r ? (heldReasonLabels[r] ?? human(r)) : "Held for review")

export const detectorLabels: Record<string, string> = {
  velocity_spike: "Velocity spike",
  ip_concentration: "IP concentration",
  new_account_share: "New-account share",
  self_engagement: "Self-engagement",
  wishlist_churn: "Wishlist churn",
  order_anomaly: "Order anomaly",
  coordinated_ring: "Coordinated ring",
}
export const detectorLabel = (d: string) => detectorLabels[d] ?? human(d)

export const chartBoardLabels: Record<string, string> = {
  top: "Top brands",
  trending: "Trending brands",
  emerging: "Emerging brands",
  most_followed: "Most followed",
  most_wishlisted: "Most wishlisted",
  top_drops: "Top drops",
  city: "City charts",
}

export const complaintKindLabels: Record<(typeof COMPLAINT_KINDS)[number], string> = {
  late: "Late",
  not_received: "Not received",
  damaged: "Damaged",
  wrong_item: "Wrong item",
  wrong_address: "Wrong address",
  other: "Something else",
}

export const restrictionKindLabels: Record<(typeof RESTRICTION_KINDS)[number], string> = {
  messaging: "Messaging",
  uploads: "Uploads",
  reports: "Reports",
  social_disabled: "Social feed",
  charts_freeze: "Charts",
}

export const abuseAlertKindLabels: Record<string, string> = { spam_marks: "Spam marks from brands", rate_limit_burst: "Rate-limit burst", report_volume: "Report volume" }

export const durationLabels = { "24h": "24 hours", "7d": "7 days", "30d": "30 days" } as const
