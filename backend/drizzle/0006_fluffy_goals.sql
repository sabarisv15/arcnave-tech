CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" uuid NOT NULL,
	"origin_message_id" uuid,
	"description" text NOT NULL,
	"status" varchar(32) DEFAULT 'active' NOT NULL,
	"token_budget" integer,
	"spent_tokens" integer DEFAULT 0 NOT NULL,
	"blocked_reason" text,
	"last_failure_fingerprint" text,
	"consecutive_failure_count" integer DEFAULT 0 NOT NULL,
	"last_failed_tool" text,
	"last_failure_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "goal_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" uuid NOT NULL,
	"run_id" varchar(64),
	"type" varchar(32) NOT NULL,
	"tool_name" text,
	"failure_fingerprint" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_origin_message_id_messages_id_fk" FOREIGN KEY ("origin_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "goal_events" ADD CONSTRAINT "goal_events_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "ix_goals_chat" ON "goals" USING btree ("chat_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_active_goal_per_chat" ON "goals" USING btree ("chat_id") WHERE ("goals"."status" = 'active');
--> statement-breakpoint
CREATE INDEX "ix_goal_events_goal" ON "goal_events" USING btree ("goal_id");
--> statement-breakpoint
CREATE INDEX "ix_goal_events_created" ON "goal_events" USING btree ("created_at");
