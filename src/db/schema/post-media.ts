import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { posts } from "./posts";

/**
 * Image attachments for short Posts.
 *
 * One row represents one uploaded image. `position` preserves the order
 * selected in the editor; the unique index prevents two images occupying
 * the same position in one Post. The maximum of five images is enforced by
 * the Posts service when creating or replacing the attachment list.
 */
export const postMedia = pgTable(
  "post_media",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),

    url: text("url").notNull(),

    /** Cloudinary public ID, used when deleting/replacing an uploaded asset. */
    publicId: text("public_id"),

    position: integer("position").notNull(),

    altText: text("alt_text"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("post_media_post_position_uidx").on(
      table.postId,
      table.position,
    ),
    index("post_media_post_idx").on(table.postId),
  ],
);

export type PostMedia = typeof postMedia.$inferSelect;
export type NewPostMedia = typeof postMedia.$inferInsert;
