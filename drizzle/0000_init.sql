CREATE TABLE "brand_locations" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"address_line" text NOT NULL,
	"neighbourhood" text,
	"city" text NOT NULL,
	"city_slug" text NOT NULL,
	"country" text NOT NULL,
	"in_gazetteer" boolean DEFAULT true NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"pin_precision" text DEFAULT 'area' NOT NULL,
	"tile_key" text GENERATED ALWAYS AS ((floor(lat)::int::text || '_' || floor(lng)::int::text)) STORED,
	"time_zone" text NOT NULL,
	"hours" jsonb,
	"by_appointment" boolean DEFAULT false NOT NULL,
	"hours_note" text,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"images" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"featured_product_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"description" text,
	"visibility" text DEFAULT 'draft' NOT NULL,
	"moderation_status" text DEFAULT 'approved' NOT NULL,
	"moderation_reason" text,
	"reviewed_at" timestamp with time zone,
	"sample" boolean DEFAULT false NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "brand_locations_kind_ck" CHECK (kind in ('store', 'showroom', 'popup', 'exhibition')),
	CONSTRAINT "brand_locations_pin_ck" CHECK (pin_precision in ('street', 'area')),
	CONSTRAINT "brand_locations_visibility_ck" CHECK (visibility in ('draft', 'published', 'hidden')),
	CONSTRAINT "brand_locations_moderation_ck" CHECK (moderation_status in ('approved', 'pending_review', 'rejected', 'removed')),
	CONSTRAINT "brand_locations_name_len_ck" CHECK (length(name) between 1 and 80),
	CONSTRAINT "brand_locations_address_len_ck" CHECK (length(address_line) between 1 and 140),
	CONSTRAINT "brand_locations_lat_ck" CHECK (lat between -90 and 90),
	CONSTRAINT "brand_locations_lng_ck" CHECK (lng between -180 and 180),
	CONSTRAINT "brand_locations_hours_note_len_ck" CHECK (hours_note is null or length(hours_note) <= 120),
	CONSTRAINT "brand_locations_dated_kind_ck" CHECK ((kind in ('popup', 'exhibition')) = (starts_at is not null and ends_at is not null)),
	CONSTRAINT "brand_locations_dates_ck" CHECK (ends_at is null or ends_at > starts_at),
	CONSTRAINT "brand_locations_images_len_ck" CHECK (jsonb_array_length(images) <= 6),
	CONSTRAINT "brand_locations_products_len_ck" CHECK (coalesce(array_length(featured_product_ids, 1), 0) <= 8),
	CONSTRAINT "brand_locations_description_len_ck" CHECK (description is null or length(description) <= 600)
);
--> statement-breakpoint
CREATE TABLE "location_events" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"location_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"drop_id" text,
	"product_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"promo_text" text,
	"image" jsonb,
	"visibility" text DEFAULT 'draft' NOT NULL,
	"moderation_status" text DEFAULT 'approved' NOT NULL,
	"moderation_reason" text,
	"reviewed_at" timestamp with time zone,
	"sample" boolean DEFAULT false NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "location_events_kind_ck" CHECK (kind in ('drop_launch', 'promotion', 'exhibition', 'talk', 'sale', 'popup_day')),
	CONSTRAINT "location_events_visibility_ck" CHECK (visibility in ('draft', 'published', 'hidden')),
	CONSTRAINT "location_events_moderation_ck" CHECK (moderation_status in ('approved', 'pending_review', 'rejected', 'removed')),
	CONSTRAINT "location_events_title_len_ck" CHECK (length(title) between 1 and 80),
	CONSTRAINT "location_events_description_len_ck" CHECK (description is null or length(description) <= 600),
	CONSTRAINT "location_events_dates_ck" CHECK (ends_at > starts_at),
	CONSTRAINT "location_events_promo_len_ck" CHECK (promo_text is null or length(promo_text) <= 120)
);
--> statement-breakpoint
CREATE TABLE "brand_members" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_members_role_ck" CHECK (role in ('owner', 'admin', 'designer', 'fulfilment', 'finance', 'viewer')),
	CONSTRAINT "brand_members_status_ck" CHECK (status in ('active', 'invited'))
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" text PRIMARY KEY NOT NULL,
	"handle" text NOT NULL,
	"name" text NOT NULL,
	"city" text NOT NULL,
	"city_slug" text NOT NULL,
	"country" text NOT NULL,
	"currency" text NOT NULL,
	"categories" text[] NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"review_status" text DEFAULT 'pending_review' NOT NULL,
	"joined_at" date,
	"followers_base" integer NOT NULL,
	"time_zone" text NOT NULL,
	CONSTRAINT "brands_review_status_ck" CHECK (review_status in ('pending_review', 'verified', 'restricted', 'suspended'))
);
--> statement-breakpoint
CREATE TABLE "chart_entries" (
	"snapshot_id" text NOT NULL,
	"rank" integer NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"score" real NOT NULL,
	"prev_rank" integer,
	"peak_rank" integer NOT NULL,
	"editions_on_chart" integer NOT NULL,
	"movement" text NOT NULL,
	"delta" integer DEFAULT 0 NOT NULL,
	"stats" jsonb NOT NULL,
	"components" jsonb NOT NULL,
	CONSTRAINT "chart_entries_pk" PRIMARY KEY("snapshot_id","rank"),
	CONSTRAINT "chart_entries_subject_type_ck" CHECK (subject_type in ('brand', 'drop')),
	CONSTRAINT "chart_entries_movement_ck" CHECK (movement in ('up', 'down', 'same', 'new', 'reentry'))
);
--> statement-breakpoint
CREATE TABLE "chart_events" (
	"seq" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "chart_events_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"brand_id" text NOT NULL,
	"product_id" text,
	"drop_id" text,
	"kind" text NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_id" text NOT NULL,
	"account_age_days" integer,
	"ip_hash" text,
	"ua_hash" text,
	"day" date NOT NULL,
	"value_minor" integer,
	"verdict" text DEFAULT 'counted' NOT NULL,
	"flag_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chart_events_kind_ck" CHECK (kind in ('follow', 'unfollow', 'wishlist_add', 'wishlist_remove', 'reminder_set', 'reminder_unset', 'product_view', 'storefront_view', 'post_open', 'message_started', 'order_placed', 'order_cancelled')),
	CONSTRAINT "chart_events_actor_kind_ck" CHECK (actor_kind in ('shopper', 'anon')),
	CONSTRAINT "chart_events_verdict_ck" CHECK (verdict in ('counted', 'deduped', 'excluded_self', 'excluded_restricted', 'excluded_fraud', 'excluded_anon'))
);
--> statement-breakpoint
CREATE TABLE "chart_flags" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"detector" text NOT NULL,
	"severity" text NOT NULL,
	"window_start" date NOT NULL,
	"window_end" date NOT NULL,
	"evidence" jsonb NOT NULL,
	"excluded_events" integer DEFAULT 0 NOT NULL,
	"auto_action" text DEFAULT 'none' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chart_flags_detector_ck" CHECK (detector in ('velocity_spike', 'ip_concentration', 'new_account_share', 'self_engagement', 'wishlist_churn', 'order_anomaly', 'coordinated_ring')),
	CONSTRAINT "chart_flags_severity_ck" CHECK (severity in ('low', 'medium', 'high')),
	CONSTRAINT "chart_flags_auto_action_ck" CHECK (auto_action in ('none', 'excluded_signals', 'held_from_charts')),
	CONSTRAINT "chart_flags_status_ck" CHECK (status in ('open', 'cleared', 'confirmed', 'frozen'))
);
--> statement-breakpoint
CREATE TABLE "chart_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"chart" text NOT NULL,
	"period" text NOT NULL,
	"scope" text NOT NULL,
	"edition" date NOT NULL,
	"status" text NOT NULL,
	"cohort_size" integer NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chart_snapshots_chart_ck" CHECK (chart in ('top', 'trending', 'emerging', 'most_followed', 'most_wishlisted', 'top_drops', 'city')),
	CONSTRAINT "chart_snapshots_period_ck" CHECK (period in ('daily', 'weekly', 'monthly')),
	CONSTRAINT "chart_snapshots_status_ck" CHECK (status in ('live', 'final'))
);
--> statement-breakpoint
CREATE TABLE "shopper_follows" (
	"user_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shopper_follows_pk" PRIMARY KEY("user_id","brand_id")
);
--> statement-breakpoint
CREATE TABLE "shopper_reminders" (
	"user_id" text NOT NULL,
	"drop_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shopper_reminders_pk" PRIMARY KEY("user_id","drop_id")
);
--> statement-breakpoint
CREATE TABLE "shopper_wishlist" (
	"user_id" text NOT NULL,
	"product_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shopper_wishlist_pk" PRIMARY KEY("user_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "blocks" (
	"id" text PRIMARY KEY NOT NULL,
	"blocker_kind" text NOT NULL,
	"blocker_id" text NOT NULL,
	"blocked_kind" text NOT NULL,
	"blocked_id" text NOT NULL,
	"created_by" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blocks_blocker_kind_ck" CHECK (blocker_kind in ('brand', 'shopper')),
	CONSTRAINT "blocks_blocked_kind_ck" CHECK (blocked_kind in ('shopper', 'brand'))
);
--> statement-breakpoint
CREATE TABLE "conversation_participants" (
	"conversation_id" text NOT NULL,
	"side" text NOT NULL,
	"party_id" text NOT NULL,
	"last_read_seq" integer DEFAULT 0 NOT NULL,
	"last_read_at" timestamp with time zone,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"marked_unread" boolean DEFAULT false NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"muted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "conversation_participants_pk" PRIMARY KEY("conversation_id","side"),
	CONSTRAINT "conversation_participants_side_ck" CHECK (side in ('customer', 'brand'))
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"spam_state" text DEFAULT 'none' NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"origin" text NOT NULL,
	"origin_ref" text,
	"topic" text,
	"last_message_seq" integer DEFAULT 0 NOT NULL,
	"last_message_at" timestamp with time zone,
	"last_preview" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"sample" boolean DEFAULT false NOT NULL,
	CONSTRAINT "conversations_status_ck" CHECK (status in ('open', 'resolved')),
	CONSTRAINT "conversations_spam_state_ck" CHECK (spam_state in ('none', 'suspected', 'confirmed')),
	CONSTRAINT "conversations_origin_ck" CHECK (origin in ('storefront', 'product', 'order', 'inbox')),
	CONSTRAINT "conversations_topic_ck" CHECK (topic is null or topic in ('sizing', 'availability', 'delivery', 'drops', 'product', 'order', 'other')),
	CONSTRAINT "conversations_preview_len_ck" CHECK (length(last_preview) <= 140)
);
--> statement-breakpoint
CREATE TABLE "message_attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"media_id" text NOT NULL,
	"position" smallint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_reactions" (
	"message_id" text NOT NULL,
	"side" text NOT NULL,
	"user_id" text NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_reactions_pk" PRIMARY KEY("message_id","side"),
	CONSTRAINT "message_reactions_side_ck" CHECK (side in ('customer', 'brand')),
	CONSTRAINT "message_reactions_emoji_ck" CHECK (emoji in ('♥'))
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" integer GENERATED ALWAYS AS IDENTITY (sequence name "messages_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"conversation_id" text NOT NULL,
	"sender_side" text NOT NULL,
	"sender_user_id" text,
	"kind" text NOT NULL,
	"body" text,
	"product_id" text,
	"variant_id" text,
	"product_snapshot" jsonb,
	"order_ref_id" text,
	"order_snapshot" jsonb,
	"quick_reply_id" text,
	"status" text DEFAULT 'sent' NOT NULL,
	"held_reason" text,
	"spam_score" smallint DEFAULT 0 NOT NULL,
	"removed_by" text,
	"removed_reason" text,
	"client_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"search_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(body, ''))) STORED,
	CONSTRAINT "messages_sender_side_ck" CHECK (sender_side in ('customer', 'brand', 'system')),
	CONSTRAINT "messages_kind_ck" CHECK (kind in ('text', 'product', 'order', 'image', 'system')),
	CONSTRAINT "messages_status_ck" CHECK (status in ('sent', 'held', 'removed')),
	CONSTRAINT "messages_body_len_ck" CHECK (body is null or length(body) <= 2000)
);
--> statement-breakpoint
CREATE TABLE "quick_replies" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"shortcut" text,
	"position" integer NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quick_replies_title_len_ck" CHECK (length(title) between 1 and 40),
	CONSTRAINT "quick_replies_body_len_ck" CHECK (length(body) between 1 and 1000),
	CONSTRAINT "quick_replies_shortcut_ck" CHECK (shortcut is null or shortcut ~ '^/[a-z0-9-]{2,20}$')
);
--> statement-breakpoint
CREATE TABLE "admin_members" (
	"user_id" text PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"mfa" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_members_role_ck" CHECK (role in ('owner', 'finance', 'trust_safety', 'support', 'ads_ops', 'engineering'))
);
--> statement-breakpoint
CREATE TABLE "app_meta" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_states" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"mode" text NOT NULL,
	"code_verifier_enc" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "oauth_states_provider_ck" CHECK (provider in ('instagram', 'tiktok')),
	CONSTRAINT "oauth_states_mode_ck" CHECK (mode in ('live', 'sandbox'))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" text NOT NULL,
	"actor" text NOT NULL,
	"active_brand_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idle_expires_at" timestamp with time zone NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"user_agent" text,
	"ip_hash" text,
	CONSTRAINT "sessions_actor_ck" CHECK (actor in ('shopper', 'brand', 'admin'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"city" text,
	"country" text,
	"status" text DEFAULT 'active' NOT NULL,
	"demo" boolean DEFAULT true NOT NULL,
	"read_receipts" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_kind_ck" CHECK (kind in ('shopper', 'brand_staff', 'admin')),
	CONSTRAINT "users_status_ck" CHECK (status in ('active', 'restricted', 'suspended'))
);
--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_kind" text NOT NULL,
	"owner_id" text NOT NULL,
	"brand_id" text,
	"conversation_id" text,
	"target_brand_id" text,
	"purpose" text NOT NULL,
	"mime" text NOT NULL,
	"ext" text NOT NULL,
	"bytes" integer NOT NULL,
	"width" integer,
	"height" integer,
	"duration_ms" integer,
	"sha256" text NOT NULL,
	"storage_path" text NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"moderation_status" text DEFAULT 'ok' NOT NULL,
	"source" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attached_at" timestamp with time zone,
	CONSTRAINT "media_assets_owner_kind_ck" CHECK (owner_kind in ('brand', 'user', 'system')),
	CONSTRAINT "media_assets_purpose_ck" CHECK (purpose in ('social_post', 'inbox_attachment', 'location_image', 'social_import', 'sample')),
	CONSTRAINT "media_assets_mime_ck" CHECK (mime in ('image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm')),
	CONSTRAINT "media_assets_visibility_ck" CHECK (visibility in ('private', 'public')),
	CONSTRAINT "media_assets_moderation_ck" CHECK (moderation_status in ('ok', 'pending', 'removed')),
	CONSTRAINT "media_assets_source_ck" CHECK (source in ('upload', 'instagram', 'tiktok', 'sandbox', 'seed'))
);
--> statement-breakpoint
CREATE TABLE "social_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"provider" text NOT NULL,
	"mode" text NOT NULL,
	"external_user_id" text NOT NULL,
	"handle" text,
	"display_name" text,
	"avatar_media_id" text,
	"account_type" text,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text NOT NULL,
	"status_detail" text,
	"token_expires_at" timestamp with time zone,
	"refresh_expires_at" timestamp with time zone,
	"connected_by" text NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sync_at" timestamp with time zone,
	"next_sync_after" timestamp with time zone,
	"last_error_code" text,
	"disconnected_at" timestamp with time zone,
	CONSTRAINT "social_accounts_provider_ck" CHECK (provider in ('instagram', 'tiktok')),
	CONSTRAINT "social_accounts_mode_ck" CHECK (mode in ('live', 'sandbox')),
	CONSTRAINT "social_accounts_status_ck" CHECK (status in ('connected', 'needs_reauth', 'error', 'revoked', 'disconnected'))
);
--> statement-breakpoint
CREATE TABLE "social_data_deletions" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"external_user_id" text NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "social_data_deletions_provider_ck" CHECK (provider in ('instagram')),
	CONSTRAINT "social_data_deletions_status_ck" CHECK (status in ('received', 'completed'))
);
--> statement-breakpoint
CREATE TABLE "social_posts" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"account_id" text,
	"source" text NOT NULL,
	"external_id" text,
	"kind" text NOT NULL,
	"caption" text DEFAULT '' NOT NULL,
	"permalink" text,
	"embed_url" text,
	"media" jsonb NOT NULL,
	"product_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"posted_at" timestamp with time zone NOT NULL,
	"imported_at" timestamp with time zone,
	"upstream_missing_at" timestamp with time zone,
	"visibility" text DEFAULT 'hidden' NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"feature_order" integer,
	"moderation_status" text DEFAULT 'ok' NOT NULL,
	"removed_reason" text,
	"sample" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_posts_source_ck" CHECK (source in ('instagram', 'tiktok', 'upload', 'sandbox', 'sample')),
	CONSTRAINT "social_posts_kind_ck" CHECK (kind in ('image', 'video', 'carousel')),
	CONSTRAINT "social_posts_visibility_ck" CHECK (visibility in ('draft', 'published', 'hidden')),
	CONSTRAINT "social_posts_moderation_ck" CHECK (moderation_status in ('ok', 'flagged', 'removed')),
	CONSTRAINT "social_posts_caption_len_ck" CHECK (length(caption) <= 2200),
	CONSTRAINT "social_posts_products_len_ck" CHECK (coalesce(array_length(product_ids, 1), 0) <= 6),
	CONSTRAINT "social_posts_permalink_ck" CHECK (permalink is null or permalink ~ '^https://(www\.)?(instagram|tiktok)\.com/'),
	CONSTRAINT "social_posts_embed_ck" CHECK (embed_url is null or embed_url like 'https://www.tiktok.com/embed/%')
);
--> statement-breakpoint
CREATE TABLE "abuse_alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"subject_kind" text NOT NULL,
	"subject_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"evidence" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	CONSTRAINT "abuse_alerts_subject_kind_ck" CHECK (subject_kind in ('user', 'brand')),
	CONSTRAINT "abuse_alerts_kind_ck" CHECK (kind in ('spam_marks', 'rate_limit_burst', 'report_volume')),
	CONSTRAINT "abuse_alerts_status_ck" CHECK (status in ('open', 'confirmed', 'dismissed'))
);
--> statement-breakpoint
CREATE TABLE "abuse_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "abuse_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"actor_kind" text NOT NULL,
	"actor_id" text,
	"ip_hash" text,
	"action" text NOT NULL,
	"rule" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "abuse_events_actor_kind_ck" CHECK (actor_kind in ('shopper', 'brand', 'anon', 'admin', 'system')),
	CONSTRAINT "abuse_events_rule_ck" CHECK (rule in ('rate_limit', 'daily_cap', 'first_contact_cap', 'spam_duplicate', 'spam_links', 'spam_offplatform', 'spam_brand_offplatform', 'blocked_send', 'signal_dedupe', 'signal_ip_cap', 'signal_anon', 'spam_marked_by_brand', 'stream_cap'))
);
--> statement-breakpoint
CREATE TABLE "account_restrictions" (
	"id" text PRIMARY KEY NOT NULL,
	"subject_kind" text NOT NULL,
	"subject_id" text NOT NULL,
	"kind" text NOT NULL,
	"until" timestamp with time zone,
	"reason" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"requested_by" text NOT NULL,
	"approved_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lifted_at" timestamp with time zone,
	"lifted_by" text,
	CONSTRAINT "account_restrictions_subject_kind_ck" CHECK (subject_kind in ('user', 'brand')),
	CONSTRAINT "account_restrictions_kind_ck" CHECK (kind in ('messaging', 'uploads', 'reports', 'social_disabled', 'charts_freeze')),
	CONSTRAINT "account_restrictions_status_ck" CHECK (status in ('pending_approval', 'active', 'lifted'))
);
--> statement-breakpoint
CREATE TABLE "rate_limit_buckets" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" text PRIMARY KEY NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"brand_id" text,
	"reporter_kind" text NOT NULL,
	"reporter_id" text NOT NULL,
	"reason" text NOT NULL,
	"details" text,
	"snapshot" jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" smallint DEFAULT 2 NOT NULL,
	"assigned_to" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"decision" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reports_subject_type_ck" CHECK (subject_type in ('message', 'conversation', 'social_post', 'location', 'location_event')),
	CONSTRAINT "reports_reporter_kind_ck" CHECK (reporter_kind in ('shopper', 'brand', 'admin', 'system')),
	CONSTRAINT "reports_status_ck" CHECK (status in ('open', 'in_review', 'actioned', 'dismissed', 'escalated')),
	CONSTRAINT "reports_details_len_ck" CHECK (details is null or length(details) <= 1000)
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"id" text PRIMARY KEY NOT NULL,
	"country" text NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'public' NOT NULL,
	"estimated" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'config' NOT NULL,
	"created_by" text,
	CONSTRAINT "holidays_kind_ck" CHECK (kind in ('public', 'carrier')),
	CONSTRAINT "holidays_source_ck" CHECK (source in ('config', 'admin'))
);
--> statement-breakpoint
CREATE TABLE "shipping_closures" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"date_from" date NOT NULL,
	"date_to" date NOT NULL,
	"reason" text,
	CONSTRAINT "shipping_closures_range_ck" CHECK (date_to >= date_from)
);
--> statement-breakpoint
CREATE TABLE "shipping_methods" (
	"id" text PRIMARY KEY NOT NULL,
	"zone_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"service" text NOT NULL,
	"label" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"transit_min" smallint NOT NULL,
	"transit_max" smallint NOT NULL,
	"carrier_label" text,
	"position" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "shipping_methods_service_ck" CHECK (service in ('standard', 'express', 'pickup')),
	CONSTRAINT "shipping_methods_label_len_ck" CHECK (length(label) between 1 and 40),
	CONSTRAINT "shipping_methods_transit_min_ck" CHECK (transit_min between 0 and 60),
	CONSTRAINT "shipping_methods_transit_max_ck" CHECK (transit_max between transit_min and 60)
);
--> statement-breakpoint
CREATE TABLE "shipping_profiles" (
	"brand_id" text PRIMARY KEY NOT NULL,
	"origin_country" text NOT NULL,
	"origin_city" text NOT NULL,
	"time_zone" text NOT NULL,
	"handling_min" smallint NOT NULL,
	"handling_max" smallint NOT NULL,
	"cutoff_local" text DEFAULT '14:00' NOT NULL,
	"workdays" smallint DEFAULT 31 NOT NULL,
	"provider_id" text DEFAULT 'manual' NOT NULL,
	"currency" text NOT NULL,
	"local_pickup" boolean DEFAULT false NOT NULL,
	"pickup_location_id" text,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipping_profiles_handling_min_ck" CHECK (handling_min between 0 and 30),
	CONSTRAINT "shipping_profiles_handling_max_ck" CHECK (handling_max between handling_min and 30),
	CONSTRAINT "shipping_profiles_cutoff_ck" CHECK (cutoff_local ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);
--> statement-breakpoint
CREATE TABLE "shipping_rates" (
	"id" text PRIMARY KEY NOT NULL,
	"method_id" text NOT NULL,
	"min_subtotal_minor" integer DEFAULT 0 NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	CONSTRAINT "shipping_rates_amount_ck" CHECK (amount_minor >= 0)
);
--> statement-breakpoint
CREATE TABLE "shipping_zones" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"countries" text[] NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"position" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "shipping_zones_kind_ck" CHECK (kind in ('domestic', 'regional', 'international', 'custom')),
	CONSTRAINT "shipping_zones_name_len_ck" CHECK (length(name) between 1 and 40)
);
--> statement-breakpoint
CREATE TABLE "delivery_complaints" (
	"id" text PRIMARY KEY NOT NULL,
	"order_ref_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"kind" text NOT NULL,
	"details" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"brand_response" text,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	CONSTRAINT "delivery_complaints_kind_ck" CHECK (kind in ('late', 'not_received', 'damaged', 'wrong_item', 'wrong_address', 'other')),
	CONSTRAINT "delivery_complaints_status_ck" CHECK (status in ('open', 'waiting_brand', 'brand_responded', 'resolved', 'escalated')),
	CONSTRAINT "delivery_complaints_details_len_ck" CHECK (length(details) <= 1000)
);
--> statement-breakpoint
CREATE TABLE "delivery_estimates" (
	"id" text PRIMARY KEY NOT NULL,
	"order_ref_id" text NOT NULL,
	"basis" text NOT NULL,
	"dispatch_from" date,
	"ship_by" date,
	"arrival_from" date,
	"arrival_to" date,
	"delivered_on" date,
	"guaranteed" boolean DEFAULT false NOT NULL,
	"provider_id" text NOT NULL,
	"reason" text,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_estimates_basis_ck" CHECK (basis in ('placed', 'shipped', 'in_transit', 'out_for_delivery', 'delivered', 'late', 'exception'))
);
--> statement-breakpoint
CREATE TABLE "order_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"idempotency_key" text,
	"reference" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_refs" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"reference" text NOT NULL,
	"brand_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"placed_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"paid" boolean DEFAULT false NOT NULL,
	"currency" text NOT NULL,
	"subtotal_minor" integer NOT NULL,
	"shipping_minor" integer NOT NULL,
	"total_minor" integer NOT NULL,
	"items" jsonb NOT NULL,
	"ship_to_country" text NOT NULL,
	"ship_to_city" text,
	"service" text DEFAULT 'standard' NOT NULL,
	"quoted" jsonb,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_refs_service_ck" CHECK (service in ('standard', 'express', 'pickup')),
	CONSTRAINT "order_refs_source_ck" CHECK (source in ('seed', 'browser'))
);
--> statement-breakpoint
CREATE TABLE "shipment_events" (
	"id" text PRIMARY KEY NOT NULL,
	"order_ref_id" text NOT NULL,
	"status" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"carrier" text,
	"tracking_number" text,
	"location_text" text,
	"note" text,
	"source" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipment_events_status_ck" CHECK (status in ('label_created', 'shipped', 'in_transit', 'out_for_delivery', 'delivered', 'exception', 'returned')),
	CONSTRAINT "shipment_events_source_ck" CHECK (source in ('merchant', 'carrier', 'system'))
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_id" text,
	"actor_name" text,
	"role" text,
	"action" text NOT NULL,
	"target" text,
	"subject_type" text,
	"subject_id" text,
	"brand_id" text,
	"reason" text,
	"approved_by" text,
	"ip_hash" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "audit_log_actor_kind_ck" CHECK (actor_kind in ('admin', 'brand', 'shopper', 'system'))
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"recipient_kind" text NOT NULL,
	"recipient_id" text NOT NULL,
	"event_key" text NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"href" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "notifications_recipient_kind_ck" CHECK (recipient_kind in ('shopper', 'brand', 'admin'))
);
--> statement-breakpoint
CREATE TABLE "realtime_events" (
	"seq" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "realtime_events_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"channel" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_tokens" (
	"account_id" text PRIMARY KEY NOT NULL,
	"access_token_enc" text NOT NULL,
	"refresh_token_enc" text,
	"sealed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brand_locations" ADD CONSTRAINT "brand_locations_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_locations" ADD CONSTRAINT "brand_locations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_events" ADD CONSTRAINT "location_events_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_events" ADD CONSTRAINT "location_events_location_id_brand_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."brand_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_events" ADD CONSTRAINT "location_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_members" ADD CONSTRAINT "brand_members_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_members" ADD CONSTRAINT "brand_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chart_entries" ADD CONSTRAINT "chart_entries_snapshot_id_chart_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."chart_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chart_entries" ADD CONSTRAINT "chart_entries_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chart_events" ADD CONSTRAINT "chart_events_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chart_events" ADD CONSTRAINT "chart_events_flag_id_chart_flags_id_fk" FOREIGN KEY ("flag_id") REFERENCES "public"."chart_flags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chart_flags" ADD CONSTRAINT "chart_flags_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopper_follows" ADD CONSTRAINT "shopper_follows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopper_follows" ADD CONSTRAINT "shopper_follows_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopper_reminders" ADD CONSTRAINT "shopper_reminders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopper_reminders" ADD CONSTRAINT "shopper_reminders_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopper_wishlist" ADD CONSTRAINT "shopper_wishlist_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopper_wishlist" ADD CONSTRAINT "shopper_wishlist_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_media_id_media_assets_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_order_ref_id_order_refs_id_fk" FOREIGN KEY ("order_ref_id") REFERENCES "public"."order_refs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_quick_reply_id_quick_replies_id_fk" FOREIGN KEY ("quick_reply_id") REFERENCES "public"."quick_replies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quick_replies" ADD CONSTRAINT "quick_replies_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quick_replies" ADD CONSTRAINT "quick_replies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_members" ADD CONSTRAINT "admin_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_active_brand_id_brands_id_fk" FOREIGN KEY ("active_brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_target_brand_id_brands_id_fk" FOREIGN KEY ("target_brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_avatar_media_id_media_assets_id_fk" FOREIGN KEY ("avatar_media_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_connected_by_users_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_account_id_social_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."social_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "abuse_alerts" ADD CONSTRAINT "abuse_alerts_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_restrictions" ADD CONSTRAINT "account_restrictions_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_restrictions" ADD CONSTRAINT "account_restrictions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_closures" ADD CONSTRAINT "shipping_closures_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_methods" ADD CONSTRAINT "shipping_methods_zone_id_shipping_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."shipping_zones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_methods" ADD CONSTRAINT "shipping_methods_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_profiles" ADD CONSTRAINT "shipping_profiles_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_profiles" ADD CONSTRAINT "shipping_profiles_pickup_location_id_brand_locations_id_fk" FOREIGN KEY ("pickup_location_id") REFERENCES "public"."brand_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_rates" ADD CONSTRAINT "shipping_rates_method_id_shipping_methods_id_fk" FOREIGN KEY ("method_id") REFERENCES "public"."shipping_methods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_zones" ADD CONSTRAINT "shipping_zones_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_complaints" ADD CONSTRAINT "delivery_complaints_order_ref_id_order_refs_id_fk" FOREIGN KEY ("order_ref_id") REFERENCES "public"."order_refs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_complaints" ADD CONSTRAINT "delivery_complaints_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_complaints" ADD CONSTRAINT "delivery_complaints_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_estimates" ADD CONSTRAINT "delivery_estimates_order_ref_id_order_refs_id_fk" FOREIGN KEY ("order_ref_id") REFERENCES "public"."order_refs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_groups" ADD CONSTRAINT "order_groups_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_refs" ADD CONSTRAINT "order_refs_group_id_order_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."order_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_refs" ADD CONSTRAINT "order_refs_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_refs" ADD CONSTRAINT "order_refs_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_events" ADD CONSTRAINT "shipment_events_order_ref_id_order_refs_id_fk" FOREIGN KEY ("order_ref_id") REFERENCES "public"."order_refs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_tokens" ADD CONSTRAINT "social_tokens_account_id_social_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."social_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "brand_locations_public_tile_ix" ON "brand_locations" USING btree ("tile_key") WHERE visibility = 'published' and moderation_status = 'approved';--> statement-breakpoint
CREATE INDEX "brand_locations_brand_ix" ON "brand_locations" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "brand_locations_city_ix" ON "brand_locations" USING btree ("city_slug");--> statement-breakpoint
CREATE INDEX "brand_locations_ends_ix" ON "brand_locations" USING btree ("ends_at");--> statement-breakpoint
CREATE INDEX "location_events_location_ix" ON "location_events" USING btree ("location_id","starts_at");--> statement-breakpoint
CREATE INDEX "location_events_window_ix" ON "location_events" USING btree ("starts_at","ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "brand_members_brand_user_ux" ON "brand_members" USING btree ("brand_id","user_id");--> statement-breakpoint
CREATE INDEX "brand_members_user_ix" ON "brand_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "brands_handle_ux" ON "brands" USING btree ("handle");--> statement-breakpoint
CREATE INDEX "brands_city_slug_ix" ON "brands" USING btree ("city_slug");--> statement-breakpoint
CREATE INDEX "brands_review_status_ix" ON "brands" USING btree ("review_status");--> statement-breakpoint
CREATE INDEX "chart_entries_subject_ix" ON "chart_entries" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "chart_entries_brand_ix" ON "chart_entries" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "chart_events_brand_day_ix" ON "chart_events" USING btree ("brand_id","day");--> statement-breakpoint
CREATE INDEX "chart_events_day_kind_ix" ON "chart_events" USING btree ("day","kind");--> statement-breakpoint
CREATE INDEX "chart_events_ip_day_ix" ON "chart_events" USING btree ("ip_hash","day") WHERE ip_hash is not null;--> statement-breakpoint
CREATE INDEX "chart_events_actor_kind_day_ix" ON "chart_events" USING btree ("actor_id","kind","day");--> statement-breakpoint
CREATE UNIQUE INDEX "chart_events_view_once_ux" ON "chart_events" USING btree ("kind","brand_id",coalesce(product_id, ''),coalesce(drop_id, ''),"actor_id","day") WHERE verdict = 'counted' and kind in ('product_view', 'storefront_view', 'post_open');--> statement-breakpoint
CREATE UNIQUE INDEX "chart_flags_window_ux" ON "chart_flags" USING btree ("brand_id","detector","window_start");--> statement-breakpoint
CREATE INDEX "chart_flags_status_ix" ON "chart_flags" USING btree ("status","severity");--> statement-breakpoint
CREATE UNIQUE INDEX "chart_snapshots_edition_ux" ON "chart_snapshots" USING btree ("chart","period","scope","edition");--> statement-breakpoint
CREATE INDEX "chart_snapshots_lookup_ix" ON "chart_snapshots" USING btree ("chart","period","scope","edition" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "blocks_pair_ux" ON "blocks" USING btree ("blocker_kind","blocker_id","blocked_kind","blocked_id");--> statement-breakpoint
CREATE INDEX "blocks_blocked_ix" ON "blocks" USING btree ("blocked_kind","blocked_id");--> statement-breakpoint
CREATE INDEX "conversation_participants_party_ix" ON "conversation_participants" USING btree ("party_id","side");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_brand_customer_ux" ON "conversations" USING btree ("brand_id","customer_id");--> statement-breakpoint
CREATE INDEX "conversations_brand_list_ix" ON "conversations" USING btree ("brand_id","status","last_message_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "conversations_customer_list_ix" ON "conversations" USING btree ("customer_id","last_message_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "message_attachments_message_ix" ON "message_attachments" USING btree ("message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_seq_ux" ON "messages" USING btree ("seq");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_client_ux" ON "messages" USING btree ("conversation_id","client_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_seq_ix" ON "messages" USING btree ("conversation_id","seq");--> statement-breakpoint
CREATE INDEX "messages_search_gin" ON "messages" USING gin ("search_tsv");--> statement-breakpoint
CREATE INDEX "messages_held_ix" ON "messages" USING btree ("status") WHERE status = 'held';--> statement-breakpoint
CREATE UNIQUE INDEX "quick_replies_shortcut_ux" ON "quick_replies" USING btree ("brand_id","shortcut") WHERE shortcut is not null;--> statement-breakpoint
CREATE INDEX "quick_replies_brand_position_ix" ON "quick_replies" USING btree ("brand_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_ux" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_actor_ix" ON "sessions" USING btree ("user_id","actor");--> statement-breakpoint
CREATE INDEX "sessions_active_brand_ix" ON "sessions" USING btree ("active_brand_id");--> statement-breakpoint
CREATE INDEX "sessions_idle_expires_ix" ON "sessions" USING btree ("idle_expires_at");--> statement-breakpoint
CREATE INDEX "sessions_absolute_expires_ix" ON "sessions" USING btree ("absolute_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_ux" ON "users" USING btree (lower(email));--> statement-breakpoint
CREATE INDEX "users_kind_ix" ON "users" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "media_assets_brand_purpose_ix" ON "media_assets" USING btree ("brand_id","purpose");--> statement-breakpoint
CREATE INDEX "media_assets_conversation_ix" ON "media_assets" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "media_assets_sha256_ix" ON "media_assets" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "media_assets_unattached_ix" ON "media_assets" USING btree ("purpose","created_at") WHERE attached_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "social_accounts_brand_provider_ux" ON "social_accounts" USING btree ("brand_id","provider") WHERE status <> 'disconnected';--> statement-breakpoint
CREATE INDEX "social_accounts_status_expiry_ix" ON "social_accounts" USING btree ("status","token_expires_at");--> statement-breakpoint
CREATE INDEX "social_accounts_external_ix" ON "social_accounts" USING btree ("provider","mode","external_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "social_posts_external_ux" ON "social_posts" USING btree ("brand_id","source","external_id") WHERE external_id is not null;--> statement-breakpoint
CREATE INDEX "social_posts_public_ix" ON "social_posts" USING btree ("brand_id","visibility","moderation_status","posted_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "social_posts_featured_ix" ON "social_posts" USING btree ("brand_id","featured","feature_order");--> statement-breakpoint
CREATE INDEX "social_posts_products_gin" ON "social_posts" USING gin ("product_ids");--> statement-breakpoint
CREATE UNIQUE INDEX "abuse_alerts_open_ux" ON "abuse_alerts" USING btree ("subject_kind","subject_id","kind") WHERE status = 'open';--> statement-breakpoint
CREATE INDEX "abuse_alerts_status_ix" ON "abuse_alerts" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "abuse_events_actor_ix" ON "abuse_events" USING btree ("actor_kind","actor_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "abuse_events_rule_ix" ON "abuse_events" USING btree ("rule","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "account_restrictions_active_ix" ON "account_restrictions" USING btree ("subject_kind","subject_id") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "reports_queue_ix" ON "reports" USING btree ("status","subject_type","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "reports_subject_ix" ON "reports" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_one_open_ux" ON "reports" USING btree ("reporter_kind","reporter_id","subject_type","subject_id") WHERE status in ('open', 'in_review');--> statement-breakpoint
CREATE UNIQUE INDEX "holidays_country_date_name_ux" ON "holidays" USING btree ("country","date","name");--> statement-breakpoint
CREATE INDEX "holidays_country_date_ix" ON "holidays" USING btree ("country","date");--> statement-breakpoint
CREATE INDEX "shipping_closures_brand_ix" ON "shipping_closures" USING btree ("brand_id","date_from");--> statement-breakpoint
CREATE UNIQUE INDEX "shipping_methods_zone_service_ux" ON "shipping_methods" USING btree ("zone_id","service");--> statement-breakpoint
CREATE UNIQUE INDEX "shipping_rates_tier_ux" ON "shipping_rates" USING btree ("method_id","min_subtotal_minor");--> statement-breakpoint
CREATE UNIQUE INDEX "shipping_zones_name_ux" ON "shipping_zones" USING btree ("brand_id","name");--> statement-breakpoint
CREATE INDEX "delivery_complaints_status_ix" ON "delivery_complaints" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "delivery_complaints_brand_ix" ON "delivery_complaints" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "delivery_complaints_order_ix" ON "delivery_complaints" USING btree ("order_ref_id");--> statement-breakpoint
CREATE INDEX "delivery_estimates_order_ix" ON "delivery_estimates" USING btree ("order_ref_id","computed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "order_groups_reference_ux" ON "order_groups" USING btree ("reference");--> statement-breakpoint
CREATE UNIQUE INDEX "order_groups_idempotency_ux" ON "order_groups" USING btree ("customer_id","idempotency_key") WHERE idempotency_key is not null;--> statement-breakpoint
CREATE INDEX "order_refs_brand_placed_ix" ON "order_refs" USING btree ("brand_id","placed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "order_refs_customer_placed_ix" ON "order_refs" USING btree ("customer_id","placed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "order_refs_brand_reference_ux" ON "order_refs" USING btree ("brand_id","reference");--> statement-breakpoint
CREATE INDEX "shipment_events_order_ix" ON "shipment_events" USING btree ("order_ref_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_log_at_ix" ON "audit_log" USING btree ("at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_subject_ix" ON "audit_log" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "audit_log_actor_ix" ON "audit_log" USING btree ("actor_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_brand_ix" ON "audit_log" USING btree ("brand_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_recipient_key_ux" ON "notifications" USING btree ("recipient_kind","recipient_id","event_key");--> statement-breakpoint
CREATE INDEX "notifications_recipient_ix" ON "notifications" USING btree ("recipient_kind","recipient_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "realtime_events_channel_seq_ix" ON "realtime_events" USING btree ("channel","seq");--> statement-breakpoint
CREATE INDEX "realtime_events_created_ix" ON "realtime_events" USING btree ("created_at");