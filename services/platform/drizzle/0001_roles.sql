CREATE TABLE "platform"."person_roles" (
	"person_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	CONSTRAINT "person_roles_person_id_role_id_pk" PRIMARY KEY("person_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "platform"."role_grants" (
	"role_id" uuid NOT NULL,
	"app" text NOT NULL,
	"permission" text NOT NULL,
	"scope" text DEFAULT '' NOT NULL,
	CONSTRAINT "role_grants_role_id_app_permission_pk" PRIMARY KEY("role_id","app","permission")
);
--> statement-breakpoint
CREATE TABLE "platform"."roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"colour" text,
	"level" integer DEFAULT 1 NOT NULL,
	"system" boolean DEFAULT false NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform"."companies" ADD COLUMN "access_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "platform"."person_roles" ADD CONSTRAINT "person_roles_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "platform"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."person_roles" ADD CONSTRAINT "person_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "platform"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."role_grants" ADD CONSTRAINT "role_grants_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "platform"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."roles" ADD CONSTRAINT "roles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "platform"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "roles_company_code_uq" ON "platform"."roles" USING btree ("company_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_company_name_uq" ON "platform"."roles" USING btree ("company_id",lower("name"));