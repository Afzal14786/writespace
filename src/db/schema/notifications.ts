import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { notificationGroups } from "./notification-groups";
import { users } from "./users";

export type NotificationStatus = "active" | "archived" | "dismissed";

export type NotificationPriority = "critical" | "high" | "normal" | "low";

/**
 * Persistent in-app notification inbox.
 *
 * This table represents the user-facing inbox item, not the delivery attempt.
 * Delivery state is stored in notification_deliveries.
 *
 * Grouped activity is aggregated independently in notification_groups,
 * allowing eligible email summaries to exist without an in-app inbox item.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    recipientUserId: uuid("recipient_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),

    // Stable logical reference to the source event for an individual item.
    // Group members are recorded in notification_group_events.
    sourceEventId: uuid("source_event_id"),

    // Stable identifiers validated by the application policy/notification registry.
    notificationType: text("notification_type").notNull(),
    category: text("category").notNull(),

    priority: text("priority")
      .$type<NotificationPriority>()
      .default("normal")
      .notNull(),

    title: text("title").notNull(),
    body: text("body").notNull(),

    // Only validated presentation data belongs here; never store secrets.
    presentationData: jsonb("presentation_data")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),

    // Cross-module resource references. These deliberately have no foreign keys.
    resourceType: text("resource_type"),
    resourceId: text("resource_id"),
    actionType: text("action_type"),

    // Stable key used to prevent duplicate logical inbox notifications.
    dedupeKey: text("dedupe_key"),

    // Optional group that this inbox item presents.
    groupId: uuid("group_id").references(() => notificationGroups.id, {
      onDelete: "set null",
    }),

    // Inbox visibility lifecycle, separate from read state.
    status: text("status")
      .$type<NotificationStatus>()
      .default("active")
      .notNull(),

    // NULL means unread; otherwise this stores the time it was read.
    readAt: timestamp("read_at", { withTimezone: true }),

    expiresAt: timestamp("expires_at", { withTimezone: true }),

    // Soft deletion preserves associated delivery/attempt history.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),

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
      "notifications_priority_check",
      sql`${table.priority} IN ('critical', 'high', 'normal', 'low')`,
    ),

    check(
      "notifications_status_check",
      sql`${table.status} IN ('active', 'archived', 'dismissed')`,
    ),

    // Stable chronological keyset pagination for a recipient's inbox.
    index("notifications_recipient_created_id_idx").on(
      table.recipientUserId,
      table.createdAt.desc(),
      table.id.desc(),
    ),

    // Efficient active unread listing and unread-count queries.
    index("notifications_active_unread_idx")
      .on(table.recipientUserId, table.createdAt.desc(), table.id.desc())
      .where(
        sql`${table.status} = 'active'
          AND ${table.readAt} IS NULL
          AND ${table.deletedAt} IS NULL`,
      ),

    // One non-deleted logical notification per recipient/dedupe key.
    uniqueIndex("notifications_recipient_dedupe_uq")
      .on(table.recipientUserId, table.dedupeKey)
      .where(
        sql`${table.dedupeKey} IS NOT NULL
          AND ${table.deletedAt} IS NULL`,
      ),

    // A group can have at most one non-deleted inbox presentation.
    uniqueIndex("notifications_group_uq")
      .on(table.groupId)
      .where(
        sql`${table.groupId} IS NOT NULL
          AND ${table.deletedAt} IS NULL`,
      ),
  ],
);

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
