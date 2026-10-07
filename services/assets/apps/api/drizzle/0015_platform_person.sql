ALTER TABLE "users" ADD COLUMN "platform_person_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_platform_person_id_unique" UNIQUE("platform_person_id");