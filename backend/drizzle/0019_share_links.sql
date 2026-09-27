CREATE TABLE "share_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" varchar(64) NOT NULL,
	"target_type" varchar(16) NOT NULL,
	"target_id" uuid NOT NULL,
	"snapshot_seq" integer NOT NULL,
	"snapshot_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "ck_share_target_type" CHECK ("share_links"."target_type" in ('chat','artifact'))
);
--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_share_token" ON "share_links" USING btree ("token");--> statement-breakpoint
CREATE INDEX "ix_share_links_user" ON "share_links" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ix_share_links_target" ON "share_links" USING btree ("target_type","target_id");