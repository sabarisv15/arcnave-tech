CREATE TABLE "conversation_compactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" uuid NOT NULL,
	"through_message_id" uuid NOT NULL,
	"through_seq" integer NOT NULL,
	"summary" jsonb NOT NULL,
	"token_count_before" integer,
	"token_count_after" integer,
	"provider" varchar(32),
	"model" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"scope" varchar(16) DEFAULT 'global' NOT NULL,
	"project_id" uuid,
	"kind" varchar(24) DEFAULT 'preference' NOT NULL,
	"key" varchar(200) NOT NULL,
	"content" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"is_standing" boolean DEFAULT false NOT NULL,
	"source_type" varchar(32) DEFAULT 'user_statement' NOT NULL,
	"source_chat_id" uuid,
	"source_message_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation_compactions" ADD CONSTRAINT "conversation_compactions_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_compactions" ADD CONSTRAINT "conversation_compactions_through_message_id_messages_id_fk" FOREIGN KEY ("through_message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_items" ADD CONSTRAINT "memory_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_items" ADD CONSTRAINT "memory_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_items" ADD CONSTRAINT "memory_items_source_chat_id_chats_id_fk" FOREIGN KEY ("source_chat_id") REFERENCES "public"."chats"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_items" ADD CONSTRAINT "memory_items_source_message_id_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_compactions_chat_seq" ON "conversation_compactions" USING btree ("chat_id","through_seq");--> statement-breakpoint
CREATE INDEX "ix_compactions_chat" ON "conversation_compactions" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "ix_memory_user_scope" ON "memory_items" USING btree ("user_id","scope","project_id");--> statement-breakpoint
CREATE INDEX "ix_memory_user_standing" ON "memory_items" USING btree ("user_id","is_standing");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_memory_user_scope_key" ON "memory_items" USING btree ("user_id","scope",coalesce("project_id", '00000000-0000-0000-0000-000000000000'::uuid),"key");--> statement-breakpoint
CREATE INDEX "ix_memory_fts" ON "memory_items" USING gin (to_tsvector('simple', coalesce("key", '') || ' ' || coalesce("summary", '') || ' ' || coalesce("content", '')));