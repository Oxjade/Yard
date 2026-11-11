ALTER TABLE "brand_members" DROP CONSTRAINT "brand_members_role_ck";--> statement-breakpoint
ALTER TABLE "session_auth" DROP CONSTRAINT "session_auth_method_ck";--> statement-breakpoint
ALTER TABLE "brand_members" ADD COLUMN "granted_by" text;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "founding" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "founding_badge" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "claim_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "claimed_by" text;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "launched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "story" text;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "logo_media_id" text;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "instagram" text;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "tiktok" text;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "seller_agreement_version" text;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "seller_agreement_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "creation_key" text;--> statement-breakpoint
ALTER TABLE "brand_invites" ADD COLUMN "kind" text DEFAULT 'team' NOT NULL;--> statement-breakpoint
ALTER TABLE "brand_invites" ADD COLUMN "agreement_version" text;--> statement-breakpoint
ALTER TABLE "brand_invites" ADD COLUMN "agreement_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "brand_members" ADD CONSTRAINT "brand_members_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_claimed_by_users_id_fk" FOREIGN KEY ("claimed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "brands_creation_key_ux" ON "brands" USING btree ("created_by","creation_key") WHERE creation_key is not null;--> statement-breakpoint
CREATE INDEX "brands_founding_ix" ON "brands" USING btree ("claim_status","launched_at") WHERE founding;--> statement-breakpoint
CREATE UNIQUE INDEX "brand_invites_claim_pending_ux" ON "brand_invites" USING btree ("brand_id") WHERE kind = 'founding_claim' and status = 'pending';--> statement-breakpoint
ALTER TABLE "brand_members" ADD CONSTRAINT "brand_members_role_ck" CHECK (role in ('owner', 'admin', 'designer', 'fulfilment', 'finance', 'viewer', 'yard_setup'));--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_claim_status_ck" CHECK (claim_status in ('none', 'unclaimed', 'claimed'));--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_story_len_ck" CHECK (story is null or char_length(story) <= 2000);--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_instagram_ck" CHECK (instagram is null or instagram ~ '^[A-Za-z0-9._]{1,30}$');--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_tiktok_ck" CHECK (tiktok is null or tiktok ~ '^[A-Za-z0-9._]{1,24}$');--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_founding_claim_ck" CHECK ((founding and claim_status <> 'none') or (not founding and claim_status = 'none'));--> statement-breakpoint
ALTER TABLE "brand_invites" ADD CONSTRAINT "brand_invites_kind_ck" CHECK (kind in ('team', 'founding_claim'));--> statement-breakpoint
ALTER TABLE "session_auth" ADD CONSTRAINT "session_auth_method_ck" CHECK (method in ('demo', 'password', 'google', 'apple', 'magic_link', 'invite', 'email_verification', 'yard_setup', 'claim'));