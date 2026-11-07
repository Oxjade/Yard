import { index, integer, pgTable, text } from "drizzle-orm/pg-core"
import { MEDIA_MIMES, MEDIA_MODERATION, MEDIA_OWNER_KINDS, MEDIA_PURPOSES, MEDIA_SOURCES, MEDIA_VISIBILITIES } from "../../../lib/api/contracts/enums"
import { brands } from "./brands"
import { oneOf, raw, tz } from "./columns"
import { conversations } from "./inbox"
import { users } from "./people"

/**
 * Every stored media file (§3.2, §5.4). `visibility` and `unreferenced_at` are derived by
 * media.refreshVisibility and are never set from a request. `storage_path` is relative to ${dataDir}/<env>/uploads, except for
 * sample rows, which carry a /media/… public path.
 */
export const mediaAssets = pgTable(
  "media_assets",
  {
    id: text("id").primaryKey(),
    ownerKind: text("owner_kind").notNull(),
    ownerId: text("owner_id").notNull(),
    brandId: text("brand_id").references(() => brands.id),
    conversationId: text("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    targetBrandId: text("target_brand_id").references(() => brands.id),
    purpose: text("purpose").notNull(),
    mime: text("mime").notNull(),
    ext: text("ext").notNull(),
    bytes: integer("bytes").notNull(),
    width: integer("width"),
    height: integer("height"),
    durationMs: integer("duration_ms"),
    sha256: text("sha256").notNull(),
    storagePath: text("storage_path").notNull(),
    visibility: text("visibility").notNull().default("private"),
    moderationStatus: text("moderation_status").notNull().default("ok"),
    source: text("source").notNull(),
    createdBy: text("created_by").references(() => users.id),
    createdAt: tz("created_at").notNull().defaultNow(),
    attachedAt: tz("attached_at"),
    /**
     * When nothing (a post of any visibility, a place, an event, an account avatar) referenced the
     * file any more, as of the last refreshVisibility; null while referenced or never used. The
     * purge deletes post and place media 7 days after this (F2 checkpoint, 0002_f2_checkpoint).
     */
    unreferencedAt: tz("unreferenced_at"),
  },
  (t) => [
    index("media_assets_brand_purpose_ix").on(t.brandId, t.purpose),
    index("media_assets_conversation_ix").on(t.conversationId),
    index("media_assets_sha256_ix").on(t.sha256),
    index("media_assets_unattached_ix").on(t.purpose, t.createdAt).where(raw("attached_at is null")),
    oneOf("media_assets_owner_kind_ck", "owner_kind", MEDIA_OWNER_KINDS),
    oneOf("media_assets_purpose_ck", "purpose", MEDIA_PURPOSES),
    oneOf("media_assets_mime_ck", "mime", MEDIA_MIMES),
    oneOf("media_assets_visibility_ck", "visibility", MEDIA_VISIBILITIES),
    oneOf("media_assets_moderation_ck", "moderation_status", MEDIA_MODERATION),
    oneOf("media_assets_source_ck", "source", MEDIA_SOURCES),
  ],
)
