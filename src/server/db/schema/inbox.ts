import { boolean, check, index, integer, jsonb, pgTable, primaryKey, smallint, text, uniqueIndex } from "drizzle-orm/pg-core"
import {
  BLOCKED_KINDS,
  BLOCKER_KINDS,
  CONVERSATION_ORIGINS,
  CONVERSATION_STATUSES,
  CONVERSATION_TOPICS,
  MESSAGE_KINDS,
  MESSAGE_SIDES,
  MESSAGE_STATUSES,
  PARTICIPANT_SIDES,
  SPAM_STATES,
} from "../../../lib/api/contracts/enums"
import { brands } from "./brands"
import { oneOf, raw, tsvector, tz } from "./columns"
import { mediaAssets } from "./media"
import { orderRefs } from "./orders"
import { users } from "./people"

/** One conversation per (brand, shopper) pair (§3.3, §6.2). */
export const conversations = pgTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id),
    customerId: text("customer_id")
      .notNull()
      .references(() => users.id),
    status: text("status").notNull().default("open"),
    spamState: text("spam_state").notNull().default("none"),
    locked: boolean("locked").notNull().default(false),
    origin: text("origin").notNull(),
    originRef: text("origin_ref"),
    topic: text("topic"),
    lastMessageSeq: integer("last_message_seq").notNull().default(0),
    lastMessageAt: tz("last_message_at"),
    lastPreview: text("last_preview").notNull().default(""),
    createdAt: tz("created_at").notNull().defaultNow(),
    resolvedAt: tz("resolved_at"),
    resolvedBy: text("resolved_by").references(() => users.id),
    sample: boolean("sample").notNull().default(false),
  },
  (t) => [
    uniqueIndex("conversations_brand_customer_ux").on(t.brandId, t.customerId),
    index("conversations_brand_list_ix").on(t.brandId, t.status, t.lastMessageAt.desc()),
    index("conversations_customer_list_ix").on(t.customerId, t.lastMessageAt.desc()),
    oneOf("conversations_status_ck", "status", CONVERSATION_STATUSES),
    oneOf("conversations_spam_state_ck", "spam_state", SPAM_STATES),
    oneOf("conversations_origin_ck", "origin", CONVERSATION_ORIGINS),
    check("conversations_topic_ck", raw(`topic is null or topic in (${CONVERSATION_TOPICS.map((v) => `'${v}'`).join(", ")})`)),
    check("conversations_preview_len_ck", raw("length(last_preview) <= 140")),
  ],
)

export const conversationParticipants = pgTable(
  "conversation_participants",
  {
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    side: text("side").notNull(),
    /** users.id for the customer, brands.id for the brand. */
    partyId: text("party_id").notNull(),
    lastReadSeq: integer("last_read_seq").notNull().default(0),
    lastReadAt: tz("last_read_at"),
    unreadCount: integer("unread_count").notNull().default(0),
    markedUnread: boolean("marked_unread").notNull().default(false),
    archived: boolean("archived").notNull().default(false),
    muted: boolean("muted").notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.conversationId, t.side], name: "conversation_participants_pk" }),
    index("conversation_participants_party_ix").on(t.partyId, t.side),
    oneOf("conversation_participants_side_ck", "side", PARTICIPANT_SIDES),
  ],
)

export type ProductSnapshot = { slug: string; name: string; image: string; price: { amount: number; currency: string }; variantLabel?: string; brandId: string }
export type OrderSnapshot = { reference: string; status: string; placedAt: string; total: { amount: number; currency: string }; itemCount: number }

