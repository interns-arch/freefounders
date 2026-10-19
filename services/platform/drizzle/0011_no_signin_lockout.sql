-- Founder decision (2026-10-19): no sign-in lockout (LOGIN_MAX_FAILED defaults to 0). Existing locks and counters are cleared.
UPDATE "platform"."logins" SET "locked_until" = NULL, "failed_logins" = 0;--> statement-breakpoint
UPDATE "platform"."accounts" SET "locked_until" = NULL, "failed_logins" = 0;
