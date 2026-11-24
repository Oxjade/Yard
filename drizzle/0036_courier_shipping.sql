CREATE TABLE "courier_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"kind" text NOT NULL,
	"event_key" text,
	"order_ref_id" text,
	"shipment_id" text,
	"status" text,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "courier_events_kind_ck" CHECK (kind in ('webhook', 'quote_failed', 'book_failed', 'track_failed', 'wallet_failed', 'price_over_cap', 'wallet_low', 'unmatched')),
	CONSTRAINT "courier_events_detail_len_ck" CHECK (detail is null or length(detail) <= 500)
);
--> statement-breakpoint
CREATE TABLE "courier_quotes" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"provider" text NOT NULL,
	"cache_key" text NOT NULL,
	"request_token" text NOT NULL,
	"currency" text NOT NULL,
	"options" jsonb NOT NULL,
	"pickup_date" date,
	"expires_at" timestamp with time zone NOT NULL,
	"token_expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "courier_quotes_provider_ck" CHECK (provider in ('shipbubble', 'topship', 'mock'))
);
--> statement-breakpoint
CREATE TABLE "courier_settings" (
	"brand_id" text PRIMARY KEY NOT NULL,
	"contact_name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text NOT NULL,
	"address" text NOT NULL,
	"city" text NOT NULL,
	"state" text DEFAULT '' NOT NULL,
	"country" text DEFAULT 'NG' NOT NULL,
	"provider" text,
	"provider_address_code" text,
	"formatted_address" text,
	"verified_at" timestamp with time zone,
	"parcel_weight_grams" integer DEFAULT 500 NOT NULL,
	"parcel_length_cm" smallint DEFAULT 30 NOT NULL,
	"parcel_width_cm" smallint DEFAULT 25 NOT NULL,
	"parcel_height_cm" smallint DEFAULT 10 NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "courier_settings_weight_ck" CHECK (parcel_weight_grams between 10 and 70000),
	CONSTRAINT "courier_settings_dims_ck" CHECK (parcel_length_cm between 1 and 300 and parcel_width_cm between 1 and 300 and parcel_height_cm between 1 and 300),
	CONSTRAINT "courier_settings_country_ck" CHECK (country ~ '^[A-Z]{2}$'),
	CONSTRAINT "courier_settings_len_ck" CHECK (length(address) between 5 and 300 and length(contact_name) between 1 and 120 and length(phone) between 6 and 30 and length(email) between 3 and 200)
);
--> statement-breakpoint
CREATE TABLE "courier_shipments" (
	"id" text PRIMARY KEY NOT NULL,
	"order_ref_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'booking' NOT NULL,
	"provider_order_id" text,
	"courier_id" text,
	"service_code" text,
	"courier_name" text,
	"tracking_code" text,
	"tracking_url" text,
	"label_url" text,
	"currency" text NOT NULL,
	"collected_minor" bigint NOT NULL,
	"cost_minor" bigint,
	"price_diff_minor" bigint DEFAULT 0 NOT NULL,
	"requoted" boolean DEFAULT false NOT NULL,
	"over_cap" boolean DEFAULT false NOT NULL,
	"provider_status" text,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"booked_by" text,
	"booked_at" timestamp with time zone,
	"last_event_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "courier_shipments_provider_ck" CHECK (provider in ('shipbubble', 'topship', 'mock')),
	CONSTRAINT "courier_shipments_status_ck" CHECK (status in ('booking', 'booked', 'in_transit', 'delivered', 'cancelled', 'failed', 'needs_review')),
	CONSTRAINT "courier_shipments_amounts_ck" CHECK (collected_minor >= 0 and (cost_minor is null or cost_minor >= 0)),
	CONSTRAINT "courier_shipments_error_len_ck" CHECK (error is null or length(error) <= 300)
);
--> statement-breakpoint
ALTER TABLE "ledger_accounts" DROP CONSTRAINT "ledger_accounts_kind_ck";--> statement-breakpoint
ALTER TABLE "ledger_transactions" DROP CONSTRAINT "ledger_transactions_kind_ck";--> statement-breakpoint
ALTER TABLE "catalog_products" ADD COLUMN "weight_grams" integer;--> statement-breakpoint
ALTER TABLE "ledger_order_money" ADD COLUMN "courier_shipping_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_order_money" ADD COLUMN "courier_shipping_refunded_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "courier_quotes" ADD CONSTRAINT "courier_quotes_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courier_settings" ADD CONSTRAINT "courier_settings_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courier_shipments" ADD CONSTRAINT "courier_shipments_order_ref_id_order_refs_id_fk" FOREIGN KEY ("order_ref_id") REFERENCES "public"."order_refs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courier_shipments" ADD CONSTRAINT "courier_shipments_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "courier_events_key_ux" ON "courier_events" USING btree ("event_key") WHERE event_key is not null;--> statement-breakpoint
CREATE INDEX "courier_events_kind_ix" ON "courier_events" USING btree ("kind","created_at");--> statement-breakpoint
CREATE INDEX "courier_events_created_ix" ON "courier_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "courier_quotes_key_ix" ON "courier_quotes" USING btree ("cache_key","expires_at");--> statement-breakpoint
CREATE INDEX "courier_quotes_created_ix" ON "courier_quotes" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "courier_shipments_order_ux" ON "courier_shipments" USING btree ("order_ref_id");--> statement-breakpoint
CREATE UNIQUE INDEX "courier_shipments_provider_order_ux" ON "courier_shipments" USING btree ("provider","provider_order_id") WHERE provider_order_id is not null;--> statement-breakpoint
CREATE INDEX "courier_shipments_status_ix" ON "courier_shipments" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "courier_shipments_brand_ix" ON "courier_shipments" USING btree ("brand_id","created_at");--> statement-breakpoint
ALTER TABLE "catalog_products" ADD CONSTRAINT "catalog_products_weight_ck" CHECK (weight_grams is null or weight_grams between 1 and 70000);--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_kind_ck" CHECK (kind in ('brand_pending', 'brand_available', 'brand_reserve', 'brand_payout_hold', 'platform_commission', 'platform_adjustments', 'provider_clearing', 'shipping_collected', 'shipping_spent', 'courier_wallet'));--> statement-breakpoint
ALTER TABLE "ledger_order_money" ADD CONSTRAINT "ledger_order_money_courier_ck" CHECK (courier_shipping_minor >= 0 and courier_shipping_minor <= gross_minor and courier_shipping_refunded_minor between 0 and courier_shipping_minor);--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_kind_ck" CHECK (kind in ('payment_captured', 'refund', 'order_completed', 'reserve_released', 'payout_requested', 'payout_cancelled', 'payout_rejected', 'payout_paid', 'payout_failed', 'payout_reversed', 'adjustment', 'courier_booked'));