CREATE TABLE "studio_push_preferences" (
	"user_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"orders" boolean DEFAULT true NOT NULL,
	"messages" boolean DEFAULT true NOT NULL,
	"low_stock" boolean DEFAULT true NOT NULL,
	"payouts" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "studio_push_preferences_user_id_brand_id_pk" PRIMARY KEY("user_id","brand_id")
);
--> statement-breakpoint
ALTER TABLE "push_devices" ADD COLUMN "studio" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "studio_push_preferences" ADD CONSTRAINT "studio_push_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_push_preferences" ADD CONSTRAINT "studio_push_preferences_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "studio_push_preferences_brand_ix" ON "studio_push_preferences" USING btree ("brand_id");