CREATE TABLE "live_activity_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"order_ref_id" text,
	"kind" text NOT NULL,
	"token" text NOT NULL,
	"time_zone" text,
	"app_version" text,
	"last_state" jsonb,
	"last_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "live_activity_tokens_kind_ck" CHECK (kind in ('update', 'start')),
	CONSTRAINT "live_activity_tokens_order_ck" CHECK ((kind = 'update') = (order_ref_id is not null))
);
--> statement-breakpoint
ALTER TABLE "live_activity_tokens" ADD CONSTRAINT "live_activity_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_activity_tokens" ADD CONSTRAINT "live_activity_tokens_order_ref_id_order_refs_id_fk" FOREIGN KEY ("order_ref_id") REFERENCES "public"."order_refs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "live_activity_tokens_token_ux" ON "live_activity_tokens" USING btree ("token");--> statement-breakpoint
CREATE INDEX "live_activity_tokens_order_ix" ON "live_activity_tokens" USING btree ("order_ref_id");--> statement-breakpoint
CREATE INDEX "live_activity_tokens_user_ix" ON "live_activity_tokens" USING btree ("user_id","kind");