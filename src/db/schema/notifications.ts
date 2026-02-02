import {
  pgTable,
  text,
  uuid,
  boolean,
  timestamp,
  serial,
  index,
  pgEnum,
} from "drizzle-orm/pg-core";
import { users } from "./users";

export const notificationTypeEnum = pgEnum("notification_type", [
  "WELCOME",
  "LIKE",
  "COMMENT",
  "FOLLOW",
  "SHARE",
  "SYSTEM",
  "LOGIN_ALERT",
]);

export const notifications = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: notificationTypeEnum("type").notNull(),
    message: text("message").notNull(),
    relatedId: text("related_id"),
    isRead: boolean("is_read").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("notifications_recipient_is_read_idx").on(
      table.recipientId,
      table.isRead,
    ),
  ],
);

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
