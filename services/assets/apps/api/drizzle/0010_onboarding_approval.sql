DROP INDEX "onboarding_one_open_uq";--> statement-breakpoint
ALTER TABLE "onboarding_cases" ADD COLUMN "return_note" text;--> statement-breakpoint
ALTER TABLE "onboarding_cases" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "onboarding_cases" ADD COLUMN "approved_by_name" text;--> statement-breakpoint
CREATE UNIQUE INDEX "onboarding_one_open_uq" ON "onboarding_cases" USING btree ("employee_id") WHERE status in ('DRAFT', 'SUBMITTED', 'APPROVED');--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_remove("permissions", 'dashboard:view'), "updated_at" = now() WHERE "name" = 'HR' AND "is_system";
