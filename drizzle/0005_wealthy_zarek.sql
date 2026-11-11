ALTER TABLE "search_products" ADD COLUMN "brand_handle" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "search_products" ADD COLUMN "country" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "search_products" ADD COLUMN "sizes" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
UPDATE "search_products" AS search_row
SET "brand_handle" = brand.handle,
		"country" = brand.country,
		"sizes" = COALESCE((
			SELECT array_agg(DISTINCT variant.options ->> 'Size')
			FROM catalog_variants AS variant
			WHERE variant.product_id = search_row.product_id
				AND variant.status = 'active'
				AND variant.on_hand > variant.held
				AND NULLIF(variant.options ->> 'Size', '') IS NOT NULL
				AND variant.options ->> 'Size' <> 'One size'
		), '{}'::text[])
FROM brands AS brand
WHERE brand.id = search_row.brand_id;--> statement-breakpoint
CREATE INDEX "search_products_country_ix" ON "search_products" USING btree ("country");--> statement-breakpoint
CREATE INDEX "search_products_sizes_ix" ON "search_products" USING gin ("sizes");