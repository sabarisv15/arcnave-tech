CREATE TABLE "derivative_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"derivative_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"text" text NOT NULL,
	"page" integer,
	"locator" varchar(120) DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_derivative_pages" (
	"derivative_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"kind" varchar(16) NOT NULL,
	"label" varchar(120) DEFAULT '' NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"source" varchar(16) NOT NULL,
	"ocr_engine" varchar(32),
	"ocr_version" varchar(64),
	"t_start_ms" integer,
	"t_end_ms" integer
);
--> statement-breakpoint
CREATE TABLE "file_derivatives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"attachment_id" uuid,
	"project_file_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"kind" varchar(16) NOT NULL,
	"extractor_version" varchar(32) NOT NULL,
	"markdown_key" varchar(300),
	"markdown_chars" integer DEFAULT 0 NOT NULL,
	"sidecar" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"token_counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"normalized_key" varchar(300),
	"normalized_mime_type" varchar(160),
	"checksum_sha256" varchar(64) DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_file_derivatives_target" CHECK ("file_derivatives"."attachment_id" is not null or "file_derivatives"."project_file_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "checksum_sha256" varchar(64) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "object_generation" varchar(64) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_files" ADD COLUMN "object_generation" varchar(64) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "derivative_chunks" ADD CONSTRAINT "derivative_chunks_derivative_id_file_derivatives_id_fk" FOREIGN KEY ("derivative_id") REFERENCES "public"."file_derivatives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_derivative_pages" ADD CONSTRAINT "file_derivative_pages_derivative_id_file_derivatives_id_fk" FOREIGN KEY ("derivative_id") REFERENCES "public"."file_derivatives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_derivatives" ADD CONSTRAINT "file_derivatives_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_derivatives" ADD CONSTRAINT "file_derivatives_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_derivatives" ADD CONSTRAINT "file_derivatives_project_file_id_project_files_id_fk" FOREIGN KEY ("project_file_id") REFERENCES "public"."project_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_derivative_chunks" ON "derivative_chunks" USING btree ("derivative_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_file_derivative_pages" ON "file_derivative_pages" USING btree ("derivative_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_file_derivatives_attachment" ON "file_derivatives" USING btree ("attachment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_file_derivatives_project_file" ON "file_derivatives" USING btree ("project_file_id");--> statement-breakpoint
CREATE INDEX "ix_file_derivatives_checksum" ON "file_derivatives" USING btree ("user_id","checksum_sha256");