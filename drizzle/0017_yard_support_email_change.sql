ALTER TABLE "auth_tokens" DROP CONSTRAINT "auth_tokens_purpose_ck";--> statement-breakpoint
ALTER TABLE "conversation_participants" DROP CONSTRAINT "conversation_participants_side_ck";--> statement-breakpoint
ALTER TABLE "message_reactions" DROP CONSTRAINT "message_reactions_side_ck";--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_sender_side_ck";--> statement-breakpoint
ALTER TABLE "conversations" ALTER COLUMN "brand_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ALTER COLUMN "customer_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "kind" text DEFAULT 'brand' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "assigned_admin_id" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assigned_admin_id_users_id_fk" FOREIGN KEY ("assigned_admin_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_support_shopper_ux" ON "conversations" USING btree ("customer_id") WHERE kind = 'support' and brand_id is null;--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_support_brand_ux" ON "conversations" USING btree ("brand_id") WHERE kind = 'support' and customer_id is null;--> statement-breakpoint
CREATE INDEX "conversations_support_queue_ix" ON "conversations" USING btree ("kind","status","last_message_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_purpose_ck" CHECK (purpose in ('verify_email', 'reset_password', 'magic_link', 'mfa_challenge', 'change_email'));--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_side_ck" CHECK (side in ('customer', 'brand', 'support'));--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_kind_ck" CHECK (kind in ('brand', 'support'));--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_parties_ck" CHECK ((kind = 'brand' and brand_id is not null and customer_id is not null) or (kind = 'support' and (brand_id is null) <> (customer_id is null)));--> statement-breakpoint
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_side_ck" CHECK (side in ('customer', 'brand', 'support'));--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_side_ck" CHECK (sender_side in ('customer', 'brand', 'system', 'support'));