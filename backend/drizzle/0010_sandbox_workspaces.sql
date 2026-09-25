CREATE TABLE "sandbox_workspaces" (
	"workspace_id" varchar(32) PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"chat_id" uuid NOT NULL,
	"last_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"saved_at" timestamp with time zone,
	"manifest_key" varchar(200),
	"saved_bytes" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sandbox_workspaces" ADD CONSTRAINT "sandbox_workspaces_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_workspaces" ADD CONSTRAINT "sandbox_workspaces_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_sandbox_workspaces_chat" ON "sandbox_workspaces" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "ix_sandbox_workspaces_last_run" ON "sandbox_workspaces" USING btree ("last_run_at");