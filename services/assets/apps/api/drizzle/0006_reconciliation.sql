CREATE TABLE "reconciliation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"file_name" text NOT NULL,
	"row_count" integer NOT NULL,
	"repaired_rows" integer DEFAULT 0 NOT NULL,
	"summary" jsonb NOT NULL,
	"items" jsonb NOT NULL,
	"created_by" uuid,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "reconciliation_runs_created_idx" ON "reconciliation_runs" USING btree ("source","created_at");