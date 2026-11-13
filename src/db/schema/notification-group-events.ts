import {
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { notificationGroups } from "./notification-groups";
import { notifications } from "./notifications";
import { users } from "./users";

export const notificationGroupEvents = pgTable(
  "notification_group_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    groupId: uuid("group_id")
      .notNull()
      .references(() => notificationGroups.id, { onDelete: "cascade" }),

    // Optional because an email-only group can exist without an inbox item.
    notificationId: uuid("notification_id").references(() => notifications.id, {
      onDelete: "set null",
    }),

    // Logical reference to the durable source event; intentionally no FK.
    sourceEventId: uuid("source_event_id").notNull(),

    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),

    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    // A source event cannot be counted twice in the same group.
    uniqueIndex("notification_group_events_group_source_uq").on(
      table.groupId,
      table.sourceEventId,
    ),

    index("notification_group_events_source_event_idx").on(table.sourceEventId),

    index("notification_group_events_group_occurred_idx").on(
      table.groupId,
      table.occurredAt,
    ),
  ],
);

export type NotificationGroupEvent =
  typeof notificationGroupEvents.$inferSelect;

export type NewNotificationGroupEvent =
  typeof notificationGroupEvents.$inferInsert;
