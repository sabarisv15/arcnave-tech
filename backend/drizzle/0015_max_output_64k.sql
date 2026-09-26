ALTER TABLE "preferences" ALTER COLUMN "max_output_tokens" SET DEFAULT 64000;--> statement-breakpoint
-- Rows still on the old default were never chosen by the user; they move to the new one.
UPDATE "preferences" SET "max_output_tokens" = 64000 WHERE "max_output_tokens" = 32000;
