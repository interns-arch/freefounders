CREATE SCHEMA IF NOT EXISTS "platform";
--> statement-breakpoint
CREATE TABLE "platform"."companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"enabled_apps" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "platform"."logins" (
	"person_id" uuid PRIMARY KEY NOT NULL,
	"username" text,
	"password_hash" text NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"failed_logins" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"password_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"employee_code" text,
	"email" text,
	"mobile" text,
	"platform_role" text DEFAULT 'member' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."person_apps" (
	"person_id" uuid NOT NULL,
	"app" text NOT NULL,
	"local_user_id" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_apps_person_id_app_pk" PRIMARY KEY("person_id","app")
);
--> statement-breakpoint
CREATE TABLE "platform"."refresh_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"family_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"client" text DEFAULT 'web' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"rotated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."signing_keys" (
	"kid" text PRIMARY KEY NOT NULL,
	"public_jwk" jsonb NOT NULL,
	"private_enc" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform"."logins" ADD CONSTRAINT "logins_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "platform"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."people" ADD CONSTRAINT "people_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "platform"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."person_apps" ADD CONSTRAINT "person_apps_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "platform"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."refresh_sessions" ADD CONSTRAINT "refresh_sessions_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "platform"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "logins_username_uq" ON "platform"."logins" USING btree (lower("username"));--> statement-breakpoint
CREATE UNIQUE INDEX "people_email_uq" ON "platform"."people" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "people_company_code_uq" ON "platform"."people" USING btree ("company_id",lower("employee_code"));--> statement-breakpoint
CREATE INDEX "people_company_idx" ON "platform"."people" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "refresh_sessions_person_idx" ON "platform"."refresh_sessions" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "refresh_sessions_family_idx" ON "platform"."refresh_sessions" USING btree ("family_id");