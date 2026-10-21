-- Usernames for self-signed-up accounts (PLAN.md §21.5): optional, stored lower-case, unique (also checked in code against logins.username).
ALTER TABLE "platform"."accounts" ADD COLUMN "username" text;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_username_uq" ON "platform"."accounts" USING btree (lower("username"));