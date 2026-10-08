CREATE TABLE "platform"."event_cursors" (
	"company_id" uuid NOT NULL,
	"app" text NOT NULL,
	"last_id" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_cursors_company_id_app_pk" PRIMARY KEY("company_id","app")
);
--> statement-breakpoint
ALTER TABLE "platform"."people" ADD COLUMN "last_working_date" date;--> statement-breakpoint
ALTER TABLE "platform"."event_cursors" ADD CONSTRAINT "event_cursors_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "platform"."companies"("id") ON DELETE no action ON UPDATE no action;