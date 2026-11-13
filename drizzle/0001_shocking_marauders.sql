ALTER TABLE "notification_deliveries" ADD COLUMN "reconciliation_attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "next_reconciliation_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "reconciliation_locked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "reconciliation_locked_by" text;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "reconciliation_lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "reconciliation_last_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "reconciliation_last_error" text;--> statement-breakpoint
CREATE INDEX "notification_deliveries_reconciliation_schedule_idx" ON "notification_deliveries" USING btree ("status","eligibility_decision","next_reconciliation_at","created_at");--> statement-breakpoint
CREATE INDEX "notification_deliveries_reconciliation_lease_idx" ON "notification_deliveries" USING btree ("reconciliation_lease_expires_at");--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_reconciliation_attempt_count_check" CHECK ("notification_deliveries"."reconciliation_attempt_count" >= 0);--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_reconciliation_lease_state_check" CHECK ((
        (
          "notification_deliveries"."reconciliation_locked_at" IS NULL
          AND "notification_deliveries"."reconciliation_locked_by" IS NULL
          AND "notification_deliveries"."reconciliation_lease_expires_at" IS NULL
        )
        OR
        (
          "notification_deliveries"."reconciliation_locked_at" IS NOT NULL
          AND "notification_deliveries"."reconciliation_locked_by" IS NOT NULL
          AND length(trim("notification_deliveries"."reconciliation_locked_by")) > 0
          AND "notification_deliveries"."reconciliation_lease_expires_at" IS NOT NULL
        )
      ));