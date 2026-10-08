ALTER TABLE "platform"."companies" ADD COLUMN "short_name" text;--> statement-breakpoint
ALTER TABLE "platform"."companies" ADD COLUMN "brand_colour" text;--> statement-breakpoint
ALTER TABLE "platform"."companies" ADD COLUMN "logo" "bytea";--> statement-breakpoint
ALTER TABLE "platform"."companies" ADD COLUMN "logo_type" text;--> statement-breakpoint
ALTER TABLE "platform"."companies" ADD COLUMN "modules" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "platform"."companies" ADD COLUMN "profile_version" integer DEFAULT 0 NOT NULL;