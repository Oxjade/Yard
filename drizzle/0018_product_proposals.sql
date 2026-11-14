CREATE TABLE "product_proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"product_id" text,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"base" jsonb,
	"base_version" integer,
	"base_updated_at" timestamp with time zone,
	"note" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_by_admin_id" text NOT NULL,
	"decided_by_user_id" text,
	"decided_at" timestamp with time zone,
	"decline_reason" text,
	"supersedes_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_proposals_kind_ck" CHECK (kind in ('new', 'edit')),
	CONSTRAINT "product_proposals_status_ck" CHECK (status in ('pending', 'accepted', 'declined', 'withdrawn', 'superseded')),
	CONSTRAINT "product_proposals_product_ck" CHECK (kind = 'new' or product_id is not null)
);
--> statement-breakpoint
ALTER TABLE "product_proposals" ADD CONSTRAINT "product_proposals_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_proposals" ADD CONSTRAINT "product_proposals_product_id_catalog_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."catalog_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_proposals" ADD CONSTRAINT "product_proposals_created_by_admin_id_users_id_fk" FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_proposals" ADD CONSTRAINT "product_proposals_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_proposals_brand_status_ix" ON "product_proposals" USING btree ("brand_id","status","created_at");--> statement-breakpoint
CREATE INDEX "product_proposals_status_ix" ON "product_proposals" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "product_proposals_pending_edit_ux" ON "product_proposals" USING btree ("product_id") WHERE status = 'pending' and kind = 'edit';