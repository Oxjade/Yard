CREATE TABLE "newsletter_campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"kind" text DEFAULT 'marketing' NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"preheader" text DEFAULT '' NOT NULL,
	"heading" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"greet" boolean DEFAULT true NOT NULL,
	"hero_media_id" text,
	"hero_alt" text DEFAULT '' NOT NULL,
	"button_label" text DEFAULT '' NOT NULL,
	"button_url" text DEFAULT '' NOT NULL,
	"audience" text DEFAULT 'shoppers' NOT NULL,
	"audience_brand_id" text,
	"audience_country" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"scheduled_for" timestamp with time zone,
	"send_key" text,
	"confirmed_count" integer,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"recipients_total" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_by_name" text,
	"updated_by" text,
	"updated_by_name" text,
	"sent_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "newsletter_campaigns_status_ck" CHECK (status in ('draft', 'scheduled', 'sending', 'sent', 'cancelled')),
	CONSTRAINT "newsletter_campaigns_kind_ck" CHECK (kind in ('marketing', 'service')),
	CONSTRAINT "newsletter_campaigns_audience_ck" CHECK (audience in ('shoppers', 'brands', 'followers', 'country'))
);
--> statement-breakpoint
CREATE TABLE "newsletter_recipients" (
	"campaign_id" text NOT NULL,
	"user_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"dedupe_key" text NOT NULL,
	"last_error" text,
	"queued_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"unsubscribed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "newsletter_recipients_pk" PRIMARY KEY("campaign_id","user_id"),
	CONSTRAINT "newsletter_recipients_status_ck" CHECK (status in ('pending', 'queued', 'sent', 'failed', 'suppressed', 'stub', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "email_outbox" DROP CONSTRAINT "email_outbox_category_ck";--> statement-breakpoint
ALTER TABLE "email_suppressions" DROP CONSTRAINT "email_suppressions_category_ck";--> statement-breakpoint
ALTER TABLE "media_assets" DROP CONSTRAINT "media_assets_purpose_ck";--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD COLUMN "email_marketing" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "newsletter_campaigns" ADD CONSTRAINT "newsletter_campaigns_audience_brand_id_brands_id_fk" FOREIGN KEY ("audience_brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_campaigns" ADD CONSTRAINT "newsletter_campaigns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_campaigns" ADD CONSTRAINT "newsletter_campaigns_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_recipients" ADD CONSTRAINT "newsletter_recipients_campaign_id_newsletter_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."newsletter_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_recipients" ADD CONSTRAINT "newsletter_recipients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "newsletter_campaigns_status_ix" ON "newsletter_campaigns" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE INDEX "newsletter_campaigns_updated_ix" ON "newsletter_campaigns" USING btree ("updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "newsletter_recipients_status_ix" ON "newsletter_recipients" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE INDEX "newsletter_recipients_email_ix" ON "newsletter_recipients" USING btree (lower(email));--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_category_ck" CHECK (category in ('account', 'orders', 'payouts', 'drops', 'price_drops', 'back_in_stock', 'brand_news', 'marketing', 'service'));--> statement-breakpoint
ALTER TABLE "email_suppressions" ADD CONSTRAINT "email_suppressions_category_ck" CHECK (category in ('all', 'account', 'orders', 'payouts', 'drops', 'price_drops', 'back_in_stock', 'brand_news', 'marketing', 'service'));--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_purpose_ck" CHECK (purpose in ('social_post', 'inbox_attachment', 'location_image', 'social_import', 'sample', 'onboarding_image', 'storefront_cover', 'drop_image', 'account_photo', 'newsletter_image'));