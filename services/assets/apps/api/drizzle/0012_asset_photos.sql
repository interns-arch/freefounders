ALTER TABLE "allocation_photos" ALTER COLUMN "allocation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "allocation_photos" ADD COLUMN "data" "bytea";