import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./users";

/** Identifies which subtype table stores the content-specific fields. */
export const contentItemTypeEnum = pgEnum("content_item_type", [
  "post",
  "article",
]);

/** Shared lifecycle for both Posts and Articles. */
export const contentStatusEnum = pgEnum("content_status", [
  "draft",
  "scheduled",
  "published",
]);

/**
 * Common identity and lifecycle for every piece of publishable content.
 *
 * `posts.id` and `articles.id` are both foreign keys to this table's `id`.
 * Therefore the parent and subtype row share exactly one UUID; there is no
 * second content ID to synchronize.
 *
 * Keep fields common to both content types here. Article-only data such as
 * title, slug, read time, and cover image belongs in `articles`. Post-only
 * data such as its structured body and tags belongs in `posts`.
 *
 * The subtype/type match (a row in `posts` must have content_type='post',
 * and a row in `articles` must have content_type='article') is checked by
 * the content creation/service layer. A normal single-column FK cannot
 * enforce that discriminator match by itself.
 */
export const contentItems = pgTable(
  "content_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    contentType: contentItemTypeEnum("content_type").notNull(),

    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),

    status: contentStatusEnum("status").default("draft").notNull(),

    /** Set only while status is `scheduled`; the publisher worker consumes it. */
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),

    /** Actual publication time; null for drafts and not-yet-published items. */
    publishDate: timestamp("publish_date", { withTimezone: true }),

    viewCount: integer("view_count").default(0).notNull(),
    reactionCount: integer("reaction_count").default(0).notNull(),
    commentCount: integer("comment_count").default(0).notNull(),
    shareCount: integer("share_count").default(0).notNull(),

    /** Optimistic concurrency version for concurrent edits. */
    version: integer("version").default(1).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Supports published-feed queries with a stable ID tie-breaker.
    index("content_items_status_publish_date_id_idx").on(
      table.status,
      table.publishDate,
      table.id,
    ),

    // Supports the background worker's scheduled-publication scan.
    index("content_items_status_scheduled_at_idx").on(
      table.status,
      table.scheduledAt,
    ),

    // Supports an author's content library ordered by creation time.
    index("content_items_author_created_idx").on(
      table.authorId,
      table.createdAt,
    ),

    // A scheduled item must always have a time at which it should publish.
    check(
      "content_items_scheduled_at_check",
      sql`${table.status} <> 'scheduled' OR ${table.scheduledAt} IS NOT NULL`,
    ),

    // Counters and versions must never become negative/invalid.
    check(
      "content_items_nonnegative_counters_check",
      sql`${table.viewCount} >= 0 AND ${table.reactionCount} >= 0 AND ${table.commentCount} >= 0 AND ${table.shareCount} >= 0 AND ${table.version} >= 1`,
    ),
  ],
);

export type ContentItem = typeof contentItems.$inferSelect;
export type NewContentItem = typeof contentItems.$inferInsert;
