CREATE TABLE "app_attest_challenges" (
	"hash" text PRIMARY KEY NOT NULL,
	"purpose" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_attest_challenges_purpose_ck" CHECK (purpose in ('request', 'register'))
);
--> statement-breakpoint
CREATE TABLE "app_attest_keys" (
	"key_id" text PRIMARY KEY NOT NULL,
	"public_key" text NOT NULL,
	"counter" bigint DEFAULT 0 NOT NULL,
	"environment" text NOT NULL,
	"user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "app_attest_keys_environment_ck" CHECK (environment in ('production', 'development'))
);
--> statement-breakpoint
ALTER TABLE "app_attest_keys" ADD CONSTRAINT "app_attest_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_attest_challenges_expires_ix" ON "app_attest_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "app_attest_keys_user_ix" ON "app_attest_keys" USING btree ("user_id");