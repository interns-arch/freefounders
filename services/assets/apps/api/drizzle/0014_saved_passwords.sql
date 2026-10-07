CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_saved" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_saved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_saved_by_name" text;