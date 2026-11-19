CREATE TABLE "catalog_site_pieces" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"url_key" text NOT NULL,
	"source_url" text NOT NULL,
	"source_id" text,
	"title" text NOT NULL,
	"status" text NOT NULL,
	"origin" text NOT NULL,
	"reason" text,
	"product" jsonb,
	"media_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"baseline" jsonb,
	"change" jsonb,
	"decided_kind" text,
	"decided_by" text,
	"decided_by_name" text,
	"decided_at" timestamp with time zone,
	"lease_until" timestamp with time zone,
	"proposal_id" text,
	"product_id" text,
	"run_id" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_site_pieces_status_ck" CHECK (status in ('imported', 'ignored', 'waiting', 'approving', 'approved', 'skipped')),
	CONSTRAINT "catalog_site_pieces_origin_ck" CHECK (origin in ('import', 'watch')),
	CONSTRAINT "catalog_site_pieces_decided_ck" CHECK (decided_kind in ('admin', 'brand'))
);
--> statement-breakpoint
CREATE TABLE "catalog_watches" (
	"brand_id" text PRIMARY KEY NOT NULL,
	"source_url" text NOT NULL,
	"platform" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"paused_note" text,
	"failures" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"last_scan_at" timestamp with time zone,
	"last_ok_at" timestamp with time zone,
	"next_scan_at" timestamp with time zone NOT NULL,
	"lease_until" timestamp with time zone,
	"last_run" jsonb,
	"created_by" text,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_watches_status_ck" CHECK (status in ('active', 'paused')),
	CONSTRAINT "catalog_watches_platform_ck" CHECK (platform in ('shopify', 'woocommerce', 'labeld', 'generic'))
);
--> statement-breakpoint
ALTER TABLE "catalog_site_pieces" ADD CONSTRAINT "catalog_site_pieces_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_site_pieces" ADD CONSTRAINT "catalog_site_pieces_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_site_pieces" ADD CONSTRAINT "catalog_site_pieces_proposal_id_product_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."product_proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_site_pieces" ADD CONSTRAINT "catalog_site_pieces_product_id_catalog_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."catalog_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_watches" ADD CONSTRAINT "catalog_watches_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_watches" ADD CONSTRAINT "catalog_watches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_site_pieces_url_ux" ON "catalog_site_pieces" USING btree ("brand_id","url_key");--> statement-breakpoint
CREATE INDEX "catalog_site_pieces_status_ix" ON "catalog_site_pieces" USING btree ("brand_id","status");--> statement-breakpoint
CREATE INDEX "catalog_site_pieces_lease_ix" ON "catalog_site_pieces" USING btree ("status","lease_until");--> statement-breakpoint
CREATE INDEX "catalog_watches_due_ix" ON "catalog_watches" USING btree ("enabled","status","next_scan_at");