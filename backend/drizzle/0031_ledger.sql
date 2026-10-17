-- N-70: migration lock_timeout 5 s and statement_timeout 300 s, for this migration's transaction.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '300s';--> statement-breakpoint
-- P22 (ADR-0079): model_calls is partitioned by month on started_at (hand-edited; drizzle-kit
-- cannot express PARTITION BY). The primary key carries the partition key, as Postgres requires.
CREATE TABLE "model_calls" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"usage_record_id" uuid,
	"turn_id" uuid,
	"user_id" uuid NOT NULL,
	"chat_id" uuid,
	"message_id" uuid,
	"ordinal" integer NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"role" varchar(16) NOT NULL,
	"provider" varchar(32) NOT NULL,
	"provider_model_id" varchar(128) NOT NULL,
	"provider_ref_type" varchar(16),
	"provider_ref" varchar(128),
	"finish_reason" varchar(48),
	"outcome" varchar(16) NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"tokens_exact" boolean DEFAULT false NOT NULL,
	"usage_source" varchar(16) NOT NULL,
	"traffic_tier" varchar(16) DEFAULT 'standard' NOT NULL,
	"price_version" varchar(64),
	"cost_usd" double precision,
	"cost_inr" double precision,
	"fx_inr_per_usd" double precision,
	"provider_ttft_ms" integer,
	"duration_ms" integer,
	CONSTRAINT "model_calls_id_started_at_pk" PRIMARY KEY("id","started_at"),
	CONSTRAINT "ck_model_calls_role" CHECK ("model_calls"."role" in ('answer', 'forced_answer', 'title', 'style', 'summary', 'router')),
	CONSTRAINT "ck_model_calls_source" CHECK ("model_calls"."usage_source" in ('provider', 'provider_partial', 'none')),
	CONSTRAINT "ck_model_calls_outcome" CHECK ("model_calls"."outcome" in ('ok', 'partial', 'no_usage', 'error'))
) PARTITION BY RANGE ("started_at");
--> statement-breakpoint
-- Rows outside every month partition land here instead of failing the settle transaction.
CREATE TABLE "model_calls_default" PARTITION OF "model_calls" DEFAULT;--> statement-breakpoint
-- This month's and next month's partitions, from the clock at migration time; ensureLedgerPartitions
-- (boot and the retention sweep) keeps creating them ahead after that.
DO $$
DECLARE
  m date := date_trunc('month', now() at time zone 'UTC')::date;
  i int;
  lo date;
BEGIN
  FOR i IN 0..1 LOOP
    lo := (m + make_interval(months => i))::date;
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF "model_calls" FOR VALUES FROM (%L) TO (%L)',
      'model_calls_y' || to_char(lo, 'YYYY') || 'm' || to_char(lo, 'MM'),
      (lo::timestamp at time zone 'UTC'),
      ((lo + interval '1 month')::timestamp at time zone 'UTC')
    );
  END LOOP;
END $$;--> statement-breakpoint
CREATE TABLE "price_table" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_model_id" varchar(128) NOT NULL,
	"token_type" varchar(16) NOT NULL,
	"traffic_tier" varchar(16) DEFAULT 'standard' NOT NULL,
	"usd_per_mtok" numeric(12, 6) NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"price_version" varchar(64) NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_price_token_type" CHECK ("price_table"."token_type" in ('input', 'output', 'cache_read', 'cache_write_5m')),
	CONSTRAINT "ck_price_dates" CHECK ("price_table"."effective_to" is null or "price_table"."effective_to" > "price_table"."effective_from"),
	CONSTRAINT "ck_price_nonnegative" CHECK ("price_table"."usd_per_mtok" >= 0)
);
--> statement-breakpoint
ALTER TABLE "budget_reservations" ADD COLUMN "settled_usage_record_id" uuid;--> statement-breakpoint
ALTER TABLE "budget_reservations" ADD COLUMN "price_version" varchar(64);--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "active_chat_id" uuid;--> statement-breakpoint
ALTER TABLE "usage_records" ADD COLUMN "price_version" varchar(64);--> statement-breakpoint
ALTER TABLE "usage_records" ADD COLUMN "provider_ttft_ms" integer;--> statement-breakpoint
ALTER TABLE "usage_records" ADD COLUMN "first_visible_ms" integer;--> statement-breakpoint
ALTER TABLE "usage_records" ADD COLUMN "turn_total_ms" integer;--> statement-breakpoint
ALTER TABLE "usage_records" ADD COLUMN "output_tps" double precision;--> statement-breakpoint
ALTER TABLE "model_calls" ADD CONSTRAINT "model_calls_usage_record_id_usage_records_id_fk" FOREIGN KEY ("usage_record_id") REFERENCES "public"."usage_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_calls" ADD CONSTRAINT "model_calls_turn_id_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."turns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_calls" ADD CONSTRAINT "model_calls_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_calls" ADD CONSTRAINT "model_calls_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_calls" ADD CONSTRAINT "model_calls_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_model_calls_usage" ON "model_calls" USING btree ("usage_record_id");--> statement-breakpoint
CREATE INDEX "ix_model_calls_user_started" ON "model_calls" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_price_row" ON "price_table" USING btree ("provider_model_id","token_type","traffic_tier","effective_from");--> statement-breakpoint
ALTER TABLE "budget_reservations" ADD CONSTRAINT "budget_reservations_settled_usage_record_id_usage_records_id_fk" FOREIGN KEY ("settled_usage_record_id") REFERENCES "public"."usage_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- No two price rows of one model, token type and tier overlap in time (Stage 18 CD-1). A trigger,
-- not an exclusion constraint, so the migration needs no btree_gist extension (ours).
CREATE FUNCTION "price_table_no_overlap"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "price_table" p
    WHERE p."id" <> NEW."id"
      AND p."provider_model_id" = NEW."provider_model_id"
      AND p."token_type" = NEW."token_type"
      AND p."traffic_tier" = NEW."traffic_tier"
      -- The same start is the upsert's conflict target: it becomes an UPDATE of that row (or a
      -- unique violation), never a second row, so it is not an overlap here.
      AND NOT (TG_OP = 'INSERT' AND p."effective_from" = NEW."effective_from")
      AND tstzrange(p."effective_from", p."effective_to", '[)') && tstzrange(NEW."effective_from", NEW."effective_to", '[)')
  ) THEN
    RAISE EXCEPTION 'price_table rows overlap for % % %', NEW."provider_model_id", NEW."token_type", NEW."traffic_tier"
      USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "price_table_no_overlap" BEFORE INSERT OR UPDATE ON "price_table"
  FOR EACH ROW EXECUTE FUNCTION "price_table_no_overlap"();