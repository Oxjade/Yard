CREATE TABLE "indexnow_urls" (
	"url" text PRIMARY KEY NOT NULL,
	"live" boolean NOT NULL,
	"pending" boolean DEFAULT true NOT NULL,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
CREATE INDEX "indexnow_urls_due_ix" ON "indexnow_urls" USING btree ("next_attempt_at") WHERE pending;