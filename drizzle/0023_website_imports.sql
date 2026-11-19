CREATE TABLE "catalog_import_items" (
	"import_id" text NOT NULL,
	"key" text NOT NULL,
	"brand_id" text NOT NULL,
	"source_url" text NOT NULL,
	"title" text NOT NULL,
	"choice" jsonb,
	"status" text DEFAULT 'queued' NOT NULL,
	"reason" text,
	"proposal_id" text,
	"media_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"images_total" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_import_items_import_id_key_pk" PRIMARY KEY("import_id","key"),
	CONSTRAINT "catalog_import_items_status_ck" CHECK (status in ('queued', 'created', 'skipped', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "catalog_imports" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"source_url" text NOT NULL,
	"start_url" text,
	"platform" text,
	"status" text DEFAULT 'scanning' NOT NULL,
	"consent_at" timestamp with time zone NOT NULL,
	"progress" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"brand" jsonb,
	"found" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"profile" jsonb,
	"note" text,
	"lease_until" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "catalog_imports_status_ck" CHECK (status in ('scanning', 'scanned', 'importing', 'done', 'failed')),
	CONSTRAINT "catalog_imports_platform_ck" CHECK (platform in ('shopify', 'woocommerce', 'labeld', 'generic'))
);
--> statement-breakpoint
ALTER TABLE "catalog_import_items" ADD CONSTRAINT "catalog_import_items_import_id_catalog_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."catalog_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_import_items" ADD CONSTRAINT "catalog_import_items_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_import_items" ADD CONSTRAINT "catalog_import_items_proposal_id_product_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."product_proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_imports" ADD CONSTRAINT "catalog_imports_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_imports" ADD CONSTRAINT "catalog_imports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_import_items_source_ix" ON "catalog_import_items" USING btree ("brand_id","source_url");--> statement-breakpoint
CREATE INDEX "catalog_imports_brand_ix" ON "catalog_imports" USING btree ("brand_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "catalog_imports_status_ix" ON "catalog_imports" USING btree ("status","lease_until");