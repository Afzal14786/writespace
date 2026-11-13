import {
  check,
  index,
  pgTable,
  primaryKey,
  timestamp,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export type ProcessedEventOutcome =
  | "processing"
  | "notification_created"
  | "group_updated"
  | "expired"
  | "no_delivery_required";

/**
 * Records the processing outcome for each consumer/event pair.
 *
 * The composite primary key prevents the same consumer from applying
 * the same event's effects more than once.
 *
 * A different consumer can process the same event independently.
 *
 * IMPORTANT:
 * eventId intentionally has no foreign key to outbox_events.
 *
 * Outbox records and idempotency records have different retention periods.
 * The outbox may be cleaned up after its operational retention period,
 * while processed-event records may need to remain longer to protect
 * against delayed retries or event replays.
 *
 * The "processing" outcome is an internal transaction-time value.
 * The processor must replace it with a terminal outcome before committing
 * the transaction that contains the processed-event marker.
 */
export const processedEvents = pgTable(
  "processed_events",
  {
    // Stable identity for a consumer, e.g. "notification-processor".
    consumerName: text("consumer_name").notNull(),

    // Logical reference to the source event; deliberately no foreign key.
    eventId: uuid("event_id").notNull(),

    // Final processing result, updated before the transaction commits.
    outcome: text("outcome")
      .$type<ProcessedEventOutcome>()
      .default("processing")
      .notNull(),

    processedAt: timestamp("processed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.consumerName, table.eventId],
    }),

    check(
      "processed_events_outcome_check",
      sql`${table.outcome} IN (
        'processing',
        'notification_created',
        'group_updated',
        'expired',
        'no_delivery_required'
      )`,
    ),

    // Useful when tracing all consumers that processed a given event.
    index("processed_events_event_id_idx").on(table.eventId),

    // Supports retention cleanup based on processing time.
    index("processed_events_processed_at_idx").on(table.processedAt),
  ],
);

export type ProcessedEvent = typeof processedEvents.$inferSelect;
export type NewProcessedEvent = typeof processedEvents.$inferInsert;
