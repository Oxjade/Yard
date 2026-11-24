CREATE INDEX "shopper_follows_brand_ix" ON "shopper_follows" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "shopper_reminders_drop_ix" ON "shopper_reminders" USING btree ("drop_id");--> statement-breakpoint
CREATE INDEX "payments_created_ix" ON "payments" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ledger_order_money_captured_ix" ON "ledger_order_money" USING btree ("captured_at");