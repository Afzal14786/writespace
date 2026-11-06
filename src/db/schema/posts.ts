import { jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";

import type { ContentDocument } from "./content-document";
import { contentItems } from "./content-items";

/**
 * Short-form Posts.
 *
 * `id` is both this table's primary key and a foreign key to
 * `content_items.id`. It is intentionally not generated independently.
 * Insert a content_items row first, then insert this row with the same ID.
 *
 * Post-specific fields only live here. Author, status, scheduling, counters,
 * and timestamps are owned by content_items and must be read from there.
 */
export const posts = pgTable("posts", {
  id: uuid("id")
    .primaryKey()
    .references(() => contentItems.id, { onDelete: "cascade" }),

  /** Ordered paragraphs, inline links, mentions, and code blocks. */
  contentDocument: jsonb("content_document")
    .$type<ContentDocument>()
    .notNull()
    .default({ version: 1, blocks: [] }),

  tags: text("tags").array().notNull().default([]),
});

export type Post = typeof posts.$inferSelect;
export type NewPost = typeof posts.$inferInsert;
