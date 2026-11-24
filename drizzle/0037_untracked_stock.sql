ALTER TABLE "catalog_variants" DROP CONSTRAINT "catalog_variants_stock_ck";--> statement-breakpoint
ALTER TABLE "catalog_variants" ADD COLUMN "track_stock" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "catalog_variants" ADD CONSTRAINT "catalog_variants_stock_ck" CHECK (on_hand >= 0 and held >= 0 and (held <= on_hand or not track_stock));