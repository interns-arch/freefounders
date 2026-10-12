ALTER TABLE "platform"."companies" ADD COLUMN "access_upgrades" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
-- PLAN.md §19.19: only the Owner role (Super Admin) stays locked; Admin becomes an ordinary, editable role.
UPDATE "platform"."roles" SET "system" = false, "description" = 'Starts with everything except the Owner-only powers. Edit it like any role.', "updated_at" = now() WHERE "code" = 'ff_admin' AND "system" = true;--> statement-breakpoint
UPDATE "platform"."roles" SET "description" = 'Everything in every app, always (new permissions included). Cannot be edited, so the company can never lock itself out.', "updated_at" = now() WHERE "code" = 'ff_super_admin';
