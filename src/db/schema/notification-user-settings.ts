import {
  boolean,
  check,
  pgTable,
  text,
  time,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { users } from "./users";

export const notificationUserSettings = pgTable(
  "notification_user_settings",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),

    timezone: text("timezone").default("UTC").notNull(),

    quietHoursEnabled: boolean("quiet_hours_enabled").default(false).notNull(),

    // Local wall-clock times interpreted using the IANA timezone above.
    quietHoursStart: time("quiet_hours_start"),
    quietHoursEnd: time("quiet_hours_end"),

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
      "notification_user_settings_quiet_hours_check",
      sql`
        ${table.quietHoursEnabled} = false
        OR (
          ${table.quietHoursStart} IS NOT NULL
          AND ${table.quietHoursEnd} IS NOT NULL
          AND ${table.quietHoursStart} <> ${table.quietHoursEnd}
        )
      `,
    ),
  ],
);

export type NotificationUserSettings =
  typeof notificationUserSettings.$inferSelect;

export type NewNotificationUserSettings =
  typeof notificationUserSettings.$inferInsert;
