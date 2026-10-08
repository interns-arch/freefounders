DROP TABLE "app_settings" CASCADE;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "password_saved";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "password_saved_at";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "password_saved_by_name";