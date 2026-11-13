CREATE TABLE "traffic_daily" (
	"day" text NOT NULL,
	"country" text NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"visitors" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "traffic_daily_day_country_ux" ON "traffic_daily" USING btree ("day","country");--> statement-breakpoint
CREATE INDEX "traffic_daily_day_ix" ON "traffic_daily" USING btree ("day");