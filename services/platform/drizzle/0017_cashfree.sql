-- Razorpay removed, Cashfree in its place (PLAN.md §21.10): the Razorpay plan cache and subscription id go.
DROP TABLE IF EXISTS "platform"."gateway_plans" CASCADE;--> statement-breakpoint
DROP INDEX IF EXISTS "platform"."subscriptions_gateway_subscription_idx";--> statement-breakpoint
ALTER TABLE "platform"."subscriptions" DROP COLUMN IF EXISTS "gateway_subscription_id";
