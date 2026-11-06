import { boolean, check, index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core"
import {
  PUBLISH_VISIBILITIES,
  SOCIAL_ACCOUNT_STATUSES,
  SOCIAL_MODES,
  SOCIAL_POST_KINDS,
  SOCIAL_POST_MODERATION,
  SOCIAL_POST_SOURCES,
  SOCIAL_PROVIDERS,
} from "../../../lib/api/contracts/enums"
import { brands } from "./brands"
import { oneOf, raw, tz } from "./columns"
import { mediaAssets } from "./media"
import { users } from "./people"

/** A connected Instagram or TikTok account (§3.2). Metadata only: tokens live in social_tokens. */
export const socialAccounts = pgTable(
  "social_accounts",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id),
    provider: text("provider").notNull(),
    mode: text("mode").notNull(),
    externalUserId: text("external_user_id").notNull(),
    handle: text("handle"),
    displayName: text("display_name"),
    avatarMediaId: text("avatar_media_id").references(() => mediaAssets.id),
    accountType: text("account_type"),
    scopes: text("scopes").array().notNull().default(raw("'{}'::text[]")),
    status: text("status").notNull(),
    statusDetail: text("status_detail"),
    tokenExpiresAt: tz("token_expires_at"),
    refreshExpiresAt: tz("refresh_expires_at"),
    connectedBy: text("connected_by")
      .notNull()
      .references(() => users.id),
    connectedAt: tz("connected_at").notNull().defaultNow(),
    lastSyncAt: tz("last_sync_at"),
    nextSyncAfter: tz("next_sync_after"),
    lastErrorCode: text("last_error_code"),
    disconnectedAt: tz("disconnected_at"),
  },
  (t) => [
    uniqueIndex("social_accounts_brand_provider_ux").on(t.brandId, t.provider).where(raw("status <> 'disconnected'")),
    index("social_accounts_status_expiry_ix").on(t.status, t.tokenExpiresAt),
    index("social_accounts_external_ix").on(t.provider, t.mode, t.externalUserId),
    oneOf("social_accounts_provider_ck", "provider", SOCIAL_PROVIDERS),
    oneOf("social_accounts_mode_ck", "mode", SOCIAL_MODES),
    oneOf("social_accounts_status_ck", "status", SOCIAL_ACCOUNT_STATUSES),
  ],
)

/** Meta data-deletion requests; `id` is the random confirmation code (§6.1). */
export const socialDataDeletions = pgTable(
  "social_data_deletions",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    externalUserId: text("external_user_id").notNull(),
    status: text("status").notNull().default("received"),
    requestedAt: tz("requested_at").notNull().defaultNow(),
    completedAt: tz("completed_at"),
  },
  () => [oneOf("social_data_deletions_provider_ck", "provider", ["instagram"]), oneOf("social_data_deletions_status_ck", "status", ["received", "completed"])],
)

export type SocialPostMedia = {
  mediaId?: string
  src: string
  alt: string
  width: number
  height: number
  kind: "image" | "video"
  posterMediaId?: string
  posterSrc?: string
}

/**
 * Posts shown in the storefront Social Feed (§3.2). `src` values are built by the server from
 * media ids (/api/media/<id>); only seed rows carry /media/… paths.
 */
export const socialPosts = pgTable(
  "social_posts",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id),
    accountId: text("account_id").references(() => socialAccounts.id, { onDelete: "set null" }),
    source: text("source").notNull(),
    externalId: text("external_id"),
    kind: text("kind").notNull(),
    caption: text("caption").notNull().default(""),
    permalink: text("permalink"),
    embedUrl: text("embed_url"),
    media: jsonb("media").$type<SocialPostMedia[]>().notNull(),
    productIds: text("product_ids").array().notNull().default(raw("'{}'::text[]")),
    postedAt: tz("posted_at").notNull(),
    importedAt: tz("imported_at"),
    upstreamMissingAt: tz("upstream_missing_at"),
    visibility: text("visibility").notNull().default("hidden"),
    featured: boolean("featured").notNull().default(false),
    featureOrder: integer("feature_order"),
    moderationStatus: text("moderation_status").notNull().default("ok"),
    removedReason: text("removed_reason"),
    sample: boolean("sample").notNull().default(false),
    createdBy: text("created_by").references(() => users.id),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("social_posts_external_ux").on(t.brandId, t.source, t.externalId).where(raw("external_id is not null")),
    index("social_posts_public_ix").on(t.brandId, t.visibility, t.moderationStatus, t.postedAt.desc()),
    index("social_posts_featured_ix").on(t.brandId, t.featured, t.featureOrder),
    index("social_posts_products_gin").using("gin", t.productIds),
    oneOf("social_posts_source_ck", "source", SOCIAL_POST_SOURCES),
    oneOf("social_posts_kind_ck", "kind", SOCIAL_POST_KINDS),
    oneOf("social_posts_visibility_ck", "visibility", PUBLISH_VISIBILITIES),
    oneOf("social_posts_moderation_ck", "moderation_status", SOCIAL_POST_MODERATION),
    check("social_posts_caption_len_ck", raw("length(caption) <= 2200")),
    check("social_posts_products_len_ck", raw("coalesce(array_length(product_ids, 1), 0) <= 6")),
    check("social_posts_permalink_ck", raw("permalink is null or permalink ~ '^https://(www\\.)?(instagram|tiktok)\\.com/'")),
    check("social_posts_embed_ck", raw("embed_url is null or embed_url like 'https://www.tiktok.com/embed/%'")),
  ],
)
