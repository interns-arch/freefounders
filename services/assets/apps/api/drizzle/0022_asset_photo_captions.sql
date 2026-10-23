ALTER TABLE "allocation_photos" ADD COLUMN "caption" text;--> statement-breakpoint
ALTER TABLE "allocation_photos" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;
