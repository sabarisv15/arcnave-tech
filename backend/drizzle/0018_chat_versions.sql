ALTER TABLE "chats" ADD COLUMN "parent_chat_id" uuid;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "root_chat_id" uuid;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "fork_seq" integer;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_parent_chat_id_chats_id_fk" FOREIGN KEY ("parent_chat_id") REFERENCES "public"."chats"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_chats_root" ON "chats" USING btree ("root_chat_id");