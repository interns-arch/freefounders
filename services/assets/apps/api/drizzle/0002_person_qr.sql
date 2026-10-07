-- Employees without an email sign in with their employee code.
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "personal_email" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "personal_phone" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "assets_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "assets_verified_by_name" text;--> statement-breakpoint
-- One QR per person: the QR holds the employee ID, so IDs must be unique regardless of case.
CREATE UNIQUE INDEX "employees_code_lower_idx" ON "employees" (lower("employee_code"));--> statement-breakpoint
-- Full access is for the IT team.
UPDATE "roles" SET "permissions" = ARRAY['dashboard:view','asset:view','asset:create','asset:edit','asset:assign','asset:lifecycle','catalog:manage','org:manage','employee:view','employee:manage','employee:status','exit:view','exit:manage','exit:override','request:create','request:approve','request:fulfil','ticket:create','ticket:manage','maintenance:manage','history:view','user:manage'], "description" = 'Full access: assets, people, logins and settings'
WHERE "name" = 'IT / Asset Manager' AND "is_system";
