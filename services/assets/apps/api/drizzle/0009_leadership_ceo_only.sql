-- The leadership overview is for the CEO (Leadership role) only, not for Admin / IT.
UPDATE "roles" SET "permissions" = array_remove("permissions", 'insights:leadership'), "updated_at" = now() WHERE "name" IN ('Admin', 'IT / Asset Manager') AND "is_system";
