CREATE TABLE "platform"."departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform"."companies" ADD COLUMN "people_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "platform"."people" ADD COLUMN "department_id" uuid;--> statement-breakpoint
ALTER TABLE "platform"."people" ADD COLUMN "designation" text;--> statement-breakpoint
ALTER TABLE "platform"."people" ADD COLUMN "reports_to" uuid;--> statement-breakpoint
ALTER TABLE "platform"."people" ADD COLUMN "join_date" date;--> statement-breakpoint
ALTER TABLE "platform"."departments" ADD CONSTRAINT "departments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "platform"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "departments_company_code_uq" ON "platform"."departments" USING btree ("company_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "departments_company_name_uq" ON "platform"."departments" USING btree ("company_id",lower("name"));--> statement-breakpoint
ALTER TABLE "platform"."people" ADD CONSTRAINT "people_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "platform"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."people" ADD CONSTRAINT "people_reports_to_people_id_fk" FOREIGN KEY ("reports_to") REFERENCES "platform"."people"("id") ON DELETE no action ON UPDATE no action;