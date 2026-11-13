import {
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

import { notificationGroups } from "./notification-groups";
import { notifications } from "./notifications";
import { users } from "./users";

export type NotificationDeliveryChannel = "realtime" | "email" | "browser_push";

export type NotificationDeliveryStatus =
  | "queued"
  | "processing"
  | "accepted"
  | "delivered"
  | "retryable_failed"
  | "permanent_failed"
  | "suppressed"
  | "unknown"
  | "dead_lettered";

export type NotificationEligibilityDecision =
  | "eligible"
  | "deferred"
  | "suppressed";

/**
 * Tracks one logical delivery request for a recipient and channel.
 *
 * The notification inbox and channel delivery lifecycle are independent.
 * A delivery may exist without an inbox notification, for example when
 * email is eligible but in-app notifications are disabled.
 *
 * This table stores the latest delivery state. Individual attempts and
 * their diagnostic results are stored in notification_delivery_attempts.
 */
export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    // Nullable because some valid delivery requests have no inbox item.
    notificationId: uuid("notification_id").references(() => notifications.id, {
      onDelete: "set null",
    }),

    // Supports grouped channel delivery, including grouped email summaries.
    groupId: uuid("group_id").references(() => notificationGroups.id, {
      onDelete: "set null",
    }),

    // Nullable so operational history can be anonymized during account deletion.
    recipientUserId: uuid("recipient_user_id").references(() => users.id, {
      onDelete: "set null",
    }),

    // Logical source event reference. Intentionally no outbox foreign key.
    sourceEventId: uuid("source_event_id"),

    channel: text("channel").$type<NotificationDeliveryChannel>().notNull(),

    status: text("status")
      .$type<NotificationDeliveryStatus>()
      .default("queued")
      .notNull(),

    // Stable key for this logical delivery request across retries.
    idempotencyKey: text("idempotency_key").notNull(),

    // Total number of attempts recorded for this logical delivery.
    attemptCount: integer("attempt_count").default(0).notNull(),

    // Earliest time a retry may be attempted.
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),

    /*
     * Lease information for a worker that currently owns this delivery.
     *
     * A lease prevents multiple workers from concurrently performing the
     * same logical delivery. Expired leases require explicit recovery.
     */
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    leaseExpiresAt: timestamp("lease_expires_at", {
      withTimezone: true,
    }),

    /*
     * Reconciliation metadata is separate from delivery attempts.
     *
     * Repairing a BullMQ job must not increment attemptCount because
     * no external delivery operation has necessarily taken place.
     */
    reconciliationAttemptCount: integer("reconciliation_attempt_count")
      .default(0)
      .notNull(),

    // Earliest time the delivery may be inspected for queue recovery.
    nextReconciliationAt: timestamp("next_reconciliation_at", {
      withTimezone: true,
    }),

    // Lease preventing multiple reconciliation workers from repairing
    // the same delivery simultaneously.
    reconciliationLockedAt: timestamp("reconciliation_locked_at", {
      withTimezone: true,
    }),

    reconciliationLockedBy: text("reconciliation_locked_by"),

    reconciliationLeaseExpiresAt: timestamp("reconciliation_lease_expires_at", {
      withTimezone: true,
    }),

    reconciliationLastAttemptAt: timestamp("reconciliation_last_attempt_at", {
      withTimezone: true,
    }),

    reconciliationLastError: text("reconciliation_last_error"),

    // Transport acceptance is not necessarily confirmed delivery.
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),

    confirmedDeliveredAt: timestamp("confirmed_delivered_at", {
      withTimezone: true,
    }),

    providerMessageId: text("provider_message_id"),
    lastErrorCode: text("last_error_code"),

    // A delivery past its useful lifetime must not be sent.
    expiresAt: timestamp("expires_at", { withTimezone: true }),

    // Preserve the policy decision that produced this delivery request.
    policyVersion: text("policy_version").notNull(),

    eligibilityDecision: text("eligibility_decision")
      .$type<NotificationEligibilityDecision>()
      .notNull(),

    reasonCode: text("reason_code"),

    preferenceEvaluatedAt: timestamp("preference_evaluated_at", {
      withTimezone: true,
    }),

    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),

    // Used by the email worker to select a stable template version.
    templateVersion: text("template_version"),

    locale: text("locale"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    check(
      "notification_deliveries_channel_check",
      sql`${table.channel} IN ('realtime', 'email', 'browser_push')`,
    ),

    check(
      "notification_deliveries_status_check",
      sql`${table.status} IN (
        'queued',
        'processing',
        'accepted',
        'delivered',
        'retryable_failed',
        'permanent_failed',
        'suppressed',
        'unknown',
        'dead_lettered'
      )`,
    ),

    check(
      "notification_deliveries_attempt_count_check",
      sql`${table.attemptCount} >= 0`,
    ),

    check(
      "notification_deliveries_eligibility_check",
      sql`${table.eligibilityDecision} IN (
        'eligible',
        'deferred',
        'suppressed'
      )`,
    ),

    check(
      "notification_deliveries_idempotency_key_not_empty_check",
      sql`length(trim(${table.idempotencyKey})) > 0`,
    ),

    check(
      "notification_deliveries_policy_version_not_empty_check",
      sql`length(trim(${table.policyVersion})) > 0`,
    ),

    /*
     * A processing delivery must have a complete lease.
     * All other states must have their lease fields cleared.
     */
    check(
      "notification_deliveries_lease_state_check",
      sql`(
        (
          ${table.status} = 'processing'
          AND ${table.lockedAt} IS NOT NULL
          AND ${table.lockedBy} IS NOT NULL
          AND length(trim(${table.lockedBy})) > 0
          AND ${table.leaseExpiresAt} IS NOT NULL
        )
        OR
        (
          ${table.status} <> 'processing'
          AND ${table.lockedAt} IS NULL
          AND ${table.lockedBy} IS NULL
          AND ${table.leaseExpiresAt} IS NULL
        )
      )`,
    ),

    check(
      "notification_deliveries_reconciliation_attempt_count_check",
      sql`${table.reconciliationAttemptCount} >= 0`,
    ),

    /*
     * Reconciliation ownership must be either completely assigned
     * or completely cleared.
     */
    check(
      "notification_deliveries_reconciliation_lease_state_check",
      sql`(
        (
          ${table.reconciliationLockedAt} IS NULL
          AND ${table.reconciliationLockedBy} IS NULL
          AND ${table.reconciliationLeaseExpiresAt} IS NULL
        )
        OR
        (
          ${table.reconciliationLockedAt} IS NOT NULL
          AND ${table.reconciliationLockedBy} IS NOT NULL
          AND length(trim(${table.reconciliationLockedBy})) > 0
          AND ${table.reconciliationLeaseExpiresAt} IS NOT NULL
        )
      )`,
    ),

    // The same logical delivery request must not be created twice.
    uniqueIndex("notification_deliveries_idempotency_key_uq").on(
      table.idempotencyKey,
    ),

    // Supports workers looking for due queued or retryable deliveries.
    index("notification_deliveries_schedule_idx").on(
      table.status,
      table.nextAttemptAt,
      table.createdAt,
    ),

    // Supports finding deliveries whose worker leases have expired.
    index("notification_deliveries_processing_lease_idx").on(
      table.status,
      table.leaseExpiresAt,
    ),

    index("notification_deliveries_recipient_created_idx").on(
      table.recipientUserId,
      table.createdAt,
    ),

    index("notification_deliveries_notification_idx").on(table.notificationId),

    index("notification_deliveries_group_idx").on(table.groupId),
    index("notification_deliveries_reconciliation_schedule_idx").on(
      table.status,
      table.eligibilityDecision,
      table.nextReconciliationAt,
      table.createdAt,
    ),

    index("notification_deliveries_reconciliation_lease_idx").on(
      table.reconciliationLeaseExpiresAt,
    ),
  ],
);

export type NotificationDelivery = typeof notificationDeliveries.$inferSelect;

export type NewNotificationDelivery =
  typeof notificationDeliveries.$inferInsert;
