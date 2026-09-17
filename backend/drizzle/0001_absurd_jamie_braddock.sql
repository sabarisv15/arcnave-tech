DROP INDEX "uq_attachments_key";--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "project_file_id" uuid;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_project_file_id_project_files_id_fk" FOREIGN KEY ("project_file_id") REFERENCES "public"."project_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_attachments_key" ON "attachments" USING btree ("storage_key");