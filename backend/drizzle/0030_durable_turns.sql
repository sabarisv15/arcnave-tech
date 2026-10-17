-- N-70: migration lock_timeout 5 s and statement_timeout 300 s, for this migration's transaction.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '300s';--> statement-breakpoint
CREATE TABLE "budget_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"turn_id" uuid,
	"owner" varchar(16) NOT NULL,
	"tokens" integer NOT NULL,
	"day_start" timestamp with time zone,
	"month_start" timestamp with time zone,
	"status" varchar(16) DEFAULT 'held' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "ck_reservations_owner" CHECK ("budget_reservations"."owner" in ('turn', 'utility')),
	CONSTRAINT "ck_reservations_status" CHECK ("budget_reservations"."status" in ('held', 'settled', 'released', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"user_message_id" uuid,
	"assistant_message_id" uuid NOT NULL,
	"kind" varchar(16) NOT NULL,
	"state" varchar(16) DEFAULT 'queued' NOT NULL,
	"finish_code" varchar(48),
	"request_id" varchar(64) NOT NULL,
	"params" jsonb NOT NULL,
	"fencing_token" integer DEFAULT 1 NOT NULL,
	"lease_owner" varchar(64),
	"lease_expires_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"last_seq" integer DEFAULT -1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "ck_turns_kind" CHECK ("turns"."kind" in ('send', 'regenerate')),
	CONSTRAINT "ck_turns_state" CHECK ("turns"."state" in ('queued', 'running', 'done', 'cancelled', 'failed', 'interrupted'))
);
--> statement-breakpoint
ALTER TABLE "budget_reservations" ADD CONSTRAINT "budget_reservations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_reservations" ADD CONSTRAINT "budget_reservations_turn_id_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."turns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turns" ADD CONSTRAINT "turns_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turns" ADD CONSTRAINT "turns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turns" ADD CONSTRAINT "turns_user_message_id_messages_id_fk" FOREIGN KEY ("user_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turns" ADD CONSTRAINT "turns_assistant_message_id_messages_id_fk" FOREIGN KEY ("assistant_message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_reservations_held" ON "budget_reservations" USING btree ("expires_at") WHERE "budget_reservations"."status" = 'held';--> statement-breakpoint
CREATE INDEX "ix_reservations_turn" ON "budget_reservations" USING btree ("turn_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_turns_running_chat" ON "turns" USING btree ("chat_id") WHERE "turns"."state" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "ix_turns_lease" ON "turns" USING btree ("lease_expires_at") WHERE "turns"."state" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "ix_turns_chat_created" ON "turns" USING btree ("chat_id","created_at");--> statement-breakpoint
CREATE INDEX "ix_turns_assistant" ON "turns" USING btree ("assistant_message_id");--> statement-breakpoint
CREATE INDEX "ix_messages_generating" ON "messages" USING btree ("created_at") WHERE "messages"."status" = 'generating';
