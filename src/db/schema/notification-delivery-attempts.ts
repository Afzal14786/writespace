import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { notificationDeliveries } from "./notification-deliveries";

export type NotificationDeliveryAttemptOutcome =
  | "processing"
  | "accepted"
  | "delivered"
  | "transient_failure"
  | "permanent_failure"
  | "ambiguous"
  | "suppressed";

export const notificationDeliveryAttempts = pgTable(
  "notification_delivery_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    deliveryId: uuid("delivery_id")
      .notNull()
      .references(() => notificationDeliveries.id, { onDelete: "cascade" }),

    attemptNumber: integer("attempt_number").notNull(),

    outcome: text("outcome")
      .$type<NotificationDeliveryAttemptOutcome>()
      .notNull(),

    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),

    completedAt: timestamp("completed_at", { withTimezone: true }),

    latencyMs: bigint("latency_ms", { mode: "number" }),

    errorCode: text("error_code"),
    providerResponseCode: text("provider_response_code"),
    providerMessageId: text("provider_message_id"),
  },
  (table) => [
    check(
      "notification_delivery_attempts_number_positive_check",
      sql`${table.attemptNumber} > 0`,
    ),

    check(
      "notification_delivery_attempts_latency_nonnegative_check",
      sql`${table.latencyMs} IS NULL OR ${table.latencyMs} >= 0`,
    ),

    check(
      "notification_delivery_attempts_outcome_check",
      sql`${table.outcome} IN (
        'processing',
        'accepted',
        'delivered',
        'transient_failure',
        'permanent_failure',
        'ambiguous',
        'suppressed'
      )`,
    ),

    /*
     * An active attempt has no completion time.
     * Every terminal attempt must have one.
     */
    check(
      "notification_delivery_attempts_completion_check",
      sql`(
        (${table.outcome} = 'processing' AND ${table.completedAt} IS NULL)
        OR
        (${table.outcome} <> 'processing' AND ${table.completedAt} IS NOT NULL)
      )`,
    ),

    uniqueIndex("notification_delivery_attempts_delivery_number_uq").on(
      table.deliveryId,
      table.attemptNumber,
    ),

    index("notification_delivery_attempts_delivery_idx").on(
      table.deliveryId,
      table.attemptNumber,
    ),
  ],
);

export type NotificationDeliveryAttempt =
  typeof notificationDeliveryAttempts.$inferSelect;

export type NewNotificationDeliveryAttempt =
  typeof notificationDeliveryAttempts.$inferInsert;
