CREATE TABLE "platform"."service_heartbeats" (
	"service" text PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."service_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"service" text NOT NULL,
	"level" text NOT NULL,
	"kind" text DEFAULT 'event' NOT NULL,
	"event" text,
	"message" text NOT NULL,
	"stack" text,
	"method" text,
	"path" text,
	"status" integer,
	"company_id" uuid,
	"company_code" text,
	"user_id" text,
	"count" integer DEFAULT 1 NOT NULL,
	"version" text
);
--> statement-breakpoint
CREATE INDEX "service_logs_at_idx" ON "platform"."service_logs" USING btree ("at");--> statement-breakpoint
CREATE INDEX "service_logs_service_idx" ON "platform"."service_logs" USING btree ("service","at");--> statement-breakpoint
CREATE INDEX "service_logs_company_idx" ON "platform"."service_logs" USING btree ("company_id","at");