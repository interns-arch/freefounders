ALTER TABLE "platform"."companies" ADD COLUMN "roles_model" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "platform"."roles" ADD COLUMN "kind" text DEFAULT 'role' NOT NULL;--> statement-breakpoint
ALTER TABLE "platform"."roles" ADD COLUMN "person_id" uuid;--> statement-breakpoint
ALTER TABLE "platform"."roles" ADD CONSTRAINT "roles_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "platform"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "roles_person_uq" ON "platform"."roles" USING btree ("person_id") WHERE person_id is not null;--> statement-breakpoint
-- PLAN.md §19.28: companies that already have roles are converted once by RolesService (template roles archived, people
-- moved to Admin or Member); it needs the apps' catalogues, so it runs there, not here. New companies start converted.
UPDATE "platform"."companies" c SET "roles_model" = 1 WHERE EXISTS (SELECT 1 FROM "platform"."roles" r WHERE r."company_id" = c."id");--> statement-breakpoint
-- The old locked "Super Admin" (Owner) role becomes the hidden Owner role: held by the owners only, never listed.
UPDATE "platform"."roles" SET "kind" = 'owner', "code" = 'ff_owner', "name" = 'Owner (all access)', "system" = true, "level" = 3,
  "description" = 'Hidden: every permission in every app, always. Held by the company owner(s) only.', "updated_at" = now()
  WHERE "code" = 'ff_super_admin';
