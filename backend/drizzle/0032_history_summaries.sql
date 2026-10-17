-- N-70: migration lock_timeout 5 s and statement_timeout 300 s, for this migration's transaction.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '300s';--> statement-breakpoint
CREATE TABLE "summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" uuid NOT NULL,
	"covers_upto_message_id" uuid NOT NULL,
	"covers_upto_seq" integer NOT NULL,
	"summary_version" integer NOT NULL,
	"text" text NOT NULL,
	"model" varchar(128) NOT NULL,
	"status" varchar(16) DEFAULT 'ready' NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_summaries_status" CHECK ("summaries"."status" in ('ready', 'discarded')),
	CONSTRAINT "ck_summaries_text_len" CHECK (char_length("summaries"."text") <= 6000)
);
--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "title_source" varchar(16) DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "history_turns" integer;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "history_dropped_turns" integer;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "ctx_tokens" integer;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "ctx_fixed_tokens" integer;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "ctx_count_source" varchar(16);--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "over_budget" boolean;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "summary_version" integer;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "prompt_version" varchar(64);--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "registry_version" varchar(32);--> statement-breakpoint
ALTER TABLE "summaries" ADD CONSTRAINT "summaries_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summaries" ADD CONSTRAINT "summaries_covers_upto_message_id_messages_id_fk" FOREIGN KEY ("covers_upto_message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_summaries_chat_covers" ON "summaries" USING btree ("chat_id","covers_upto_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_summaries_chat_version" ON "summaries" USING btree ("chat_id","summary_version");--> statement-breakpoint
CREATE INDEX "ix_summaries_chat_seq" ON "summaries" USING btree ("chat_id","covers_upto_seq");--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "ck_chats_title_source" CHECK ("chats"."title_source" in ('default', 'prompt', 'generated', 'user'));