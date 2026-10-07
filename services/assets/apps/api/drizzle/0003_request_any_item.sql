ALTER TABLE "asset_requests" ALTER COLUMN "asset_type_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "asset_requests" ADD COLUMN "item_name" text;