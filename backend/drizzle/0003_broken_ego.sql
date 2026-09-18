ALTER TABLE "artifact_versions" ADD COLUMN "format" varchar(16) DEFAULT 'markdown' NOT NULL;--> statement-breakpoint
ALTER TABLE "artifact_versions" ADD COLUMN "storage_key" varchar(300);--> statement-breakpoint
ALTER TABLE "artifact_versions" ADD COLUMN "mime_type" varchar(160);--> statement-breakpoint
ALTER TABLE "artifact_versions" ADD COLUMN "size_bytes" integer;--> statement-breakpoint
ALTER TABLE "artifact_versions" ADD CONSTRAINT "ck_artifact_version_format" CHECK ("artifact_versions"."format" in ('markdown','xlsx','docx','pptx'));