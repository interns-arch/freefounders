-- Razorpay ready (PLAN.md §21.4): gateway plans cache, the gateway's id on checkouts and subscriptions.
CREATE TABLE "platform"."gateway_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gateway" text NOT NULL,
	"plan" text NOT NULL,
	"interval" text NOT NULL,
	"unit_price" integer NOT NULL,
	"amount" integer NOT NULL,
	"gateway_plan_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform"."checkout_sessions" ADD COLUMN "gateway_ref" text;--> statement-breakpoint
ALTER TABLE "platform"."checkout_sessions" ADD COLUMN "gateway_data" jsonb;--> statement-breakpoint
ALTER TABLE "platform"."subscriptions" ADD COLUMN "gateway" text;--> statement-breakpoint
ALTER TABLE "platform"."subscriptions" ADD COLUMN "gateway_subscription_id" text;--> statement-breakpoint
ALTER TABLE "platform"."gateway_plans" ADD CONSTRAINT "gateway_plans_plan_plans_code_fk" FOREIGN KEY ("plan") REFERENCES "platform"."plans"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gateway_plans_key_uq" ON "platform"."gateway_plans" USING btree ("gateway","plan","interval","unit_price","amount");--> statement-breakpoint
CREATE INDEX "checkout_sessions_gateway_ref_idx" ON "platform"."checkout_sessions" USING btree ("gateway_ref");--> statement-breakpoint
CREATE INDEX "subscriptions_gateway_subscription_idx" ON "platform"."subscriptions" USING btree ("gateway_subscription_id");