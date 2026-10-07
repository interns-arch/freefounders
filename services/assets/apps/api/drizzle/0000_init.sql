CREATE TABLE "allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"holder_type" text NOT NULL,
	"employee_id" uuid,
	"department_id" uuid,
	"location_id" uuid,
	"company_id" uuid,
	"vendor_id" uuid,
	"holder_name" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"exclusive" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_by" uuid,
	"assigned_by_name" text,
	"expected_return_date" date,
	"notes" text,
	"ended_at" timestamp with time zone,
	"ended_by" uuid,
	"ended_by_name" text,
	"return_condition" text,
	"end_notes" text,
	CONSTRAINT "allocations_holder_ck" CHECK (num_nonnulls("allocations"."employee_id", "allocations"."department_id", "allocations"."location_id", "allocations"."company_id", "allocations"."vendor_id") = 1 and (
        ("allocations"."holder_type" = 'EMPLOYEE' and "allocations"."employee_id" is not null) or
        ("allocations"."holder_type" = 'DEPARTMENT' and "allocations"."department_id" is not null) or
        ("allocations"."holder_type" = 'LOCATION' and "allocations"."location_id" is not null) or
        ("allocations"."holder_type" = 'COMPANY' and "allocations"."company_id" is not null) or
        ("allocations"."holder_type" = 'VENDOR' and "allocations"."vendor_id" is not null) or
        ("allocations"."holder_type" = 'INVENTORY' and "allocations"."location_id" is not null)))
);
--> statement-breakpoint
CREATE TABLE "asset_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"icon" text,
	"color" text,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_categories_name_unique" UNIQUE("name"),
	CONSTRAINT "asset_categories_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "asset_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"requested_by" uuid,
	"requested_by_name" text,
	"asset_type_id" uuid NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"priority" text DEFAULT 'MEDIUM' NOT NULL,
	"needed_by" date,
	"reason" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"decided_by_name" text,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"fulfilled_asset_id" uuid,
	"fulfilled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_requests_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "asset_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"icon" text,
	"description" text,
	"tracking_mode" text DEFAULT 'INDIVIDUAL' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_types_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_tag" text NOT NULL,
	"qr_code" text NOT NULL,
	"name" text NOT NULL,
	"category_id" uuid NOT NULL,
	"asset_type_id" uuid NOT NULL,
	"tracking_mode" text DEFAULT 'INDIVIDUAL' NOT NULL,
	"status" text NOT NULL,
	"condition" text DEFAULT 'GOOD' NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"available_quantity" integer DEFAULT 1 NOT NULL,
	"serial_number" text,
	"manufacturer" text,
	"model" text,
	"description" text,
	"ownership" text DEFAULT 'OWNED' NOT NULL,
	"owner_company_id" uuid,
	"vendor_id" uuid,
	"purchase_date" date,
	"purchase_cost" numeric(14, 2),
	"currency" text DEFAULT 'INR' NOT NULL,
	"invoice_number" text,
	"warranty_expiry" date,
	"location_id" uuid,
	"holder_type" text,
	"holder_id" uuid,
	"holder_name" text,
	"assigned_at" timestamp with time zone,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple', coalesce(asset_tag, '') || ' ' || coalesce(name, '') || ' ' || coalesce(serial_number, '')), 'A') || setweight(to_tsvector('simple', coalesce(manufacturer, '') || ' ' || coalesce(model, '') || ' ' || coalesce(holder_name, '')), 'B') || setweight(jsonb_to_tsvector('simple', attributes, '["string", "numeric"]'), 'C')) STORED,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_asset_tag_unique" UNIQUE("asset_tag"),
	CONSTRAINT "assets_qr_code_unique" UNIQUE("qr_code"),
	CONSTRAINT "assets_quantity_ck" CHECK ("assets"."available_quantity" >= 0 and "assets"."available_quantity" <= "assets"."quantity")
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"legal_name" text,
	"address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"company_id" uuid,
	"parent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "departments_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_code" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text,
	"full_name" text GENERATED ALWAYS AS (trim(first_name || ' ' || coalesce(last_name, ''))) STORED NOT NULL,
	"email" text,
	"phone" text,
	"designation" text,
	"company_id" uuid,
	"department_id" uuid,
	"location_id" uuid,
	"manager_id" uuid,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"join_date" date,
	"notice_date" date,
	"last_working_date" date,
	"exit_date" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employees_employee_code_unique" UNIQUE("employee_code"),
	CONSTRAINT "employees_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "exit_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_number" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"notice_date" date,
	"last_working_date" date NOT NULL,
	"reason" text,
	"initiated_by" uuid,
	"initiated_by_name" text,
	"completed_at" timestamp with time zone,
	"completed_by_name" text,
	"overridden" boolean DEFAULT false NOT NULL,
	"override_reason" text,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exit_cases_case_number_unique" UNIQUE("case_number")
);
--> statement-breakpoint
CREATE TABLE "exit_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exit_case_id" uuid NOT NULL,
	"asset_id" uuid,
	"allocation_id" uuid,
	"asset_tag" text,
	"asset_name" text NOT NULL,
	"asset_type_name" text,
	"category_name" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"source" text DEFAULT 'AUTO' NOT NULL,
	"notes" text,
	"resolved_at" timestamp with time zone,
	"resolved_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "field_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid,
	"asset_type_id" uuid,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"type" text NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"is_unique" boolean DEFAULT false NOT NULL,
	"options" jsonb,
	"min" double precision,
	"max" double precision,
	"placeholder" text,
	"help_text" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"show_in_table" boolean DEFAULT false NOT NULL,
	"filterable" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "field_definitions_owner_ck" CHECK (("field_definitions"."category_id" is null) <> ("field_definitions"."asset_type_id" is null))
);
--> statement-breakpoint
CREATE TABLE "history_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid,
	"actor_name" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"entity_label" text,
	"action" text NOT NULL,
	"summary" text NOT NULL,
	"changes" jsonb,
	"asset_id" uuid,
	"employee_id" uuid,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"type" text DEFAULT 'OFFICE' NOT NULL,
	"parent_id" uuid,
	"company_id" uuid,
	"address" text,
	"is_store" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "locations_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "maintenance_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"asset_id" uuid NOT NULL,
	"type" text DEFAULT 'REPAIR' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"vendor_id" uuid,
	"status" text DEFAULT 'SCHEDULED' NOT NULL,
	"scheduled_date" date,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cost" numeric(14, 2),
	"resolution" text,
	"previous_status" text,
	"created_by" uuid,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_records_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ownership_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"ownership" text NOT NULL,
	"owner_company_id" uuid,
	"owner_company_name" text,
	"vendor_id" uuid,
	"vendor_name" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"recorded_by" uuid
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "sequences" (
	"prefix" text PRIMARY KEY NOT NULL,
	"last_value" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"asset_id" uuid,
	"reported_by" uuid,
	"reported_by_name" text,
	"reporter_employee_id" uuid,
	"assignee_id" uuid,
	"type" text DEFAULT 'ISSUE' NOT NULL,
	"priority" text DEFAULT 'MEDIUM' NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"resolution" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tickets_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role_id" uuid NOT NULL,
	"employee_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"failed_logins" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_employee_id_unique" UNIQUE("employee_id")
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"contact_name" text,
	"email" text,
	"phone" text,
	"website" text,
	"address" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendors_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_requests" ADD CONSTRAINT "asset_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_requests" ADD CONSTRAINT "asset_requests_asset_type_id_asset_types_id_fk" FOREIGN KEY ("asset_type_id") REFERENCES "public"."asset_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_requests" ADD CONSTRAINT "asset_requests_fulfilled_asset_id_assets_id_fk" FOREIGN KEY ("fulfilled_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_types" ADD CONSTRAINT "asset_types_category_id_asset_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."asset_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_category_id_asset_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."asset_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_asset_type_id_asset_types_id_fk" FOREIGN KEY ("asset_type_id") REFERENCES "public"."asset_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_owner_company_id_companies_id_fk" FOREIGN KEY ("owner_company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_parent_id_departments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_manager_id_employees_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exit_cases" ADD CONSTRAINT "exit_cases_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exit_items" ADD CONSTRAINT "exit_items_exit_case_id_exit_cases_id_fk" FOREIGN KEY ("exit_case_id") REFERENCES "public"."exit_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exit_items" ADD CONSTRAINT "exit_items_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exit_items" ADD CONSTRAINT "exit_items_allocation_id_allocations_id_fk" FOREIGN KEY ("allocation_id") REFERENCES "public"."allocations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_definitions" ADD CONSTRAINT "field_definitions_category_id_asset_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."asset_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_definitions" ADD CONSTRAINT "field_definitions_asset_type_id_asset_types_id_fk" FOREIGN KEY ("asset_type_id") REFERENCES "public"."asset_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_parent_id_locations_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ownership_records" ADD CONSTRAINT "ownership_records_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ownership_records" ADD CONSTRAINT "ownership_records_owner_company_id_companies_id_fk" FOREIGN KEY ("owner_company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ownership_records" ADD CONSTRAINT "ownership_records_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_reporter_employee_id_employees_id_fk" FOREIGN KEY ("reporter_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "allocations_one_active_uq" ON "allocations" USING btree ("asset_id") WHERE status = 'ACTIVE' and exclusive;--> statement-breakpoint
CREATE INDEX "allocations_asset_idx" ON "allocations" USING btree ("asset_id","status");--> statement-breakpoint
CREATE INDEX "allocations_employee_idx" ON "allocations" USING btree ("employee_id","status");--> statement-breakpoint
CREATE INDEX "allocations_holder_idx" ON "allocations" USING btree ("holder_type","status");--> statement-breakpoint
CREATE INDEX "requests_status_idx" ON "asset_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "requests_employee_idx" ON "asset_requests" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_types_category_name_uq" ON "asset_types" USING btree ("category_id","name");--> statement-breakpoint
CREATE INDEX "assets_status_idx" ON "assets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "assets_category_idx" ON "assets" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "assets_type_idx" ON "assets" USING btree ("asset_type_id");--> statement-breakpoint
CREATE INDEX "assets_location_idx" ON "assets" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "assets_holder_idx" ON "assets" USING btree ("holder_type","holder_id");--> statement-breakpoint
CREATE INDEX "assets_created_idx" ON "assets" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "assets_serial_idx" ON "assets" USING btree (lower("serial_number"));--> statement-breakpoint
CREATE INDEX "assets_attributes_gin" ON "assets" USING gin ("attributes" jsonb_path_ops);--> statement-breakpoint
CREATE INDEX "assets_search_gin" ON "assets" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "departments_company_idx" ON "departments" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "employees_status_idx" ON "employees" USING btree ("status");--> statement-breakpoint
CREATE INDEX "employees_department_idx" ON "employees" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "employees_name_idx" ON "employees" USING btree (lower("full_name"));--> statement-breakpoint
CREATE UNIQUE INDEX "exit_cases_one_open_uq" ON "exit_cases" USING btree ("employee_id") WHERE status = 'OPEN';--> statement-breakpoint
CREATE INDEX "exit_cases_status_idx" ON "exit_cases" USING btree ("status","last_working_date");--> statement-breakpoint
CREATE INDEX "exit_items_case_idx" ON "exit_items" USING btree ("exit_case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exit_items_allocation_uq" ON "exit_items" USING btree ("exit_case_id","allocation_id");--> statement-breakpoint
CREATE INDEX "exit_items_allocation_idx" ON "exit_items" USING btree ("allocation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "field_definitions_category_key_uq" ON "field_definitions" USING btree ("category_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "field_definitions_type_key_uq" ON "field_definitions" USING btree ("asset_type_id","key");--> statement-breakpoint
CREATE INDEX "history_entity_idx" ON "history_events" USING btree ("entity_type","entity_id","occurred_at");--> statement-breakpoint
CREATE INDEX "history_asset_idx" ON "history_events" USING btree ("asset_id","occurred_at");--> statement-breakpoint
CREATE INDEX "history_employee_idx" ON "history_events" USING btree ("employee_id","occurred_at");--> statement-breakpoint
CREATE INDEX "history_occurred_idx" ON "history_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "locations_parent_idx" ON "locations" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "maintenance_asset_idx" ON "maintenance_records" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "maintenance_status_idx" ON "maintenance_records" USING btree ("status");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ownership_asset_idx" ON "ownership_records" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tickets_status_idx" ON "tickets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tickets_asset_idx" ON "tickets" USING btree ("asset_id");