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

import { users } from "./users";

export type NotificationGroupStatus = "active" | "closed";

export const notificationGroups = pgTable(
  "notification_groups",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    recipientUserId: uuid("recipient_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    // Deterministic key representing the recipient, resource and activity type.
    groupingKey: text("grouping_key").notNull(),

    // Start of the deterministic UTC-aligned grouping window.
    groupingWindowStart: timestamp("grouping_window_start", {
      withTimezone: true,
    }).notNull(),

    activityType: text("activity_type").notNull(),

    resourceType: text("resource_type"),
    resourceId: text("resource_id"),

    // Counts distinct source events, not distinct actors.
    groupCount: integer("group_count").notNull(),

    firstActivityAt: timestamp("first_activity_at", {
      withTimezone: true,
    }).notNull(),

    lastActivityAt: timestamp("last_activity_at", {
      withTimezone: true,
    }).notNull(),

    // Closed groups no longer accept new events.
    status: text("status")
      .$type<NotificationGroupStatus>()
      .default("active")
      .notNull(),

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
      "notification_groups_count_positive_check",
      sql`${table.groupCount} > 0`,
    ),

    check(
      "notification_groups_status_check",
      sql`${table.status} IN ('active', 'closed')`,
    ),

    // Only one active group may exist for a given recipient and time bucket.
    uniqueIndex("notification_groups_active_window_uq")
      .on(table.recipientUserId, table.groupingKey, table.groupingWindowStart)
      .where(sql`${table.status} = 'active'`),

    index("notification_groups_recipient_activity_idx").on(
      table.recipientUserId,
      table.lastActivityAt,
    ),
  ],
);

export type NotificationGroup = typeof notificationGroups.$inferSelect;
export type NewNotificationGroup = typeof notificationGroups.$inferInsert;
