ALTER TABLE "preferences" ALTER COLUMN "max_output_tokens" SET DEFAULT 32000;--> statement-breakpoint
-- 4096 was the old default, and Gemini's thinking tokens count against it: a 12-page statement
-- answer was cut at ~200 visible tokens. Rows still on the old default move to the new one; a
-- user who chose any other value keeps it.
UPDATE "preferences" SET "max_output_tokens" = 32000 WHERE "max_output_tokens" = 4096;
