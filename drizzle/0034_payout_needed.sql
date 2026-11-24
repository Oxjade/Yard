ALTER TABLE "brands" ADD COLUMN "payout_needed_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "payout_needed_emailed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "payout_needed_reminded_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "brands_payout_needed_ix" ON "brands" USING btree ("payout_needed_since") WHERE payout_needed_since is not null and payout_needed_reminded_at is null;--> statement-breakpoint
-- Brands already holding earnings without a payout account start their reminder clock at their first such sale.
UPDATE "brands" b SET "payout_needed_since" = m.first_at FROM (SELECT "brand_id", min("captured_at") AS first_at FROM "ledger_order_money" WHERE "status" <> 'refunded' GROUP BY "brand_id") m WHERE m."brand_id" = b."id" AND NOT EXISTS (SELECT 1 FROM "brand_payout_accounts" a WHERE a."brand_id" = b."id");
