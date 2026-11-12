ALTER TABLE "payments" DROP CONSTRAINT "payments_provider_ck";--> statement-breakpoint
ALTER TABLE "refunds" DROP CONSTRAINT "refunds_provider_ck";--> statement-breakpoint
ALTER TABLE "transfers" DROP CONSTRAINT "transfers_provider_ck";--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_provider_ck" CHECK (provider in ('paystack', 'bachs', 'stub'));--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_provider_ck" CHECK (provider in ('paystack', 'bachs', 'stub'));--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_provider_ck" CHECK (provider in ('paystack', 'bachs', 'stub'));