CREATE TABLE "file_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"attachment_id" uuid,
	"project_file_id" uuid,
	"kind" varchar(16) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"lane" varchar(8) DEFAULT 'normal' NOT NULL,
	"state" varchar(16) DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"lease_owner" varchar(64),
	"lease_expires_at" timestamp with time zone,
	"error_code" varchar(32) DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "ck_file_jobs_target" CHECK ("file_jobs"."attachment_id" is not null or "file_jobs"."project_file_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "upload_quota" (
	"user_id" uuid NOT NULL,
	"day" varchar(10) NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "error_code" varchar(32) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "warnings" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "parent_attachment_id" uuid;--> statement-breakpoint
ALTER TABLE "project_files" ADD COLUMN "error_code" varchar(32) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_files" ADD COLUMN "warnings" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "project_files" ADD COLUMN "index_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "file_jobs" ADD CONSTRAINT "file_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_jobs" ADD CONSTRAINT "file_jobs_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_jobs" ADD CONSTRAINT "file_jobs_project_file_id_project_files_id_fk" FOREIGN KEY ("project_file_id") REFERENCES "public"."project_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_quota" ADD CONSTRAINT "upload_quota_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_file_jobs_attachment" ON "file_jobs" USING btree ("attachment_id","kind","version");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_file_jobs_project_file" ON "file_jobs" USING btree ("project_file_id","kind","version");--> statement-breakpoint
CREATE INDEX "ix_file_jobs_claim" ON "file_jobs" USING btree ("state","lane","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_upload_quota_user_day" ON "upload_quota" USING btree ("user_id","day");--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_parent_attachment_id_attachments_id_fk" FOREIGN KEY ("parent_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_attachments_parent" ON "attachments" USING btree ("parent_attachment_id");