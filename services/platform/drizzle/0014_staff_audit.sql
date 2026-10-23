-- Owner console audit log (PLAN.md §21.7): one row per staff action (extend trial, set plan / seats, suspend, reactivate).
CREATE TABLE "platform"."staff_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"staff_account_id" uuid,
	"staff_email" text,
	"action" text NOT NULL,
	"company_id" uuid,
	"company_code" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text
);
--> statement-breakpoint
ALTER TABLE "platform"."staff_audit" ADD CONSTRAINT "staff_audit_staff_account_id_accounts_id_fk" FOREIGN KEY ("staff_account_id") REFERENCES "platform"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_audit_at_idx" ON "platform"."staff_audit" USING btree ("at");--> statement-breakpoint
CREATE INDEX "staff_audit_company_idx" ON "platform"."staff_audit" USING btree ("company_id","at");