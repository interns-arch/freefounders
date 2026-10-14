CREATE TABLE "platform"."accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text,
	"mobile" text,
	"full_name" text NOT NULL,
	"password_hash" text NOT NULL,
	"failed_logins" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"password_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_staff" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."auth_tickets" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"target" text,
	"channel" text,
	"account_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."billing_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gateway" text NOT NULL,
	"event_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."billing_profiles" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"legal_name" text NOT NULL,
	"gstin" text,
	"state" text NOT NULL,
	"address" text,
	"email" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."checkout_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"gateway" text NOT NULL,
	"plan" text NOT NULL,
	"interval" text NOT NULL,
	"seats" integer NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subtotal" integer NOT NULL,
	"cgst" integer DEFAULT 0 NOT NULL,
	"sgst" integer DEFAULT 0 NOT NULL,
	"igst" integer DEFAULT 0 NOT NULL,
	"total" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"role_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"apps" text[] DEFAULT '{}'::text[] NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"max_uses" integer,
	"uses" integer DEFAULT 0 NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "platform"."invoice_counters" (
	"financial_year" text PRIMARY KEY NOT NULL,
	"last" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"description" text NOT NULL,
	"sac" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" integer NOT NULL,
	"amount" integer NOT NULL,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "platform"."invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"number" text NOT NULL,
	"financial_year" text NOT NULL,
	"seq" integer NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"seller" jsonb NOT NULL,
	"buyer" jsonb NOT NULL,
	"place_of_supply" text NOT NULL,
	"subtotal" integer NOT NULL,
	"cgst" integer DEFAULT 0 NOT NULL,
	"sgst" integer DEFAULT 0 NOT NULL,
	"igst" integer DEFAULT 0 NOT NULL,
	"total" integer NOT NULL,
	"status" text DEFAULT 'paid' NOT NULL,
	"checkout_session_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "platform"."otp_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target" text NOT NULL,
	"channel" text NOT NULL,
	"purpose" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"invoice_id" uuid,
	"checkout_session_id" uuid,
	"gateway" text NOT NULL,
	"gateway_payment_id" text,
	"amount" integer NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."plans" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"apps" text[] DEFAULT '{}'::text[] NOT NULL,
	"price_monthly" integer DEFAULT 0 NOT NULL,
	"price_yearly" integer DEFAULT 0 NOT NULL,
	"min_seats" integer DEFAULT 1 NOT NULL,
	"max_seats" integer,
	"offered" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."seat_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"seats_from" integer NOT NULL,
	"seats_to" integer NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"amount" integer NOT NULL,
	"invoice_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."subscriptions" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"plan" text NOT NULL,
	"interval" text DEFAULT 'month' NOT NULL,
	"state" text NOT NULL,
	"state_since" timestamp with time zone DEFAULT now() NOT NULL,
	"seats" integer DEFAULT 0 NOT NULL,
	"next_period_seats" integer,
	"trial_ends_at" timestamp with time zone,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"clock_offset_days" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "platform"."people_email_uq";--> statement-breakpoint
ALTER TABLE "platform"."people" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "platform"."auth_tickets" ADD CONSTRAINT "auth_tickets_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "platform"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."billing_profiles" ADD CONSTRAINT "billing_profiles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "platform"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."checkout_sessions" ADD CONSTRAINT "checkout_sessions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "platform"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."checkout_sessions" ADD CONSTRAINT "checkout_sessions_plan_plans_code_fk" FOREIGN KEY ("plan") REFERENCES "platform"."plans"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."checkout_sessions" ADD CONSTRAINT "checkout_sessions_created_by_people_id_fk" FOREIGN KEY ("created_by") REFERENCES "platform"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."invites" ADD CONSTRAINT "invites_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "platform"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."invites" ADD CONSTRAINT "invites_created_by_people_id_fk" FOREIGN KEY ("created_by") REFERENCES "platform"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "platform"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."invoices" ADD CONSTRAINT "invoices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "platform"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."invoices" ADD CONSTRAINT "invoices_checkout_session_id_checkout_sessions_id_fk" FOREIGN KEY ("checkout_session_id") REFERENCES "platform"."checkout_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."payments" ADD CONSTRAINT "payments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "platform"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "platform"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."payments" ADD CONSTRAINT "payments_checkout_session_id_checkout_sessions_id_fk" FOREIGN KEY ("checkout_session_id") REFERENCES "platform"."checkout_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."seat_changes" ADD CONSTRAINT "seat_changes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "platform"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."seat_changes" ADD CONSTRAINT "seat_changes_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "platform"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."subscriptions" ADD CONSTRAINT "subscriptions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "platform"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."subscriptions" ADD CONSTRAINT "subscriptions_plan_plans_code_fk" FOREIGN KEY ("plan") REFERENCES "platform"."plans"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_email_uq" ON "platform"."accounts" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_mobile_uq" ON "platform"."accounts" USING btree ("mobile");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_events_gateway_event_uq" ON "platform"."billing_events" USING btree ("gateway","event_id");--> statement-breakpoint
CREATE INDEX "checkout_sessions_company_idx" ON "platform"."checkout_sessions" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "invites_company_idx" ON "platform"."invites" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_fy_seq_uq" ON "platform"."invoices" USING btree ("financial_year","seq");--> statement-breakpoint
CREATE INDEX "invoices_company_idx" ON "platform"."invoices" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "otp_codes_target_idx" ON "platform"."otp_codes" USING btree ("target","created_at");--> statement-breakpoint
CREATE INDEX "otp_codes_ip_idx" ON "platform"."otp_codes" USING btree ("ip","created_at");--> statement-breakpoint
CREATE INDEX "payments_company_idx" ON "platform"."payments" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "seat_changes_company_idx" ON "platform"."seat_changes" USING btree ("company_id");--> statement-breakpoint
ALTER TABLE "platform"."people" ADD CONSTRAINT "people_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "platform"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "people_company_email_uq" ON "platform"."people" USING btree ("company_id",lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "people_company_account_uq" ON "platform"."people" USING btree ("company_id","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "people_email_uq" ON "platform"."people" USING btree (lower("email")) WHERE account_id is null;--> statement-breakpoint
-- PLAN.md §21: plans used for testing (prices in paise per seat; yearly = 10 x monthly). A business choice: change the rows.
INSERT INTO "platform"."plans" ("code", "name", "description", "apps", "price_monthly", "price_yearly", "min_seats", "max_seats", "offered", "sort") VALUES
  ('free', 'Free', 'Tasks and Attendance for up to 3 people', '{tasks}', 0, 0, 1, 3, true, 0),
  ('tasks', 'Tasks', 'Tasks and Attendance', '{tasks}', 9900, 99000, 5, NULL, true, 1),
  ('assets', 'Assets', 'Asset management', '{assets}', 7900, 79000, 5, NULL, true, 2),
  ('suite', 'Suite', 'Tasks, Attendance and Assets', '{tasks,assets}', 14900, 149000, 5, NULL, true, 3),
  ('complimentary', 'Complimentary', 'Internal: no billing', '{tasks,assets}', 0, 0, 1, NULL, false, 9)
ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint
-- Existing companies (demo, CarTrends, test companies): Complimentary, active, nothing changes for them.
INSERT INTO "platform"."subscriptions" ("company_id", "plan", "interval", "state")
SELECT "id", 'complimentary', 'month', 'active' FROM "platform"."companies"
ON CONFLICT ("company_id") DO NOTHING;
