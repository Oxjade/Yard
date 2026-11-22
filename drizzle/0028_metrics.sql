CREATE TABLE "deploys" (
	"id" text PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"git_sha" text,
	"build_id" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_boot_at" timestamp with time zone DEFAULT now() NOT NULL,
	"boots" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metrics_minutes" (
	"grain" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"area" text NOT NULL,
	"source" text NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"c4xx" integer DEFAULT 0 NOT NULL,
	"c5xx" integer DEFAULT 0 NOT NULL,
	"total_ms" bigint DEFAULT 0 NOT NULL,
	"max_ms" integer DEFAULT 0 NOT NULL,
	"hist" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"events" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "metrics_minutes_pk" PRIMARY KEY("grain","at","area","source"),
	CONSTRAINT "metrics_minutes_grain_ck" CHECK (grain in ('m', 'h', 'd')),
	CONSTRAINT "metrics_minutes_area_ck" CHECK (area in ('public', 'studio', 'admin', 'api', 'events'))
);
--> statement-breakpoint
CREATE INDEX "deploys_first_seen_ix" ON "deploys" USING btree ("first_seen_at" DESC NULLS LAST);