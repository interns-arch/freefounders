-- An archived role keeps its name, and the name can be used again (e.g. Add Guard role after archiving Guard).
DROP INDEX "platform"."roles_company_name_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "roles_company_name_uq" ON "platform"."roles" USING btree ("company_id",lower("name")) WHERE not archived;