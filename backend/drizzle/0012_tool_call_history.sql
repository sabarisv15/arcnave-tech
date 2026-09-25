ALTER TABLE "tool_calls" ADD COLUMN "thought_signature" text;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD COLUMN "result_cleared" boolean DEFAULT false NOT NULL;