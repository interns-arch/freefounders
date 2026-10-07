ALTER TABLE "asset_types" ADD COLUMN "consumable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "asset_types" SET "consumable" = true WHERE "code" = 'STN' AND "tracking_mode" = 'QUANTITY';
--> statement-breakpoint
INSERT INTO "asset_types" ("category_id", "name", "code", "icon", "description", "tracking_mode", "consumable")
SELECT c."id", 'Joining Kit', 'JKT', 'gift', 'Welcome kit for new joiners — given once, no return', 'QUANTITY', true
FROM "asset_categories" c
WHERE c."code" = 'OFF' AND NOT EXISTS (SELECT 1 FROM "asset_types" WHERE "code" = 'JKT');
--> statement-breakpoint
INSERT INTO "field_definitions" ("asset_type_id", "key", "label", "type", "placeholder", "sort_order")
SELECT t."id", 'contents', 'Contents', 'text', 'Bag, T-shirt, diary, pen, lanyard', 0
FROM "asset_types" t
WHERE t."code" = 'JKT' AND NOT EXISTS (SELECT 1 FROM "field_definitions" f WHERE f."asset_type_id" = t."id" AND f."key" = 'contents');
