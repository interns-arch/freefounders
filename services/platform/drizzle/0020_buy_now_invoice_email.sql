ALTER TABLE "platform"."invoices" ADD COLUMN "emailed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "platform"."invoices" ADD COLUMN "emailed_to" text[];--> statement-breakpoint
ALTER TABLE "platform"."invoices" ADD COLUMN "email_error" text;--> statement-breakpoint
ALTER TABLE "platform"."subscriptions" ADD COLUMN "setup_pending" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "platform"."subscriptions" ADD COLUMN "pay_by" timestamp with time zone;