-- SIM register columns as used on the telecom billing portal:
-- Connection Number · Billable Account · Circle · Plan · SIM Number.
-- Mobile Number becomes Connection Number (values are kept); SIM Number is filled from the serial number.
UPDATE "field_definitions" SET "key" = 'connection_number', "label" = 'Connection Number', "show_in_table" = true, "sort_order" = 0, "updated_at" = now()
WHERE "asset_type_id" IN (SELECT "id" FROM "asset_types" WHERE "code" = 'SIM') AND "key" = 'mobile_number';
--> statement-breakpoint
UPDATE "assets" SET "attributes" = ("attributes" - 'mobile_number') || jsonb_build_object('connection_number', "attributes"->'mobile_number')
WHERE "asset_type_id" IN (SELECT "id" FROM "asset_types" WHERE "code" = 'SIM') AND "attributes" ? 'mobile_number';
--> statement-breakpoint
INSERT INTO "field_definitions" ("asset_type_id", "key", "label", "type", "is_unique", "show_in_table", "sort_order", "placeholder")
SELECT t."id", f."key", f."label", 'text', f."uq", true, f."ord", f."ph"
FROM "asset_types" t
CROSS JOIN (VALUES
  ('billable_account', 'Billable Account', false, 1, '1-0000000000000'),
  ('circle', 'Circle', false, 2, 'DL'),
  ('sim_number', 'SIM Number', true, 4, '89910000000000000000U')
) AS f("key", "label", "uq", "ord", "ph")
WHERE t."code" = 'SIM'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "field_definitions" SET "show_in_table" = true, "sort_order" = 3 WHERE "asset_type_id" IN (SELECT "id" FROM "asset_types" WHERE "code" = 'SIM') AND "key" = 'plan';
--> statement-breakpoint
UPDATE "field_definitions" SET "show_in_table" = false, "sort_order" = 5 WHERE "asset_type_id" IN (SELECT "id" FROM "asset_types" WHERE "code" = 'SIM') AND "key" = 'carrier';
--> statement-breakpoint
UPDATE "field_definitions" SET "sort_order" = 6 WHERE "asset_type_id" IN (SELECT "id" FROM "asset_types" WHERE "code" = 'SIM') AND "key" = 'monthly_data_gb';
--> statement-breakpoint
UPDATE "assets" SET "attributes" = "attributes" || jsonb_build_object('sim_number', "serial_number")
WHERE "asset_type_id" IN (SELECT "id" FROM "asset_types" WHERE "code" = 'SIM') AND "serial_number" IS NOT NULL AND NOT ("attributes" ? 'sim_number');
