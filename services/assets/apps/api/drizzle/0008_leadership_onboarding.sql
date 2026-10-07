CREATE TABLE "onboarding_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_number" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"join_date" date NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_by_name" text,
	"submitted_at" timestamp with time zone,
	"submitted_by_name" text,
	"completed_at" timestamp with time zone,
	"completed_by_name" text,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_cases_case_number_unique" UNIQUE("case_number")
);
--> statement-breakpoint
CREATE TABLE "onboarding_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"asset_type_id" uuid,
	"item_name" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"notes" text,
	"status" text DEFAULT 'PLANNED' NOT NULL,
	"prepared_asset_id" uuid,
	"prepared_by_name" text,
	"allocation_id" uuid,
	"issued_at" timestamp with time zone,
	"issued_by_name" text,
	"skip_reason" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onboarding_kits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"items" jsonb NOT NULL,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_kits_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "onboarding_cases" ADD CONSTRAINT "onboarding_cases_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_items" ADD CONSTRAINT "onboarding_items_case_id_onboarding_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."onboarding_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_items" ADD CONSTRAINT "onboarding_items_asset_type_id_asset_types_id_fk" FOREIGN KEY ("asset_type_id") REFERENCES "public"."asset_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_items" ADD CONSTRAINT "onboarding_items_prepared_asset_id_assets_id_fk" FOREIGN KEY ("prepared_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_items" ADD CONSTRAINT "onboarding_items_allocation_id_allocations_id_fk" FOREIGN KEY ("allocation_id") REFERENCES "public"."allocations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "onboarding_one_open_uq" ON "onboarding_cases" USING btree ("employee_id") WHERE status in ('DRAFT', 'SUBMITTED');--> statement-breakpoint
CREATE INDEX "onboarding_status_idx" ON "onboarding_cases" USING btree ("status","join_date");--> statement-breakpoint
CREATE INDEX "onboarding_items_case_idx" ON "onboarding_items" USING btree ("case_id","sort_order");--> statement-breakpoint
UPDATE "roles" SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['onboarding:manage', 'insights:leadership']::text[])), "updated_at" = now() WHERE "name" IN ('Admin', 'IT / Asset Manager') AND "is_system";
--> statement-breakpoint
UPDATE "roles" SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['onboarding:manage']::text[])), "updated_at" = now() WHERE "name" = 'HR' AND "is_system";
--> statement-breakpoint
INSERT INTO "roles" ("name", "description", "permissions", "is_system")
SELECT 'Leadership', 'CEO / directors: leadership overview and a read-only view of everything',
  ARRAY['insights:leadership', 'dashboard:view', 'asset:view', 'employee:view', 'exit:view', 'history:view', 'request:create', 'ticket:create']::text[], true
WHERE EXISTS (SELECT 1 FROM "roles") AND NOT EXISTS (SELECT 1 FROM "roles" WHERE lower("name") = 'leadership');
