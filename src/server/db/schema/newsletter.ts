import { boolean, index, integer, pgTable, primaryKey, text } from "drizzle-orm/pg-core"
import { NEWSLETTER_AUDIENCES, NEWSLETTER_KINDS, NEWSLETTER_RECIPIENT_STATUSES, NEWSLETTER_STATUSES } from "../../../lib/api/contracts/enums"
import { brands } from "./brands"
import { oneOf, raw, tz } from "./columns"
import { users } from "./people"

/**
 * Admin › Newsletter (docs/NEWSLETTER.md). A campaign is written as a draft (autosaved), then
 * scheduled (now or later). The newsletter job (src/server/newsletter) freezes its audience into
 * newsletter_recipients when it starts, and feeds the existing email outbox a bounded batch each
 * minute; the outbox dedupe key `newsletter:{campaign}:{user}` makes every hand-off idempotent.
 * Content is not copied into outbox rows: they carry the campaign id and the delivery worker
 * reads the (frozen) campaign at send time.
 */
export const newsletterCampaigns = pgTable(
  "newsletter_campaigns",
  {
    id: text("id").primaryKey(),
    status: text("status").notNull().default("draft"),
    /** marketing: people who opted in to news and offers; service: everyone (policy and service changes, never promotions). */
    kind: text("kind").notNull().default("marketing"),
    /** An internal name for the list (defaults to the subject). */
    name: text("name").notNull().default(""),
    subject: text("subject").notNull().default(""),
    preheader: text("preheader").notNull().default(""),
    heading: text("heading").notNull().default(""),
    /** The message, in the composer's small Markdown (paragraphs, **bold**, [links](url), "- " bullets). */
    body: text("body").notNull().default(""),
    /** Start with "Hey {first name}," when the recipient has a name. */
    greet: boolean("greet").notNull().default(true),
    heroMediaId: text("hero_media_id"),
    heroAlt: text("hero_alt").notNull().default(""),
    buttonLabel: text("button_label").notNull().default(""),
    buttonUrl: text("button_url").notNull().default(""),
    audience: text("audience").notNull().default("shoppers"),
    audienceBrandId: text("audience_brand_id").references(() => brands.id),
    audienceCountry: text("audience_country"),
    /** Bumped by every save; a stale autosave (another tab) is refused. */
    revision: integer("revision").notNull().default(1),
    scheduledFor: tz("scheduled_for"),
    /** The key of the Send request that scheduled it, so a retried Send changes nothing. */
    sendKey: text("send_key"),
    /** The count the admin confirmed ("This will send to N people"). */
    confirmedCount: integer("confirmed_count"),
    startedAt: tz("started_at"),
    finishedAt: tz("finished_at"),
    cancelledAt: tz("cancelled_at"),
    /** Recipients frozen when sending started. */
    recipientsTotal: integer("recipients_total").notNull().default(0),
    createdBy: text("created_by").references(() => users.id),
    createdByName: text("created_by_name"),
    updatedBy: text("updated_by").references(() => users.id),
    updatedByName: text("updated_by_name"),
    sentByName: text("sent_by_name"),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("newsletter_campaigns_status_ix").on(t.status, t.scheduledFor),
    index("newsletter_campaigns_updated_ix").on(t.updatedAt.desc()),
    oneOf("newsletter_campaigns_status_ck", "status", NEWSLETTER_STATUSES),
    oneOf("newsletter_campaigns_kind_ck", "kind", NEWSLETTER_KINDS),
    oneOf("newsletter_campaigns_audience_ck", "audience", NEWSLETTER_AUDIENCES),
  ],
)

/**
 * Who a campaign goes to, frozen when it starts sending (one row per account, so nobody gets it
 * twice). `status` follows the outbox row (dedupe_key) once it is queued; `unsubscribed_at` is set
 * when the person unsubscribed from this campaign's link.
 */
export const newsletterRecipients = pgTable(
  "newsletter_recipients",
  {
    campaignId: text("campaign_id")
      .notNull()
      .references(() => newsletterCampaigns.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name").notNull().default(""),
    status: text("status").notNull().default("pending"),
    dedupeKey: text("dedupe_key").notNull(),
    lastError: text("last_error"),
    queuedAt: tz("queued_at"),
    sentAt: tz("sent_at"),
    unsubscribedAt: tz("unsubscribed_at"),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.campaignId, t.userId], name: "newsletter_recipients_pk" }),
    index("newsletter_recipients_status_ix").on(t.campaignId, t.status),
    index("newsletter_recipients_email_ix").on(raw("lower(email)")),
    oneOf("newsletter_recipients_status_ck", "status", NEWSLETTER_RECIPIENT_STATUSES),
  ],
)
