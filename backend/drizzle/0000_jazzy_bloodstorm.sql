CREATE TABLE "artifact_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artifact_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid,
	"chat_id" uuid,
	"title" varchar(200) NOT NULL,
	"kind" varchar(16) DEFAULT 'document' NOT NULL,
	"current_version" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_artifact_kind" CHECK ("artifacts"."kind" in ('document','code','webpage'))
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"message_id" uuid,
	"filename" varchar(255) NOT NULL,
	"mime_type" varchar(160) NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_key" varchar(300) NOT NULL,
	"status" varchar(16) DEFAULT 'ready' NOT NULL,
	"error" text DEFAULT '' NOT NULL,
	"extracted_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid,
	"title" varchar(200) NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "file_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_file_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"text" text NOT NULL,
	"char_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"key" varchar(200) NOT NULL,
	"endpoint" varchar(120) NOT NULL,
	"request_fingerprint" varchar(64) NOT NULL,
	"response_json" jsonb NOT NULL,
	"status_code" integer DEFAULT 200 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"title" varchar(500) NOT NULL,
	"url" text NOT NULL,
	"url_resolved" boolean DEFAULT false NOT NULL,
	"domain" varchar(255) NOT NULL,
	"source_type" varchar(32) DEFAULT 'Web' NOT NULL,
	"snippet" text DEFAULT '' NOT NULL,
	"passage" text DEFAULT '' NOT NULL,
	"retrieved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"role" varchar(16) NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"mode" varchar(16) DEFAULT 'chat' NOT NULL,
	"status" varchar(16) DEFAULT 'complete' NOT NULL,
	"error_code" varchar(48),
	"research_stage" varchar(24),
	"questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"feedback" varchar(8),
	"model_alias" varchar(64),
	"provider" varchar(32),
	"provider_model_id" varchar(128),
	"finish_reason" varchar(48),
	"artifact_id" uuid,
	"search_entry_point" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "ck_message_role" CHECK ("messages"."role" in ('user','assistant')),
	CONSTRAINT "ck_message_feedback" CHECK ("messages"."feedback" is null or "messages"."feedback" in ('up','down'))
);
--> statement-breakpoint
CREATE TABLE "preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"theme" varchar(16) DEFAULT 'system' NOT NULL,
	"font" varchar(16) DEFAULT 'sans' NOT NULL,
	"model_alias" varchar(64) DEFAULT 'Auto' NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"enter_to_send" boolean DEFAULT true NOT NULL,
	"reduced_motion" boolean DEFAULT false NOT NULL,
	"default_mode" varchar(16) DEFAULT 'chat' NOT NULL,
	"source_scope" varchar(32) DEFAULT 'All sources' NOT NULL,
	"save_history" boolean DEFAULT true NOT NULL,
	"max_output_tokens" integer DEFAULT 4096 NOT NULL,
	"daily_token_budget" integer,
	"monthly_token_budget" integer,
	"warn_threshold_pct" integer DEFAULT 80 NOT NULL,
	"routing_preference" varchar(16) DEFAULT 'balanced' NOT NULL,
	"timezone" varchar(64) DEFAULT 'UTC' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_warn_threshold" CHECK ("preferences"."warn_threshold_pct" between 1 and 100),
	CONSTRAINT "ck_max_output_positive" CHECK ("preferences"."max_output_tokens" > 0),
	CONSTRAINT "ck_budgets_positive" CHECK (("preferences"."daily_token_budget" is null or "preferences"."daily_token_budget" > 0)
          and ("preferences"."monthly_token_budget" is null or "preferences"."monthly_token_budget" > 0))
);
--> statement-breakpoint
CREATE TABLE "project_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"filename" varchar(255) NOT NULL,
	"mime_type" varchar(160) NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_key" varchar(300) NOT NULL,
	"checksum_sha256" varchar(64) DEFAULT '' NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"error" text DEFAULT '' NOT NULL,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"indexed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "research_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"stage" varchar(24) NOT NULL,
	"label" varchar(300) NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"title" varchar(500) NOT NULL,
	"url" text NOT NULL,
	"domain" varchar(255) NOT NULL,
	"source_type" varchar(32) DEFAULT 'Web' NOT NULL,
	"snippet" text DEFAULT '' NOT NULL,
	"retrieved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_agent" varchar(300) DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_counters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"period_kind" varchar(8) NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"tokens_used" integer DEFAULT 0 NOT NULL,
	"tokens_reserved" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"request_id" varchar(64) NOT NULL,
	"chat_id" uuid,
	"message_id" uuid,
	"project_id" uuid,
	"model_alias" varchar(64) NOT NULL,
	"provider" varchar(32) NOT NULL,
	"provider_model_id" varchar(128) NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"tokens_exact" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"latency_ms" integer,
	"finish_reason" varchar(48),
	"status" varchar(16) DEFAULT 'complete' NOT NULL,
	"error_code" varchar(48),
	"cost_usd" double precision
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(320) NOT NULL,
	"password_hash" text NOT NULL,
	"name" varchar(120) DEFAULT '' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artifact_versions" ADD CONSTRAINT "artifact_versions_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_chunks" ADD CONSTRAINT "file_chunks_project_file_id_project_files_id_fk" FOREIGN KEY ("project_file_id") REFERENCES "public"."project_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_chunks" ADD CONSTRAINT "file_chunks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_sources" ADD CONSTRAINT "message_sources_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preferences" ADD CONSTRAINT "preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_files" ADD CONSTRAINT "project_files_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_files" ADD CONSTRAINT "project_files_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_events" ADD CONSTRAINT "research_events_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_sources" ADD CONSTRAINT "saved_sources_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_sources" ADD CONSTRAINT "saved_sources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_artifact_version" ON "artifact_versions" USING btree ("artifact_id","version");--> statement-breakpoint
CREATE INDEX "ix_artifacts_user" ON "artifacts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ix_artifacts_project" ON "artifacts" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_attachments_key" ON "attachments" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "ix_attachments_message" ON "attachments" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "ix_attachments_user" ON "attachments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ix_chats_user_updated" ON "chats" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "ix_chats_project" ON "chats" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_chunk_ordinal" ON "file_chunks" USING btree ("project_file_id","ordinal");--> statement-breakpoint
CREATE INDEX "ix_chunks_project" ON "file_chunks" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_idempotency" ON "idempotency_keys" USING btree ("user_id","key","endpoint");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_source_ordinal" ON "message_sources" USING btree ("message_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_message_seq" ON "messages" USING btree ("chat_id","seq");--> statement-breakpoint
CREATE INDEX "ix_messages_chat" ON "messages" USING btree ("chat_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_project_files_key" ON "project_files" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "ix_project_files_project" ON "project_files" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ix_projects_user_updated" ON "projects" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "ix_projects_user_order" ON "projects" USING btree ("user_id","pinned","position");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_event_ordinal" ON "research_events" USING btree ("message_id","ordinal");--> statement-breakpoint
CREATE INDEX "ix_saved_sources_project" ON "saved_sources" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sessions_token" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "ix_sessions_user" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ix_sessions_expires" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_usage_period" ON "usage_counters" USING btree ("user_id","period_kind","period_start");--> statement-breakpoint
CREATE INDEX "ix_usage_user_started" ON "usage_records" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "ix_usage_user_model" ON "usage_records" USING btree ("user_id","model_alias");--> statement-breakpoint
CREATE INDEX "ix_usage_request" ON "usage_records" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_users_email" ON "users" USING btree (lower("email"));