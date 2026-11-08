CREATE TABLE "catalog_brand_onboardings" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"current_step" text DEFAULT 'account' NOT NULL,
	"completed_steps" text[] DEFAULT '{}' NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"brand_id" text,
	"submitted_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" text,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_brand_onboardings_status_ck" CHECK (status in ('draft', 'submitted', 'approved', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "catalog_categories" (
	"slug" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"image_path" text,
	"subcategories" text[] DEFAULT '{}' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_collection_products" (
	"collection_id" text NOT NULL,
	"product_id" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "catalog_collection_products_collection_id_product_id_pk" PRIMARY KEY("collection_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "catalog_collections" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"handle" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"image_media_id" text,
	"image_path" text,
	"status" text DEFAULT 'published' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_collections_status_ck" CHECK (status in ('draft', 'published'))
);
--> statement-breakpoint
CREATE TABLE "catalog_product_images" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"media_id" text,
	"path" text,
	"alt" text DEFAULT '' NOT NULL,
	"width" integer,
	"height" integer,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "catalog_product_images_src_ck" CHECK (media_id is not null or path is not null)
);
--> statement-breakpoint
CREATE TABLE "catalog_product_options" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"name" text NOT NULL,
	"values" jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_products" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"details" text[] DEFAULT '{}' NOT NULL,
	"category_slug" text NOT NULL,
	"subcategory" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"badges" text[] DEFAULT '{}' NOT NULL,
	"price_minor" bigint NOT NULL,
	"compare_at_minor" bigint,
	"currency" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"publish_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"processing_min" integer,
	"processing_max" integer,
	"drop_id" text,
	"moderation_status" text DEFAULT 'ok' NOT NULL,
	"moderation_reason" text,
	"moderated_at" timestamp with time zone,
	"moderated_by" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	CONSTRAINT "catalog_products_status_ck" CHECK (status in ('draft', 'scheduled', 'published', 'archived')),
	CONSTRAINT "catalog_products_moderation_ck" CHECK (moderation_status in ('ok', 'hidden')),
	CONSTRAINT "catalog_products_price_ck" CHECK (price_minor > 0 and (compare_at_minor is null or compare_at_minor > 0)),
	CONSTRAINT "catalog_products_processing_ck" CHECK ((processing_min is null and processing_max is null) or (processing_min >= 0 and processing_max >= processing_min))
);
--> statement-breakpoint
CREATE TABLE "catalog_variants" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"sku" text NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"price_minor" bigint,
	"status" text DEFAULT 'active' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"on_hand" integer DEFAULT 0 NOT NULL,
	"held" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_variants_status_ck" CHECK (status in ('active', 'archived')),
	CONSTRAINT "catalog_variants_stock_ck" CHECK (on_hand >= 0 and held >= 0 and held <= on_hand),
	CONSTRAINT "catalog_variants_price_ck" CHECK (price_minor is null or price_minor > 0)
);
--> statement-breakpoint
CREATE TABLE "catalog_stock_holds" (
	"id" text PRIMARY KEY NOT NULL,
	"hold_key" text NOT NULL,
	"variant_id" text NOT NULL,
	"qty" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "catalog_stock_holds_status_ck" CHECK (status in ('active', 'committed', 'released', 'expired')),
	CONSTRAINT "catalog_stock_holds_qty_ck" CHECK (qty > 0)
);
--> statement-breakpoint
CREATE TABLE "catalog_stock_movements" (
	"id" text PRIMARY KEY NOT NULL,
	"variant_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"delta" integer NOT NULL,
	"on_hand_after" integer NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"ref_type" text,
	"ref_id" text,
	"actor_kind" text DEFAULT 'system' NOT NULL,
	"actor_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_stock_movements_reason_ck" CHECK (reason in ('seed', 'adjustment', 'set', 'sale', 'restock', 'return', 'correction'))
);
--> statement-breakpoint
CREATE TABLE "catalog_storefront_drafts" (
	"brand_id" text PRIMARY KEY NOT NULL,
	"config" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"base_version" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "catalog_storefront_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"version" integer NOT NULL,
	"config" jsonb NOT NULL,
	"note" text,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_by" text
);
--> statement-breakpoint
CREATE TABLE "back_in_stock_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"product_id" text NOT NULL,
	"variant_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "drop_claims" (
	"id" text PRIMARY KEY NOT NULL,
	"drop_id" text NOT NULL,
	"user_id" text NOT NULL,
	"variant_id" text NOT NULL,
	"qty" integer NOT NULL,
	"checkout_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drop_claims_status_ck" CHECK (status in ('pending', 'confirmed', 'released')),
	CONSTRAINT "drop_claims_qty_ck" CHECK (qty between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "drop_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"drop_id" text NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'entered' NOT NULL,
	"rank" integer,
	"window_opens_at" timestamp with time zone,
	"window_ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "drop_entries_status_ck" CHECK (status in ('entered', 'won', 'waitlisted', 'purchased', 'expired', 'lost', 'withdrawn'))
);
--> statement-breakpoint
CREATE TABLE "drop_items" (
	"drop_id" text NOT NULL,
	"product_id" text NOT NULL,
	"variant_id" text NOT NULL,
	CONSTRAINT "drop_items_pk" PRIMARY KEY("drop_id","variant_id")
);
--> statement-breakpoint
CREATE TABLE "drops" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"image" text,
	"access" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"early_access_at" timestamp with time zone,
	"entry_opens_at" timestamp with time zone,
	"entry_closes_at" timestamp with time zone,
	"draw_at" timestamp with time zone,
	"purchase_window_minutes" integer DEFAULT 1440 NOT NULL,
	"winners_count" integer,
	"limit_per_customer" integer DEFAULT 1 NOT NULL,
	"total_units" integer DEFAULT 0 NOT NULL,
	"reminder_lead_minutes" integer DEFAULT 60 NOT NULL,
	"reminder_sent_at" timestamp with time zone,
	"early_access_sent_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"draw_seed_hash" text,
	"draw_seed" text,
	"drawn_at" timestamp with time zone,
	"sponsored" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drops_access_ck" CHECK (access in ('first_come', 'draw', 'early_access')),
	CONSTRAINT "drops_status_ck" CHECK (status in ('draft', 'scheduled', 'live', 'ended', 'cancelled')),
	CONSTRAINT "drops_window_ck" CHECK (ends_at > starts_at),
	CONSTRAINT "drops_limit_ck" CHECK (limit_per_customer between 1 and 20),
	CONSTRAINT "drops_units_ck" CHECK (total_units >= 0),
	CONSTRAINT "drops_purchase_window_ck" CHECK (purchase_window_minutes between 5 and 10080),
	CONSTRAINT "drops_reminder_lead_ck" CHECK (reminder_lead_minutes between 0 and 10080),
	CONSTRAINT "drops_name_len_ck" CHECK (length(name) between 1 and 120),
	CONSTRAINT "drops_description_len_ck" CHECK (length(description) <= 2000)
);
--> statement-breakpoint
CREATE TABLE "email_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"template" text NOT NULL,
	"category" text NOT NULL,
	"to_email" text NOT NULL,
	"vars" jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"last_error" text,
	"provider" text,
	"provider_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "email_outbox_status_ck" CHECK (status in ('pending', 'sending', 'sent', 'failed', 'suppressed', 'stub')),
	CONSTRAINT "email_outbox_category_ck" CHECK (category in ('account', 'orders', 'payouts', 'drops', 'price_drops', 'back_in_stock', 'brand_news')),
	CONSTRAINT "email_outbox_last_error_len_ck" CHECK (last_error is null or length(last_error) <= 500)
);
--> statement-breakpoint
CREATE TABLE "email_suppressions" (
	"id" text PRIMARY KEY NOT NULL,
	"email_lower" text NOT NULL,
	"category" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_suppressions_reason_ck" CHECK (reason in ('unsubscribe', 'bounce', 'complaint', 'manual')),
	CONSTRAINT "email_suppressions_category_ck" CHECK (category in ('all', 'account', 'orders', 'payouts', 'drops', 'price_drops', 'back_in_stock', 'brand_news'))
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" text PRIMARY KEY NOT NULL,
	"email_drops" boolean DEFAULT true NOT NULL,
	"email_price_drops" boolean DEFAULT true NOT NULL,
	"email_back_in_stock" boolean DEFAULT true NOT NULL,
	"email_brand_news" boolean DEFAULT true NOT NULL,
	"inapp_drops" boolean DEFAULT true NOT NULL,
	"inapp_price_drops" boolean DEFAULT true NOT NULL,
	"inapp_back_in_stock" boolean DEFAULT true NOT NULL,
	"inapp_brand_news" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_watch_state" (
	"product_id" text PRIMARY KEY NOT NULL,
	"currency" text NOT NULL,
	"min_price_minor" integer NOT NULL,
	"available" integer NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_brands" (
	"brand_id" text PRIMARY KEY NOT NULL,
	"handle" text NOT NULL,
	"name" text NOT NULL,
	"city" text NOT NULL,
	"country" text NOT NULL,
	"categories_text" text DEFAULT '' NOT NULL,
	"tagline" text DEFAULT '' NOT NULL,
	"visible" boolean DEFAULT true NOT NULL,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(handle, '')), 'A') || setweight(to_tsvector('simple', coalesce(city, '') || ' ' || coalesce(categories_text, '')), 'B') || setweight(to_tsvector('simple', coalesce(tagline, '')), 'C')) STORED
);
--> statement-breakpoint
CREATE TABLE "search_products" (
	"product_id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"brand_name" text NOT NULL,
	"slug" text,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" text,
	"subcategory" text,
	"tags_text" text DEFAULT '' NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"price_minor" integer NOT NULL,
	"compare_at_minor" integer,
	"currency" text NOT NULL,
	"price_usd_minor" integer NOT NULL,
	"available" integer DEFAULT 0 NOT NULL,
	"variant_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"image" text,
	"visible" boolean DEFAULT true NOT NULL,
	"published_at" timestamp with time zone,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple', coalesce(title, '')), 'A') || setweight(to_tsvector('simple', coalesce(brand_name, '')), 'A') || setweight(to_tsvector('simple', coalesce(category, '') || ' ' || coalesce(subcategory, '') || ' ' || coalesce(tags_text, '')), 'B') || setweight(to_tsvector('simple', coalesce(description, '')), 'C')) STORED
);
--> statement-breakpoint
CREATE TABLE "account_deletions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "account_deletions_status_ck" CHECK (status in ('pending', 'processing', 'completed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "admin_mfa" (
	"user_id" text PRIMARY KEY NOT NULL,
	"secret_enc" text NOT NULL,
	"enabled_at" timestamp with time zone,
	"last_step" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_oauth_states" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"mode" text NOT NULL,
	"actor" text DEFAULT 'shopper' NOT NULL,
	"brand_id" text,
	"user_id" text,
	"session_id" text,
	"code_verifier_enc" text,
	"nonce" text NOT NULL,
	"binding_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "auth_oauth_states_provider_ck" CHECK (provider in ('google', 'apple')),
	CONSTRAINT "auth_oauth_states_mode_ck" CHECK (mode in ('signin', 'link', 'reauth')),
	CONSTRAINT "auth_oauth_states_actor_ck" CHECK (actor in ('shopper', 'brand', 'admin'))
);
--> statement-breakpoint
CREATE TABLE "auth_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"purpose" text NOT NULL,
	"token_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "auth_tokens_purpose_ck" CHECK (purpose in ('verify_email', 'reset_password', 'magic_link', 'mfa_challenge'))
);
--> statement-breakpoint
CREATE TABLE "brand_invites" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"invited_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by" text,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	CONSTRAINT "brand_invites_role_ck" CHECK (role in ('owner', 'admin', 'designer', 'fulfilment', 'finance', 'viewer')),
	CONSTRAINT "brand_invites_status_ck" CHECK (status in ('pending', 'accepted', 'revoked', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "mfa_recovery_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"code_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "oauth_identities" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"subject" text NOT NULL,
	"email" text,
	"email_verified" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "oauth_identities_provider_ck" CHECK (provider in ('google', 'apple'))
);
--> statement-breakpoint
CREATE TABLE "session_auth" (
	"session_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"method" text NOT NULL,
	"mfa_at" timestamp with time zone,
	"reauth_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_auth_method_ck" CHECK (method in ('demo', 'password', 'google', 'apple', 'magic_link', 'invite', 'email_verification'))
);
--> statement-breakpoint
CREATE TABLE "user_credentials" (
	"user_id" text PRIMARY KEY NOT NULL,
	"password_hash" text,
	"password_updated_at" timestamp with time zone,
	"email_verified_at" timestamp with time zone,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"first_failed_at" timestamp with time zone,
	"locked_until" timestamp with time zone,
	"last_sign_in_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cart_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"cart_id" text NOT NULL,
	"variant_id" text NOT NULL,
	"qty" smallint NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cart_lines_qty_ck" CHECK (qty between 1 and 20)
);
--> statement-breakpoint
CREATE TABLE "carts" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text,
	"anon_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "carts_owner_ck" CHECK ((customer_id is null) <> (anon_key is null))
);
--> statement-breakpoint
CREATE TABLE "checkouts" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" text DEFAULT 'pending_payment' NOT NULL,
	"currency" text NOT NULL,
	"subtotal_minor" bigint NOT NULL,
	"shipping_minor" bigint NOT NULL,
	"total_minor" bigint NOT NULL,
	"hold_key" text NOT NULL,
	"reference" text,
	"order_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"groups" jsonb NOT NULL,
	"ship_to" jsonb NOT NULL,
	"cart_id" text,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "checkouts_status_ck" CHECK (status in ('pending_payment', 'paid', 'failed', 'expired', 'review')),
	CONSTRAINT "checkouts_amounts_ck" CHECK (subtotal_minor >= 0 and shipping_minor >= 0 and total_minor = subtotal_minor + shipping_minor)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"checkout_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"provider" text NOT NULL,
	"reference" text NOT NULL,
	"status" text DEFAULT 'initialized' NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"access_code" text,
	"authorization_url" text,
	"provider_txn_id" text,
	"channel" text,
	"split_code" text,
	"init_error" text,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "payments_status_ck" CHECK (status in ('initialized', 'succeeded', 'failed', 'abandoned', 'review')),
	CONSTRAINT "payments_provider_ck" CHECK (provider in ('paystack', 'stub')),
	CONSTRAINT "payments_amount_ck" CHECK (amount_minor > 0)
);
--> statement-breakpoint
CREATE TABLE "provider_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"source" text DEFAULT 'webhook' NOT NULL,
	"event_type" text NOT NULL,
	"event_key" text NOT NULL,
	"body_sha256" text NOT NULL,
	"raw_body" text NOT NULL,
	"payload" jsonb NOT NULL,
	"signature_valid" boolean NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"subject_ref" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"last_replay_by" text,
	CONSTRAINT "provider_events_status_ck" CHECK (status in ('received', 'processed', 'ignored', 'failed')),
	CONSTRAINT "provider_events_source_ck" CHECK (source in ('webhook', 'verify', 'simulated'))
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" text PRIMARY KEY NOT NULL,
	"payment_id" text NOT NULL,
	"order_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text,
	"failure_reason" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_status_ck" CHECK (status in ('pending', 'succeeded', 'failed')),
	CONSTRAINT "refunds_provider_ck" CHECK (provider in ('paystack', 'stub')),
	CONSTRAINT "refunds_amount_ck" CHECK (amount_minor > 0)
);
--> statement-breakpoint
CREATE TABLE "transfers" (
	"id" text PRIMARY KEY NOT NULL,
	"payout_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"recipient_code" text NOT NULL,
	"reference" text NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transfers_status_ck" CHECK (status in ('pending', 'succeeded', 'failed')),
	CONSTRAINT "transfers_provider_ck" CHECK (provider in ('paystack', 'stub')),
	CONSTRAINT "transfers_amount_ck" CHECK (amount_minor > 0)
);
--> statement-breakpoint
CREATE TABLE "order_disputes" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"provider_dispute_id" text NOT NULL,
	"checkout_id" text,
	"payment_id" text,
	"order_ref_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"brand_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"category" text,
	"amount_minor" integer DEFAULT 0 NOT NULL,
	"currency" text NOT NULL,
	"evidence_due_at" timestamp with time zone,
	"brand_evidence" text,
	"brand_evidence_at" timestamp with time zone,
	"admin_note" text,
	"response_submitted_at" timestamp with time zone,
	"last_provider_event_id" text,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_disputes_status_ck" CHECK (status in ('open', 'awaiting_response', 'under_review', 'won', 'lost', 'closed')),
	CONSTRAINT "order_disputes_evidence_len_ck" CHECK (brand_evidence is null or length(brand_evidence) <= 4000),
	CONSTRAINT "order_disputes_note_len_ck" CHECK (admin_note is null or length(admin_note) <= 2000)
);
--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" text PRIMARY KEY NOT NULL,
	"order_ref_id" text NOT NULL,
	"kind" text NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_id" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_events_actor_ck" CHECK (actor_kind in ('shopper', 'brand', 'admin', 'system', 'provider'))
);
--> statement-breakpoint
CREATE TABLE "order_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"order_ref_id" text NOT NULL,
	"variant_id" text NOT NULL,
	"product_id" text NOT NULL,
	"title" text NOT NULL,
	"qty" integer NOT NULL,
	"unit_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"returned_qty" integer DEFAULT 0 NOT NULL,
	"restocked_qty" integer DEFAULT 0 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "order_lines_qty_ck" CHECK (qty > 0),
	CONSTRAINT "order_lines_unit_ck" CHECK (unit_minor >= 0),
	CONSTRAINT "order_lines_returned_ck" CHECK (returned_qty >= 0 and returned_qty <= qty),
	CONSTRAINT "order_lines_restocked_ck" CHECK (restocked_qty >= 0 and restocked_qty <= qty)
);
--> statement-breakpoint
CREATE TABLE "order_refunds" (
	"id" text PRIMARY KEY NOT NULL,
	"order_ref_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"return_id" text,
	"dispute_id" text,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"reason" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"payment_refund_id" text,
	"requested_by_kind" text NOT NULL,
	"requested_by" text,
	"ledger_posted_at" timestamp with time zone,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "order_refunds_kind_ck" CHECK (kind in ('return', 'cancellation', 'goodwill', 'dispute', 'platform')),
	CONSTRAINT "order_refunds_status_ck" CHECK (status in ('pending', 'succeeded', 'failed')),
	CONSTRAINT "order_refunds_by_ck" CHECK (requested_by_kind in ('shopper', 'brand', 'admin', 'system', 'provider')),
	CONSTRAINT "order_refunds_amount_ck" CHECK (amount_minor > 0)
);
--> statement-breakpoint
CREATE TABLE "order_return_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"return_id" text NOT NULL,
	"order_line_id" text NOT NULL,
	"qty" integer NOT NULL,
	CONSTRAINT "order_return_lines_qty_ck" CHECK (qty > 0)
);
--> statement-breakpoint
CREATE TABLE "order_returns" (
	"id" text PRIMARY KEY NOT NULL,
	"order_ref_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"reason" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"idempotency_key" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by_kind" text,
	"decided_by" text,
	"decision_reason" text,
	"received_at" timestamp with time zone,
	"received_by" text,
	"restocked" integer DEFAULT 0 NOT NULL,
	"refund_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_returns_status_ck" CHECK (status in ('requested', 'approved', 'rejected', 'received', 'cancelled', 'expired')),
	CONSTRAINT "order_returns_reason_ck" CHECK (reason in ('too_small', 'too_large', 'not_as_described', 'damaged', 'wrong_item', 'unwanted', 'other')),
	CONSTRAINT "order_returns_note_len_ck" CHECK (length(note) <= 1000)
);
--> statement-breakpoint
CREATE TABLE "order_states" (
	"order_ref_id" text PRIMARY KEY NOT NULL,
	"checkout_id" text,
	"brand_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"currency" text NOT NULL,
	"total_minor" integer NOT NULL,
	"payment_status" text DEFAULT 'pending' NOT NULL,
	"fulfilment_status" text DEFAULT 'unfulfilled' NOT NULL,
	"return_status" text DEFAULT 'none' NOT NULL,
	"dispute_status" text DEFAULT 'none' NOT NULL,
	"payment_id" text,
	"paid_at" timestamp with time zone,
	"payment_failed_reason" text,
	"refunded_minor" integer DEFAULT 0 NOT NULL,
	"ship_to" jsonb,
	"stock_released" boolean DEFAULT false NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	"cancel_reason" text,
	"delivered_at" timestamp with time zone,
	"return_window_ends_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_states_payment_ck" CHECK (payment_status in ('pending', 'paid', 'failed', 'partially_refunded', 'refunded')),
	CONSTRAINT "order_states_fulfilment_ck" CHECK (fulfilment_status in ('unfulfilled', 'processing', 'shipped', 'delivered', 'returned_to_sender', 'cancelled')),
	CONSTRAINT "order_states_return_ck" CHECK (return_status in ('none', 'requested', 'approved', 'received', 'rejected', 'cancelled', 'expired')),
	CONSTRAINT "order_states_dispute_ck" CHECK (dispute_status in ('none', 'open', 'won', 'lost')),
	CONSTRAINT "order_states_total_ck" CHECK (total_minor >= 0),
	CONSTRAINT "order_states_refunded_ck" CHECK (refunded_minor >= 0 and refunded_minor <= total_minor),
	CONSTRAINT "order_states_cancel_by_ck" CHECK (cancelled_by is null or cancelled_by in ('shopper', 'brand', 'admin', 'system'))
);
--> statement-breakpoint
CREATE TABLE "brand_payout_accounts" (
	"brand_id" text PRIMARY KEY NOT NULL,
	"country" text NOT NULL,
	"currency" text NOT NULL,
	"bank_code" text NOT NULL,
	"bank_name" text NOT NULL,
	"account_name" text NOT NULL,
	"account_number_enc" text NOT NULL,
	"account_last4" text NOT NULL,
	"recipient_code" text,
	"recipient_provider" text DEFAULT 'stub' NOT NULL,
	"updated_by" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_payout_accounts_last4_ck" CHECK (account_last4 ~ '^[0-9]{4}$'),
	CONSTRAINT "brand_payout_accounts_currency_ck" CHECK (currency ~ '^[A-Z]{3}$'),
	CONSTRAINT "brand_payout_accounts_provider_ck" CHECK (recipient_provider in ('stub', 'paystack'))
);
--> statement-breakpoint
CREATE TABLE "ledger_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_kind" text NOT NULL,
	"owner_id" text NOT NULL,
	"kind" text NOT NULL,
	"currency" text NOT NULL,
	"normal" text NOT NULL,
	"balance_minor" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_accounts_owner_kind_ck" CHECK (owner_kind in ('brand', 'platform')),
	CONSTRAINT "ledger_accounts_kind_ck" CHECK (kind in ('brand_pending', 'brand_available', 'brand_reserve', 'brand_payout_hold', 'platform_commission', 'platform_adjustments', 'provider_clearing')),
	CONSTRAINT "ledger_accounts_normal_ck" CHECK (normal in ('debit', 'credit')),
	CONSTRAINT "ledger_accounts_currency_ck" CHECK (currency ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "ledger_brand_settings" (
	"brand_id" text PRIMARY KEY NOT NULL,
	"tier_override" text,
	"commission_bps_override" integer,
	"payouts_on_hold" boolean DEFAULT false NOT NULL,
	"hold_reason" text,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_brand_settings_tier_ck" CHECK (coalesce(tier_override, 'standard') in ('new', 'standard', 'trusted')),
	CONSTRAINT "ledger_brand_settings_bps_ck" CHECK (commission_bps_override is null or commission_bps_override between 0 and 5000),
	CONSTRAINT "ledger_brand_settings_reason_len_ck" CHECK (hold_reason is null or length(hold_reason) <= 300)
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"transaction_id" text NOT NULL,
	"account_id" text NOT NULL,
	"direction" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_direction_ck" CHECK (direction in ('debit', 'credit')),
	CONSTRAINT "ledger_entries_amount_ck" CHECK (amount_minor > 0)
);
--> statement-breakpoint
CREATE TABLE "ledger_order_money" (
	"order_id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"currency" text NOT NULL,
	"payment_id" text NOT NULL,
	"gross_minor" bigint NOT NULL,
	"commission_minor" bigint NOT NULL,
	"commission_bps" integer NOT NULL,
	"tier" text NOT NULL,
	"reserve_bps" integer NOT NULL,
	"pending_minor" bigint NOT NULL,
	"reserve_minor" bigint NOT NULL,
	"refunded_minor" bigint DEFAULT 0 NOT NULL,
	"commission_refunded_minor" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'captured' NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"reserve_release_at" timestamp with time zone,
	"reserve_released_at" timestamp with time zone,
	CONSTRAINT "ledger_order_money_status_ck" CHECK (status in ('captured', 'completed', 'refunded')),
	CONSTRAINT "ledger_order_money_tier_ck" CHECK (tier in ('new', 'standard', 'trusted')),
	CONSTRAINT "ledger_order_money_amounts_ck" CHECK (gross_minor > 0 and commission_minor >= 0 and pending_minor >= 0 and reserve_minor >= 0 and refunded_minor between 0 and gross_minor)
);
--> statement-breakpoint
CREATE TABLE "ledger_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"currency" text NOT NULL,
	"brand_id" text,
	"order_id" text,
	"payment_id" text,
	"refund_id" text,
	"payout_id" text,
	"memo" text,
	"actor_kind" text DEFAULT 'system' NOT NULL,
	"actor_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_transactions_kind_ck" CHECK (kind in ('payment_captured', 'refund', 'order_completed', 'reserve_released', 'payout_requested', 'payout_cancelled', 'payout_rejected', 'payout_paid', 'payout_failed', 'payout_reversed', 'adjustment'))
);
--> statement-breakpoint
CREATE TABLE "payout_approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"payout_id" text NOT NULL,
	"admin_id" text NOT NULL,
	"admin_name" text NOT NULL,
	"step" integer NOT NULL,
	"note" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payout_approvals_step_ck" CHECK (step in (1, 2)),
	CONSTRAINT "payout_approvals_note_len_ck" CHECK (note is null or length(note) <= 500)
);
--> statement-breakpoint
CREATE TABLE "payout_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"payout_count" integer NOT NULL,
	"total_minor" bigint NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ran_by" text,
	"ran_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "payout_batches_status_ck" CHECK (status in ('open', 'running', 'done', 'partial'))
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"requested_by" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"recipient_code" text,
	"recipient_provider" text,
	"batch_id" text,
	"provider_ref" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"rejected_by" text,
	"reject_reason" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payouts_status_ck" CHECK (status in ('requested', 'awaiting_second_approval', 'approved', 'sending', 'processing', 'paid', 'failed', 'rejected', 'cancelled')),
	CONSTRAINT "payouts_amount_ck" CHECK (amount_minor > 0),
	CONSTRAINT "payouts_reason_len_ck" CHECK (reject_reason is null or length(reject_reason) <= 500)
);
--> statement-breakpoint
CREATE TABLE "reconciliation_items" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"kind" text NOT NULL,
	"ref" text NOT NULL,
	"currency" text,
	"ledger_minor" bigint,
	"provider_minor" bigint,
	"facts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	CONSTRAINT "reconciliation_items_kind_ck" CHECK (kind in ('unbalanced_transaction', 'balance_drift', 'missing_in_ledger', 'missing_at_provider', 'amount_mismatch', 'stuck_payout')),
	CONSTRAINT "reconciliation_items_status_ck" CHECK (status in ('open', 'resolved')),
	CONSTRAINT "reconciliation_items_note_len_ck" CHECK (resolution_note is null or length(resolution_note) <= 500)
);
--> statement-breakpoint
CREATE TABLE "reconciliation_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"window_from" timestamp with time zone NOT NULL,
	"window_to" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"provider_compared" boolean DEFAULT false NOT NULL,
	"checked" integer DEFAULT 0 NOT NULL,
	"mismatches" integer DEFAULT 0 NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"triggered_by" text DEFAULT 'system' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "reconciliation_runs_status_ck" CHECK (status in ('running', 'ok', 'mismatches', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "catalog_brand_onboardings" ADD CONSTRAINT "catalog_brand_onboardings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_brand_onboardings" ADD CONSTRAINT "catalog_brand_onboardings_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_brand_onboardings" ADD CONSTRAINT "catalog_brand_onboardings_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_collection_products" ADD CONSTRAINT "catalog_collection_products_collection_id_catalog_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."catalog_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_collection_products" ADD CONSTRAINT "catalog_collection_products_product_id_catalog_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."catalog_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_collections" ADD CONSTRAINT "catalog_collections_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_collections" ADD CONSTRAINT "catalog_collections_image_media_id_media_assets_id_fk" FOREIGN KEY ("image_media_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_product_images" ADD CONSTRAINT "catalog_product_images_product_id_catalog_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."catalog_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_product_images" ADD CONSTRAINT "catalog_product_images_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_product_images" ADD CONSTRAINT "catalog_product_images_media_id_media_assets_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_product_options" ADD CONSTRAINT "catalog_product_options_product_id_catalog_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."catalog_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_products" ADD CONSTRAINT "catalog_products_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_products" ADD CONSTRAINT "catalog_products_category_slug_catalog_categories_slug_fk" FOREIGN KEY ("category_slug") REFERENCES "public"."catalog_categories"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_products" ADD CONSTRAINT "catalog_products_moderated_by_users_id_fk" FOREIGN KEY ("moderated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_products" ADD CONSTRAINT "catalog_products_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_products" ADD CONSTRAINT "catalog_products_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_variants" ADD CONSTRAINT "catalog_variants_product_id_catalog_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."catalog_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_variants" ADD CONSTRAINT "catalog_variants_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_stock_holds" ADD CONSTRAINT "catalog_stock_holds_variant_id_catalog_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."catalog_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_stock_movements" ADD CONSTRAINT "catalog_stock_movements_variant_id_catalog_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."catalog_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_stock_movements" ADD CONSTRAINT "catalog_stock_movements_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_storefront_drafts" ADD CONSTRAINT "catalog_storefront_drafts_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_storefront_drafts" ADD CONSTRAINT "catalog_storefront_drafts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_storefront_versions" ADD CONSTRAINT "catalog_storefront_versions_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_storefront_versions" ADD CONSTRAINT "catalog_storefront_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "back_in_stock_requests" ADD CONSTRAINT "back_in_stock_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drop_claims" ADD CONSTRAINT "drop_claims_drop_id_drops_id_fk" FOREIGN KEY ("drop_id") REFERENCES "public"."drops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drop_claims" ADD CONSTRAINT "drop_claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drop_entries" ADD CONSTRAINT "drop_entries_drop_id_drops_id_fk" FOREIGN KEY ("drop_id") REFERENCES "public"."drops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drop_entries" ADD CONSTRAINT "drop_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drop_items" ADD CONSTRAINT "drop_items_drop_id_drops_id_fk" FOREIGN KEY ("drop_id") REFERENCES "public"."drops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drops" ADD CONSTRAINT "drops_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_brands" ADD CONSTRAINT "search_brands_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_products" ADD CONSTRAINT "search_products_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_deletions" ADD CONSTRAINT "account_deletions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_mfa" ADD CONSTRAINT "admin_mfa_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_oauth_states" ADD CONSTRAINT "auth_oauth_states_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_oauth_states" ADD CONSTRAINT "auth_oauth_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_invites" ADD CONSTRAINT "brand_invites_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_invites" ADD CONSTRAINT "brand_invites_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_invites" ADD CONSTRAINT "brand_invites_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_invites" ADD CONSTRAINT "brand_invites_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mfa_recovery_codes" ADD CONSTRAINT "mfa_recovery_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_identities" ADD CONSTRAINT "oauth_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_auth" ADD CONSTRAINT "session_auth_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_auth" ADD CONSTRAINT "session_auth_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_credentials" ADD CONSTRAINT "user_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_lines" ADD CONSTRAINT "cart_lines_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkouts" ADD CONSTRAINT "checkouts_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_checkout_id_checkouts_id_fk" FOREIGN KEY ("checkout_id") REFERENCES "public"."checkouts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_ref_id_order_refs_id_fk" FOREIGN KEY ("order_ref_id") REFERENCES "public"."order_refs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_ref_id_order_refs_id_fk" FOREIGN KEY ("order_ref_id") REFERENCES "public"."order_refs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_refunds" ADD CONSTRAINT "order_refunds_order_ref_id_order_refs_id_fk" FOREIGN KEY ("order_ref_id") REFERENCES "public"."order_refs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_refunds" ADD CONSTRAINT "order_refunds_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_refunds" ADD CONSTRAINT "order_refunds_return_id_order_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."order_returns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_return_lines" ADD CONSTRAINT "order_return_lines_return_id_order_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."order_returns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_return_lines" ADD CONSTRAINT "order_return_lines_order_line_id_order_lines_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "public"."order_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_returns" ADD CONSTRAINT "order_returns_order_ref_id_order_refs_id_fk" FOREIGN KEY ("order_ref_id") REFERENCES "public"."order_refs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_returns" ADD CONSTRAINT "order_returns_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_returns" ADD CONSTRAINT "order_returns_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_states" ADD CONSTRAINT "order_states_order_ref_id_order_refs_id_fk" FOREIGN KEY ("order_ref_id") REFERENCES "public"."order_refs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_states" ADD CONSTRAINT "order_states_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_states" ADD CONSTRAINT "order_states_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_payout_accounts" ADD CONSTRAINT "brand_payout_accounts_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_brand_settings" ADD CONSTRAINT "ledger_brand_settings_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_id_ledger_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_order_money" ADD CONSTRAINT "ledger_order_money_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_approvals" ADD CONSTRAINT "payout_approvals_payout_id_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."payouts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_items" ADD CONSTRAINT "reconciliation_items_run_id_reconciliation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."reconciliation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_brand_onboardings_open_ux" ON "catalog_brand_onboardings" USING btree ("user_id") WHERE status in ('draft', 'submitted');--> statement-breakpoint
CREATE INDEX "catalog_brand_onboardings_status_ix" ON "catalog_brand_onboardings" USING btree ("status","submitted_at");--> statement-breakpoint
CREATE INDEX "catalog_collection_products_product_ix" ON "catalog_collection_products" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_collections_brand_handle_ux" ON "catalog_collections" USING btree ("brand_id","handle");--> statement-breakpoint
CREATE INDEX "catalog_product_images_product_ix" ON "catalog_product_images" USING btree ("product_id","position");--> statement-breakpoint
CREATE INDEX "catalog_product_images_media_ix" ON "catalog_product_images" USING btree ("media_id");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_product_options_name_ux" ON "catalog_product_options" USING btree ("product_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_products_slug_ux" ON "catalog_products" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "catalog_products_brand_status_ix" ON "catalog_products" USING btree ("brand_id","status");--> statement-breakpoint
CREATE INDEX "catalog_products_public_ix" ON "catalog_products" USING btree ("status","moderation_status","created_at");--> statement-breakpoint
CREATE INDEX "catalog_products_category_ix" ON "catalog_products" USING btree ("category_slug");--> statement-breakpoint
CREATE INDEX "catalog_products_scheduled_ix" ON "catalog_products" USING btree ("publish_at") WHERE status = 'scheduled';--> statement-breakpoint
CREATE INDEX "catalog_variants_product_ix" ON "catalog_variants" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_variants_brand_sku_ux" ON "catalog_variants" USING btree ("brand_id","sku");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_stock_holds_key_variant_ux" ON "catalog_stock_holds" USING btree ("hold_key","variant_id");--> statement-breakpoint
CREATE INDEX "catalog_stock_holds_active_ix" ON "catalog_stock_holds" USING btree ("expires_at") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "catalog_stock_movements_variant_ix" ON "catalog_stock_movements" USING btree ("variant_id","created_at");--> statement-breakpoint
CREATE INDEX "catalog_stock_movements_ref_ix" ON "catalog_stock_movements" USING btree ("ref_type","ref_id");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_storefront_versions_brand_version_ux" ON "catalog_storefront_versions" USING btree ("brand_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "back_in_stock_user_variant_ux" ON "back_in_stock_requests" USING btree ("user_id","variant_id");--> statement-breakpoint
CREATE INDEX "back_in_stock_pending_ix" ON "back_in_stock_requests" USING btree ("variant_id") WHERE notified_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "drop_claims_checkout_variant_ux" ON "drop_claims" USING btree ("checkout_id","drop_id","variant_id");--> statement-breakpoint
CREATE INDEX "drop_claims_drop_user_ix" ON "drop_claims" USING btree ("drop_id","user_id","status");--> statement-breakpoint
CREATE INDEX "drop_claims_pending_ix" ON "drop_claims" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "drop_entries_drop_user_ux" ON "drop_entries" USING btree ("drop_id","user_id");--> statement-breakpoint
CREATE INDEX "drop_entries_drop_status_ix" ON "drop_entries" USING btree ("drop_id","status","rank");--> statement-breakpoint
CREATE INDEX "drop_entries_user_ix" ON "drop_entries" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "drop_items_variant_ix" ON "drop_items" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "drop_items_product_ix" ON "drop_items" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "drops_slug_ux" ON "drops" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "drops_status_starts_ix" ON "drops" USING btree ("status","starts_at");--> statement-breakpoint
CREATE INDEX "drops_brand_starts_ix" ON "drops" USING btree ("brand_id","starts_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "email_outbox_dedupe_ux" ON "email_outbox" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "email_outbox_due_ix" ON "email_outbox" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "email_outbox_to_ix" ON "email_outbox" USING btree (lower(to_email),"created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "email_suppressions_email_category_ux" ON "email_suppressions" USING btree ("email_lower","category");--> statement-breakpoint
CREATE INDEX "search_brands_tsv_ix" ON "search_brands" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "search_products_tsv_ix" ON "search_products" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "search_products_brand_ix" ON "search_products" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "search_products_category_ix" ON "search_products" USING btree ("category");--> statement-breakpoint
CREATE INDEX "search_products_price_ix" ON "search_products" USING btree ("price_usd_minor");--> statement-breakpoint
CREATE UNIQUE INDEX "account_deletions_open_ux" ON "account_deletions" USING btree ("user_id") WHERE status in ('pending', 'processing');--> statement-breakpoint
CREATE INDEX "account_deletions_due_ix" ON "account_deletions" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE INDEX "auth_oauth_states_expires_ix" ON "auth_oauth_states" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_tokens_hash_ux" ON "auth_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_tokens_user_purpose_ix" ON "auth_tokens" USING btree ("user_id","purpose");--> statement-breakpoint
CREATE INDEX "auth_tokens_expires_ix" ON "auth_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "brand_invites_token_ux" ON "brand_invites" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "brand_invites_pending_ux" ON "brand_invites" USING btree ("brand_id",lower(email)) WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "brand_invites_brand_ix" ON "brand_invites" USING btree ("brand_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "mfa_recovery_codes_hash_ux" ON "mfa_recovery_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "mfa_recovery_codes_user_ix" ON "mfa_recovery_codes" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_identities_provider_subject_ux" ON "oauth_identities" USING btree ("provider","subject");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_identities_user_provider_ux" ON "oauth_identities" USING btree ("user_id","provider");--> statement-breakpoint
CREATE INDEX "oauth_identities_user_ix" ON "oauth_identities" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_auth_user_ix" ON "session_auth" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_credentials_locked_ix" ON "user_credentials" USING btree ("locked_until");--> statement-breakpoint
CREATE UNIQUE INDEX "cart_lines_variant_ux" ON "cart_lines" USING btree ("cart_id","variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "carts_customer_ux" ON "carts" USING btree ("customer_id") WHERE customer_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "carts_anon_ux" ON "carts" USING btree ("anon_key") WHERE anon_key is not null;--> statement-breakpoint
CREATE INDEX "carts_updated_ix" ON "carts" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "checkouts_idem_ux" ON "checkouts" USING btree ("customer_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "checkouts_customer_ix" ON "checkouts" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "checkouts_status_exp_ix" ON "checkouts" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_reference_ux" ON "payments" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "payments_checkout_ix" ON "payments" USING btree ("checkout_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_checkout_live_ux" ON "payments" USING btree ("checkout_id") WHERE status in ('initialized', 'succeeded', 'review');--> statement-breakpoint
CREATE UNIQUE INDEX "provider_events_key_ux" ON "provider_events" USING btree ("provider","event_key");--> statement-breakpoint
CREATE INDEX "provider_events_status_ix" ON "provider_events" USING btree ("status","received_at");--> statement-breakpoint
CREATE INDEX "provider_events_type_ix" ON "provider_events" USING btree ("event_type","received_at");--> statement-breakpoint
CREATE INDEX "provider_events_subject_ix" ON "provider_events" USING btree ("subject_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_idem_ux" ON "refunds" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "refunds_payment_ix" ON "refunds" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "refunds_order_ix" ON "refunds" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "refunds_provider_ref_ix" ON "refunds" USING btree ("provider_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "transfers_payout_ux" ON "transfers" USING btree ("payout_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transfers_reference_ux" ON "transfers" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "transfers_brand_ix" ON "transfers" USING btree ("brand_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "order_disputes_provider_ux" ON "order_disputes" USING btree ("provider","provider_dispute_id");--> statement-breakpoint
CREATE INDEX "order_disputes_status_ix" ON "order_disputes" USING btree ("status","opened_at");--> statement-breakpoint
CREATE INDEX "order_disputes_checkout_ix" ON "order_disputes" USING btree ("checkout_id");--> statement-breakpoint
CREATE INDEX "order_events_order_ix" ON "order_events" USING btree ("order_ref_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "order_lines_order_variant_ux" ON "order_lines" USING btree ("order_ref_id","variant_id");--> statement-breakpoint
CREATE INDEX "order_refunds_order_ix" ON "order_refunds" USING btree ("order_ref_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "order_refunds_idempotency_ux" ON "order_refunds" USING btree ("order_ref_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "order_refunds_payment_refund_ux" ON "order_refunds" USING btree ("payment_refund_id") WHERE payment_refund_id is not null;--> statement-breakpoint
CREATE INDEX "order_refunds_status_ix" ON "order_refunds" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "order_return_lines_ux" ON "order_return_lines" USING btree ("return_id","order_line_id");--> statement-breakpoint
CREATE INDEX "order_returns_order_ix" ON "order_returns" USING btree ("order_ref_id","requested_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "order_returns_brand_status_ix" ON "order_returns" USING btree ("brand_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "order_returns_idempotency_ux" ON "order_returns" USING btree ("customer_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "order_returns_open_ux" ON "order_returns" USING btree ("order_ref_id") WHERE status in ('requested', 'approved');--> statement-breakpoint
CREATE INDEX "order_states_checkout_ix" ON "order_states" USING btree ("checkout_id");--> statement-breakpoint
CREATE INDEX "order_states_payment_ix" ON "order_states" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "order_states_brand_ix" ON "order_states" USING btree ("brand_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "order_states_customer_ix" ON "order_states" USING btree ("customer_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "order_states_completion_ix" ON "order_states" USING btree ("return_window_ends_at") WHERE completed_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_accounts_owner_kind_ccy_ux" ON "ledger_accounts" USING btree ("owner_kind","owner_id","kind","currency");--> statement-breakpoint
CREATE INDEX "ledger_entries_tx_ix" ON "ledger_entries" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_account_ix" ON "ledger_entries" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "ledger_order_money_brand_ix" ON "ledger_order_money" USING btree ("brand_id","status");--> statement-breakpoint
CREATE INDEX "ledger_order_money_payment_ix" ON "ledger_order_money" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "ledger_order_money_reserve_ix" ON "ledger_order_money" USING btree ("reserve_release_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_transactions_idem_ux" ON "ledger_transactions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "ledger_transactions_brand_ix" ON "ledger_transactions" USING btree ("brand_id","created_at");--> statement-breakpoint
CREATE INDEX "ledger_transactions_order_ix" ON "ledger_transactions" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "ledger_transactions_payment_ix" ON "ledger_transactions" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "ledger_transactions_refund_ix" ON "ledger_transactions" USING btree ("refund_id");--> statement-breakpoint
CREATE INDEX "ledger_transactions_payout_ix" ON "ledger_transactions" USING btree ("payout_id");--> statement-breakpoint
CREATE INDEX "ledger_transactions_created_ix" ON "ledger_transactions" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payout_approvals_admin_ux" ON "payout_approvals" USING btree ("payout_id","admin_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payout_approvals_step_ux" ON "payout_approvals" USING btree ("payout_id","step");--> statement-breakpoint
CREATE INDEX "payout_batches_created_ix" ON "payout_batches" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payouts_brand_idem_ux" ON "payouts" USING btree ("brand_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "payouts_brand_ix" ON "payouts" USING btree ("brand_id","requested_at");--> statement-breakpoint
CREATE INDEX "payouts_status_ix" ON "payouts" USING btree ("status","requested_at");--> statement-breakpoint
CREATE INDEX "payouts_batch_ix" ON "payouts" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "payouts_provider_ref_ix" ON "payouts" USING btree ("provider_ref");--> statement-breakpoint
CREATE INDEX "reconciliation_items_run_ix" ON "reconciliation_items" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "reconciliation_items_status_ix" ON "reconciliation_items" USING btree ("status");--> statement-breakpoint
CREATE INDEX "reconciliation_runs_started_ix" ON "reconciliation_runs" USING btree ("started_at");