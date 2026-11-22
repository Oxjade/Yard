ALTER TABLE "brands" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "closed_by" text;--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;