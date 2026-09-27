ALTER TABLE "messages" ADD COLUMN "effort" varchar(16);--> statement-breakpoint
ALTER TABLE "preferences" ADD COLUMN "effort" varchar(16);--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "ck_message_effort" CHECK ("messages"."effort" is null or "messages"."effort" in ('low', 'medium', 'high', 'xhigh', 'max'));--> statement-breakpoint
ALTER TABLE "preferences" ADD CONSTRAINT "ck_effort" CHECK ("preferences"."effort" is null or "preferences"."effort" in ('low', 'medium', 'high', 'xhigh', 'max'));