CREATE TABLE "analytics_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"event" varchar(100) NOT NULL,
	"email" varchar(255),
	"product_id" integer,
	"metadata" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "circuit_breaker" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" varchar(64) NOT NULL,
	"state" varchar(20) DEFAULT 'closed' NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"last_failure_at" timestamp,
	"last_success_at" timestamp,
	"opened_at" timestamp,
	"half_open_attempts" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "circuit_breaker_provider_unique" UNIQUE("provider")
);
--> statement-breakpoint
CREATE TABLE "cron_lock" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_name" varchar(128) NOT NULL,
	"locked_at" timestamp DEFAULT now() NOT NULL,
	"locked_until" timestamp NOT NULL,
	"instance_id" varchar(64) NOT NULL,
	CONSTRAINT "cron_lock_job_name_unique" UNIQUE("job_name")
);
--> statement-breakpoint
CREATE TABLE "dead_letter_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"alert_id" integer,
	"email" varchar(255) NOT NULL,
	"product_id" integer,
	"pincode" varchar(10),
	"reason" text NOT NULL,
	"failed_at" timestamp DEFAULT now() NOT NULL,
	"delivery_id" varchar(64),
	"last_error" text,
	"retry_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar(128) NOT NULL,
	"response_status" integer NOT NULL,
	"response_body" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "user_usage" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"plan" varchar(50) DEFAULT 'free' NOT NULL,
	"active_alerts" integer DEFAULT 0 NOT NULL,
	"total_alerts_created" integer DEFAULT 0 NOT NULL,
	"total_notifications_sent" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_usage_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "notification_log" ALTER COLUMN "status" SET DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN "target_price" double precision;--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN "processing" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN "processing_until" timestamp;--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN "retry_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "notification_log" ADD COLUMN "delivery_id" varchar(64) NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_log" ADD COLUMN "retry_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_log" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "last_scraped_at" timestamp;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "scrape_error" text;--> statement-breakpoint
ALTER TABLE "dead_letter_queue" ADD CONSTRAINT "dead_letter_queue_alert_id_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."alerts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dead_letter_queue" ADD CONSTRAINT "dead_letter_queue_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alerts_dedup_idx" ON "alerts" USING btree ("email","product_id","pincode");--> statement-breakpoint
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_delivery_id_unique" UNIQUE("delivery_id");