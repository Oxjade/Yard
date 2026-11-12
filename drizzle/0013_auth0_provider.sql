ALTER TABLE "auth_oauth_states" DROP CONSTRAINT "auth_oauth_states_provider_ck";--> statement-breakpoint
ALTER TABLE "oauth_identities" DROP CONSTRAINT "oauth_identities_provider_ck";--> statement-breakpoint
ALTER TABLE "session_auth" DROP CONSTRAINT "session_auth_method_ck";--> statement-breakpoint
DROP INDEX "oauth_identities_user_provider_ux";--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_identities_user_provider_ux" ON "oauth_identities" USING btree ("user_id","provider") WHERE provider <> 'auth0';--> statement-breakpoint
ALTER TABLE "auth_oauth_states" ADD CONSTRAINT "auth_oauth_states_provider_ck" CHECK (provider in ('google', 'apple', 'auth0'));--> statement-breakpoint
ALTER TABLE "oauth_identities" ADD CONSTRAINT "oauth_identities_provider_ck" CHECK (provider in ('google', 'apple', 'auth0'));--> statement-breakpoint
ALTER TABLE "session_auth" ADD CONSTRAINT "session_auth_method_ck" CHECK (method in ('demo', 'password', 'google', 'apple', 'auth0', 'magic_link', 'invite', 'email_verification', 'yard_setup', 'claim'));