ALTER TABLE "catalog_imports" DROP CONSTRAINT "catalog_imports_platform_ck";--> statement-breakpoint
ALTER TABLE "catalog_watches" DROP CONSTRAINT "catalog_watches_platform_ck";--> statement-breakpoint
ALTER TABLE "catalog_imports" ADD CONSTRAINT "catalog_imports_platform_ck" CHECK (platform in ('shopify', 'woocommerce', 'labeld', 'bumpa', 'generic'));--> statement-breakpoint
ALTER TABLE "catalog_watches" ADD CONSTRAINT "catalog_watches_platform_ck" CHECK (platform in ('shopify', 'woocommerce', 'labeld', 'bumpa', 'generic'));