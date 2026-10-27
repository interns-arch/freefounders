CREATE TABLE "platform"."billing_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."module_prices" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price_monthly" integer NOT NULL,
	"ai_price_monthly" integer NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform"."checkout_sessions" ADD COLUMN "modules" text[];--> statement-breakpoint
ALTER TABLE "platform"."checkout_sessions" ADD COLUMN "ai" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "platform"."plans" ADD COLUMN "ai_price_monthly" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "platform"."plans" ADD COLUMN "kind" text DEFAULT 'plan' NOT NULL;--> statement-breakpoint
ALTER TABLE "platform"."subscriptions" ADD COLUMN "modules" text[];--> statement-breakpoint
ALTER TABLE "platform"."subscriptions" ADD COLUMN "ai" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "platform"."subscriptions" ADD COLUMN "trial_max_users" integer;--> statement-breakpoint
ALTER TABLE "platform"."subscriptions" ADD COLUMN "free_fallback" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- PLAN.md §24.1: module-wise prices (paise per user per month; with AI). A business choice: change the rows.
INSERT INTO "platform"."module_prices" ("key", "name", "description", "price_monthly", "ai_price_monthly", "sort") VALUES
  ('tasks', 'Tasks', 'Tasks, groups, notices, leads, mistakes and links', 9900, 12900, 1),
  ('attendance', 'Attendance', 'Punch in and out, leave, holidays and HR reports', 9900, 12900, 2),
  ('assets', 'Assets', 'Assets, stock, SIMs and tickets', 9900, 12900, 3)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
INSERT INTO "platform"."plans" ("code", "name", "description", "apps", "price_monthly", "price_yearly", "ai_price_monthly", "kind", "min_seats", "max_seats", "offered", "sort") VALUES
  ('modules', 'Modules', 'Tasks, Attendance and Assets: pick the ones you need', '{tasks,assets}', 9900, 99000, 12900, 'pick', 1, NULL, true, 1),
  ('complete', 'Complete', 'Every module: Tasks, Attendance, Assets, Visitors, Payroll and everything else', '{tasks,assets}', 34900, 349000, 44900, 'bundle', 1, NULL, true, 2)
ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint
-- The older plans stay for the companies that have them (read and renewed at their price) but are no longer sold.
UPDATE "platform"."plans" SET "offered" = false WHERE "code" IN ('free', 'tasks', 'assets', 'suite');--> statement-breakpoint
-- The trial for new companies: 3 users for 10 days (staff change it in the console).
INSERT INTO "platform"."billing_settings" ("key", "value") VALUES ('trial', '{"days": 10, "maxUsers": 3}')
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
-- Grandfathering: every company that exists now keeps its old rules (a trial or a cancelled plan may still end on Free;
-- running trials keep their end date and 50 users). Complimentary (demo, CarTrends) is never touched by the clock.
UPDATE "platform"."subscriptions" SET "free_fallback" = true WHERE "plan" <> 'complimentary';
