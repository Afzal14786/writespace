import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./users";

/** Notification reasons understood by the application. */
export const notificationTypeEnum = pgEnum("notification_type", [
  "WELCOME",
  "REACTION",
  "COMMENT",
  "FOLLOW",
  "SHARE",
  "MENTION",
  "REPORT",
  "MESSAGE",
  "SYSTEM",
  "LOGIN_ALERT",
  "PASSWORD_CHANGED",
  "PASSWORD_RESET",
  "ACCOUNT_STATUS",
]);

/**
 * Kind of object referenced by a notification.
 *
 * `CONTENT_ITEM` replaces the old `POST`, because reactions/comments/shares
 * can now originate from either a Post or an Article. `relatedId` remains a
 * polymorphic UUID and deliberately has no direct FK; entityType determines
 * which entity table/service should resolve it.
 */
export const notificationEntityTypeEnum = pgEnum("notification_entity_type", [
  "CONTENT_ITEM",
  "COMMENT",
  "USER",
  "MESSAGE",
  "REPORT",
  "SYSTEM",
]);

/** In-app notification inbox. Delivery attempts live in notification_deliveries. */
export const notifications = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),

    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    actorId: uuid("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),

    type: notificationTypeEnum("type").notNull(),
    entityType: notificationEntityTypeEnum("entity_type"),
    relatedId: uuid("related_id"),

    message: text("message").notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),

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
    // Inbox unread filter.
    index("notifications_recipient_is_read_idx").on(
      table.recipientId,
      table.isRead,
    ),
    // Inbox chronological pagination.
    index("notifications_recipient_created_idx").on(
      table.recipientId,
      table.createdAt,
    ),
  ],
);

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
