import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export type NotificationSuppressionChannel = "email" | "browser_push";

export const notificationSuppressions = pgTable(
  "notification_suppressions",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    channel: text("channel").$type<NotificationSuppressionChannel>().notNull(),

    // Keyed fingerprint of the normalized destination.
    // Never store the raw email address or destination as the lookup key.
    destinationFingerprint: text("destination_fingerprint").notNull(),

    reason: text("reason").notNull(),
    source: text("source"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("notification_suppressions_channel_destination_uq").on(
      table.channel,
      table.destinationFingerprint,
    ),

    index("notification_suppressions_created_idx").on(table.createdAt),
  ],
);

export type NotificationSuppression =
  typeof notificationSuppressions.$inferSelect;

export type NewNotificationSuppression =
  typeof notificationSuppressions.$inferInsert;
