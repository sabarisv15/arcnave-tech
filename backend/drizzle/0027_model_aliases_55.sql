-- ADR-0055: three models. A saved default that names a retired alias moves to its successor in
-- the same tier, which Settings and the composer show by name; gpt-oss has none, so Auto.
-- Stored messages keep the alias that answered them.
UPDATE "preferences" SET "model_alias" = 'Sonnet 5.5' WHERE "model_alias" = 'Sonnet 5';--> statement-breakpoint
UPDATE "preferences" SET "model_alias" = 'Opus 5.5' WHERE "model_alias" = 'Opus 5';--> statement-breakpoint
UPDATE "preferences" SET "model_alias" = 'Auto' WHERE "model_alias" = 'GPT-OSS 120B';