export const messages = pgTable(
  "messages",
  {
    id: text("id").primaryKey(),
    seq: integer("seq").generatedAlwaysAsIdentity().notNull(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    senderSide: text("sender_side").notNull(),
    senderUserId: text("sender_user_id").references(() => users.id),
    kind: text("kind").notNull(),
    body: text("body"),
    productId: text("product_id"),
    variantId: text("variant_id"),
    productSnapshot: jsonb("product_snapshot").$type<ProductSnapshot>(),
    orderRefId: text("order_ref_id").references(() => orderRefs.id),
    orderSnapshot: jsonb("order_snapshot").$type<OrderSnapshot>(),
    quickReplyId: text("quick_reply_id").references(() => quickReplies.id, { onDelete: "set null" }),
    status: text("status").notNull().default("sent"),
    heldReason: text("held_reason"),
    spamScore: smallint("spam_score").notNull().default(0),
    removedBy: text("removed_by"),
    removedReason: text("removed_reason"),
    /** Idempotency key chosen by the sender. */
    clientId: text("client_id").notNull(),
    createdAt: tz("created_at").notNull().defaultNow(),
    searchTsv: tsvector("search_tsv").generatedAlwaysAs(raw("to_tsvector('simple', coalesce(body, ''))")),
  },
  (t) => [
    uniqueIndex("messages_seq_ux").on(t.seq),
    uniqueIndex("messages_client_ux").on(t.conversationId, t.clientId),
    index("messages_conversation_seq_ix").on(t.conversationId, t.seq),
    index("messages_search_gin").using("gin", t.searchTsv),
    index("messages_held_ix").on(t.status).where(raw("status = 'held'")),
    oneOf("messages_sender_side_ck", "sender_side", MESSAGE_SIDES),
    oneOf("messages_kind_ck", "kind", MESSAGE_KINDS),
    oneOf("messages_status_ck", "status", MESSAGE_STATUSES),
    check("messages_body_len_ck", raw("body is null or length(body) <= 2000")),
  ],
)

export const messageAttachments = pgTable(
  "message_attachments",
  {
    id: text("id").primaryKey(),
    messageId: text("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    mediaId: text("media_id")
      .notNull()
      .references(() => mediaAssets.id),
    position: smallint("position").notNull(),
  },
  (t) => [index("message_attachments_message_ix").on(t.messageId)],
)

export const messageReactions = pgTable(
  "message_reactions",
  {
    messageId: text("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    side: text("side").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    emoji: text("emoji").notNull(),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.messageId, t.side], name: "message_reactions_pk" }),
    oneOf("message_reactions_side_ck", "side", PARTICIPANT_SIDES),
    oneOf("message_reactions_emoji_ck", "emoji", ["♥"]),
  ],
)

export const quickReplies = pgTable(
  "quick_replies",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id),
    title: text("title").notNull(),
    body: text("body").notNull(),
    shortcut: text("shortcut"),
    position: integer("position").notNull(),
    usageCount: integer("usage_count").notNull().default(0),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("quick_replies_shortcut_ux").on(t.brandId, t.shortcut).where(raw("shortcut is not null")),
    index("quick_replies_brand_position_ix").on(t.brandId, t.position),
    check("quick_replies_title_len_ck", raw("length(title) between 1 and 40")),
    check("quick_replies_body_len_ck", raw("length(body) between 1 and 1000")),
    check("quick_replies_shortcut_ck", raw("shortcut is null or shortcut ~ '^/[a-z0-9-]{2,20}$'")),
  ],
)

export const blocks = pgTable(
  "blocks",
  {
    id: text("id").primaryKey(),
    blockerKind: text("blocker_kind").notNull(),
    blockerId: text("blocker_id").notNull(),
    blockedKind: text("blocked_kind").notNull(),
    blockedId: text("blocked_id").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    reason: text("reason"),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("blocks_pair_ux").on(t.blockerKind, t.blockerId, t.blockedKind, t.blockedId),
    index("blocks_blocked_ix").on(t.blockedKind, t.blockedId),
    oneOf("blocks_blocker_kind_ck", "blocker_kind", BLOCKER_KINDS),
    oneOf("blocks_blocked_kind_ck", "blocked_kind", BLOCKED_KINDS),
  ],
)
