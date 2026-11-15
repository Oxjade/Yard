ALTER TABLE "brands" ADD COLUMN "nudge_emails" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "last_nudged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "storefront_nudged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "catalog_products" ADD COLUMN "draft_nudged_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "catalog_products_draft_nudge_ix" ON "catalog_products" USING btree ("created_at") WHERE status = 'draft' and draft_nudged_at is null and published_at is null;