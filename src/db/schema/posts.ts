import {
  pgTable,
  text,
  uuid,
  boolean,
  integer,
  timestamp,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users";

export const postStatusEnum = pgEnum("post_status", [
  "draft",
  "scheduled",
  "published",
  "archived",
  "trash",
]);

export const posts = pgTable(
  "posts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: text("title").notNull(),
    slug: text("slug").notNull().unique(),
    subtitle: text("subtitle"),
    content: text("content").notNull(),
    excerpt: text("excerpt"),
    version: integer("version").default(1).notNull(),
    // coverImage (flattened)
    coverImageUrl: text("cover_image_url"),
    coverImageAltText: text("cover_image_alt_text"),
    coverImageCredit: text("cover_image_credit"),
    coverImageMobileUrl: text("cover_image_mobile_url"),
    // media
    audioUrl: text("audio_url"),
    attachments: text("attachments").array().default([]),
    // taxonomy
    categoryId: text("category_id"),
    tags: text("tags").array().default([]),
    seriesId: text("series_id"),
    seriesOrder: integer("series_order"),
    // ownership
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    isPremium: boolean("is_premium").default(false).notNull(),
    status: postStatusEnum("status").default("draft").notNull(),
    publishDate: timestamp("publish_date", { withTimezone: true }),
    // stats (flattened)
    viewCount: integer("view_count").default(0).notNull(),
    likeCount: integer("like_count").default(0).notNull(),
    commentCount: integer("comment_count").default(0).notNull(),
    shareCount: integer("share_count").default(0).notNull(),
    readTime: integer("read_time").default(0).notNull(),
    // timestamps
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("posts_status_publish_date_idx").on(table.status, table.publishDate),
    index("posts_author_idx").on(table.authorId),
  ],
);

export type Post = typeof posts.$inferSelect;
export type NewPost = typeof posts.$inferInsert;
