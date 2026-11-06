import {
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { notifications } from "./notifications";

/** Delivery channels currently implemented by the notification subsystem. */
export const notificationDeliveryChannelEnum = pgEnum(
  "notification_delivery_channel",
  ["IN_APP", "EMAIL"],
);

/** Lifecycle of one notification delivery attempt stream per channel. */
export const notificationDeliveryStatusEnum = pgEnum(
  "notification_delivery_status",
  ["PENDING", "PROCESSING", "SENT", "FAILED"],
);

/**
 * Tracks delivery state independently for each notification/channel pair.
 * The composite key prevents duplicate delivery-tracking rows for the same
 * channel while allowing the same notification to use multiple channels.
 */
export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    notificationId: integer("notification_id")
      .notNull()
      .references(() => notifications.id, { onDelete: "cascade" }),

    channel: notificationDeliveryChannelEnum("channel").notNull(),
    status: notificationDeliveryStatusEnum("status")
      .default("PENDING")
      .notNull(),

    attemptCount: integer("attempt_count").default(0).notNull(),
    lastError: text("last_error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
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
    primaryKey({ columns: [table.notificationId, table.channel] }),
    index("notification_deliveries_status_idx").on(table.status),
  ],
);

export type NotificationDelivery = typeof notificationDeliveries.$inferSelect;
export type NewNotificationDelivery =
  typeof notificationDeliveries.$inferInsert;
