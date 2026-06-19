CREATE TYPE "public"."access_mode" AS ENUM('full', 'partial');--> statement-breakpoint
ALTER TYPE "public"."payment_deposit_status" ADD VALUE 'funding_pending' BEFORE 'succeeded';--> statement-breakpoint
ALTER TYPE "public"."payment_deposit_status" ADD VALUE 'funding_failed' BEFORE 'failed';--> statement-breakpoint
CREATE TABLE "post_regions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"label" varchar(64) NOT NULL,
	"rect" jsonb NOT NULL,
	"patch_media_key" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "region_unlocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fan_id" uuid NOT NULL,
	"post_region_id" uuid NOT NULL,
	"payment_tx_hash" varchar(66) NOT NULL,
	"amount_paid" numeric(18, 8) NOT NULL,
	"settlement_ms" integer,
	"unlocked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "access_mode" "access_mode" DEFAULT 'full' NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "poster_key" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "post_regions" ADD CONSTRAINT "post_regions_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "region_unlocks" ADD CONSTRAINT "region_unlocks_fan_id_users_id_fk" FOREIGN KEY ("fan_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "region_unlocks" ADD CONSTRAINT "region_unlocks_post_region_id_post_regions_id_fk" FOREIGN KEY ("post_region_id") REFERENCES "public"."post_regions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "post_regions_post_idx" ON "post_regions" USING btree ("post_id");--> statement-breakpoint
CREATE UNIQUE INDEX "region_unlocks_fan_region_uniq" ON "region_unlocks" USING btree ("fan_id","post_region_id");--> statement-breakpoint
CREATE INDEX "region_unlocks_fan_idx" ON "region_unlocks" USING btree ("fan_id");