-- docs/security/platform.md R7 (founder, 2026-10-13): nobody is forced to change their password at sign-in any more.
UPDATE "platform"."logins" SET "must_change_password" = false WHERE "must_change_password" = true;
