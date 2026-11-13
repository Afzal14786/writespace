import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { users } from "./users";

/**
 * Lifecycle of an event stored in the transactional outbox.
 *
 * PENDING:
 *   The event is ready to be claimed by the outbox dispatcher.
 *
 * PROCESSING:
 *   A dispatcher instance has claimed the event using a temporary lease.
 *
 * PUBLISHED:
 *   The event was successfully handed off to the message queue.
 *
 * FAILED:
 *   Automatic dispatch attempts have been exhausted. The event remains
 *   available for inspection and an authorised manual recovery operation.
 *
 * PUBLISHED does not mean that every downstream consumer has completed
 * processing. Consumer processing is tracked separately.
 */
export const outboxEventStatusEnum = pgEnum("outbox_event_status", [
  "PENDING",
  "PROCESSING",
  "PUBLISHED",
  "FAILED",
]);

/**
 * Durable event outbox.
 *
 * A domain operation and its corresponding outbox event must be written
 * within the same PostgreSQL transaction. This prevents the application
 * from committing a business change while losing the event that should
 * trigger its downstream work.
 *
 * The dispatcher will later claim rows using a lease, publish a minimal
 * event reference to BullMQ, and mark successfully published rows.
 *
 * Event-specific payloads are intentionally JSONB. Their shape and
 * compatibility will be validated by the notification event registry,
 * rather than by creating a PostgreSQL enum or table for every event type.
 */
export const outboxEvents = pgTable(
  "outbox_events",
  {
    // Stable event identity. Queue retries and consumers will reuse this ID.
    id: uuid("id").defaultRandom().primaryKey(),

    // Examples: "user.registered", "content.published", "reaction.added".
    // Kept as text so new event names do not require database enum migrations.
    eventName: text("event_name").notNull(),

    // Increment when the structure or meaning of this event's payload changes.
    eventVersion: integer("event_version").default(1).notNull(),

    // Identifies the application module or subsystem that produced the event.
    producer: text("producer").notNull(),

    // Aggregate information is useful for tracing related events.
    // The ID is text because different aggregates may use different ID formats.
    aggregateType: text("aggregate_type"),
    aggregateId: text("aggregate_id"),

    // Optional actor information. If the user is deleted, retain the event
    // while clearing the actor reference.
    actorId: uuid("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),

    // Event-specific data, validated at the application boundary.
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),

    // Cross-cutting context such as request, correlation, or causation IDs.
    // These are text rather than UUIDs so external trace identifiers can
    // also be represented.
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),

    correlationId: text("correlation_id"),
    causationId: text("causation_id"),

    // Time the domain event occurred, not the time a worker later processes it.
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .defaultNow()
      .notNull(),

    status: outboxEventStatusEnum("status").default("PENDING").notNull(),

    // Earliest time the dispatcher may attempt to publish this event.
    // Failed transient attempts can move this time forward for backoff.
    availableAt: timestamp("available_at", { withTimezone: true })
      .defaultNow()
      .notNull(),

    attemptCount: integer("attempt_count").default(0).notNull(),

    // Lease information prevents multiple dispatcher instances from
    // intentionally claiming the same row at the same time.
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    leaseExpiresAt: timestamp("lease_expires_at", {
      withTimezone: true,
    }),

    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    lastError: text("last_error"),

    publishedAt: timestamp("published_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check(
      "outbox_events_event_version_positive_check",
      sql`${table.eventVersion} > 0`,
    ),

    check(
      "outbox_events_attempt_count_nonnegative_check",
      sql`${table.attemptCount} >= 0`,
    ),

    // Supports finding events that are ready for dispatch.
    index("outbox_events_status_available_created_idx").on(
      table.status,
      table.availableAt,
      table.createdAt,
    ),

    // Supports recovering PROCESSING events whose leases have expired.
    index("outbox_events_status_lease_expires_idx").on(
      table.status,
      table.leaseExpiresAt,
    ),

    // Useful for tracing and inspecting a particular event category.
    index("outbox_events_name_created_idx").on(
      table.eventName,
      table.createdAt,
    ),

    // Helps inspect the event history associated with an aggregate.
    index("outbox_events_aggregate_idx").on(
      table.aggregateType,
      table.aggregateId,
      table.occurredAt,
    ),
  ],
);

export type OutboxEvent = typeof outboxEvents.$inferSelect;
export type NewOutboxEvent = typeof outboxEvents.$inferInsert;

export type OutboxEventStatus =
  (typeof outboxEventStatusEnum.enumValues)[number];
