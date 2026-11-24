ALTER TABLE "brands" ADD COLUMN "unpublished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "unpublished_by" text;--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_unpublished_by_users_id_fk" FOREIGN KEY ("unpublished_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;