-- P11 (ADR-0081). N-70: migration lock_timeout 5 s and statement_timeout 300 s, for this migration's transaction.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '300s';--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "fallback_from" varchar(64);--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "fallback_reason" varchar(32);--> statement-breakpoint
ALTER TABLE "usage_records" ADD COLUMN "refusal_category" varchar(32);