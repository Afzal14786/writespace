import {
  AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { contentItems } from "./content-items";
import { users } from "./users";

/**
 * Comments and threaded replies for either a Post or an Article.
 *
 * `contentItemId` replaces the old `postId`: comments now target the shared
 * content identity, so the same table supports both content types.
 *
 * `parentCommentId` forms the reply tree. The service must additionally
 * verify that a selected parent comment belongs to the same content item;
 * the self-FK only guarantees that the parent comment exists.
 */
export const comments = pgTable(
  "comments",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    content: varchar("content", { length: 2500 }).notNull(),

    contentItemId: uuid("content_item_id")
      .notNull()
      .references(() => contentItems.id, { onDelete: "cascade" }),

    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),

    parentCommentId: uuid("parent_comment_id").references(
      (): AnyPgColumn => comments.id,
      { onDelete: "cascade" },
    ),

    // Counts are denormalized and must be changed in the same transaction
    // as the corresponding reaction/reply insert or delete.
    reactionCount: integer("reaction_count").default(0).notNull(),
    replyCount: integer("reply_count").default(0).notNull(),
    isEdited: boolean("is_edited").default(false).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Efficient top-level/reply pagination within one content item.
    index("comments_content_parent_created_id_idx").on(
      table.contentItemId,
      table.parentCommentId,
      table.createdAt,
      table.id,
    ),

    // Efficient lookup of replies when the parent comment is known.
    index("comments_parent_created_id_idx").on(
      table.parentCommentId,
      table.createdAt,
      table.id,
    ),

    check(
      "comments_nonnegative_counters_check",
      sql`${table.reactionCount} >= 0 AND ${table.replyCount} >= 0`,
    ),
  ],
);

export type Comment = typeof comments.$inferSelect;
export type NewComment = typeof comments.$inferInsert;
