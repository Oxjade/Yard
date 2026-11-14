CREATE TABLE "push_devices" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"platform" text NOT NULL,
	"token" text NOT NULL,
	"app_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_devices_platform_ck" CHECK (platform in ('android', 'ios'))
);
--> statement-breakpoint
CREATE TABLE "auth_app_handoffs" (
	"id" text PRIMARY KEY NOT NULL,
	"code_hash" text NOT NULL,
	"user_id" text NOT NULL,
	"actor" text NOT NULL,
	"brand_id" text,
	"client" text NOT NULL,
	"challenge" text NOT NULL,
	"provider" text NOT NULL,
	"mode" text NOT NULL,
	"result" text NOT NULL,
	"is_new" boolean DEFAULT false NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "auth_app_handoffs_client_ck" CHECK (client in ('android', 'ios')),
	CONSTRAINT "auth_app_handoffs_provider_ck" CHECK (provider in ('google', 'apple', 'auth0')),
	CONSTRAINT "auth_app_handoffs_actor_ck" CHECK (actor in ('shopper', 'brand', 'admin'))
);
--> statement-breakpoint
ALTER TABLE "auth_oauth_states" ADD COLUMN "app_client" text;--> statement-breakpoint
ALTER TABLE "auth_oauth_states" ADD COLUMN "app_challenge" text;--> statement-breakpoint
ALTER TABLE "push_devices" ADD CONSTRAINT "push_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_app_handoffs" ADD CONSTRAINT "auth_app_handoffs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_app_handoffs" ADD CONSTRAINT "auth_app_handoffs_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "push_devices_token_ux" ON "push_devices" USING btree ("token");--> statement-breakpoint
CREATE INDEX "push_devices_user_ix" ON "push_devices" USING btree ("user_id","platform");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_app_handoffs_code_hash_ux" ON "auth_app_handoffs" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "auth_app_handoffs_expires_ix" ON "auth_app_handoffs" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "auth_app_handoffs_user_ix" ON "auth_app_handoffs" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "auth_oauth_states" ADD CONSTRAINT "auth_oauth_states_app_client_ck" CHECK (app_client in ('android', 'ios'));