import {
  boolean,
  check,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { users } from "./users";

export type NotificationPreferenceChannel = "in_app" | "email" | "browser_push";

export type NotificationFrequency =
  | "immediate"
  | "daily_digest"
  | "weekly_digest";

export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    category: text("category").notNull(),

    channel: text("channel").$type<NotificationPreferenceChannel>().notNull(),

    enabled: boolean("enabled").notNull(),

    frequency: text("frequency")
      .$type<NotificationFrequency>()
      .default("immediate")
      .notNull(),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.category, table.channel],
    }),

    check(
      "notification_preferences_channel_check",
      sql`${table.channel} IN ('in_app', 'email', 'browser_push')`,
    ),

    check(
      "notification_preferences_frequency_check",
      sql`${table.frequency} IN ('immediate', 'daily_digest', 'weekly_digest')`,
    ),
  ],
);

export type NotificationPreference =
  typeof notificationPreferences.$inferSelect;

export type NewNotificationPreference =
  typeof notificationPreferences.$inferInsert;
