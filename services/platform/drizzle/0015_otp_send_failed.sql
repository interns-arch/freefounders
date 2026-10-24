-- MSG91 codes (PLAN.md §21.8): a code the sender could not deliver is marked failed (never usable, not counted against
-- the person's resend limits; still counted per IP address).
ALTER TABLE "platform"."otp_codes" ADD COLUMN "failed_at" timestamp with time zone;
