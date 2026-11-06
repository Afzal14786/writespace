import { integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";

import type { ContentDocument } from "./content-document";
import { contentItems } from "./content-items";

/**
 * Long-form Articles.
 *
 * Like Posts, an Article's `id` is the same UUID as its parent
 * `content_items.id`. Common author/lifecycle/counter fields are not repeated
 * here. The slug is unique because it is part of the Article's public URL.
 */
export const articles = pgTable("articles", {
  id: uuid("id")
    .primaryKey()
    .references(() => contentItems.id, { onDelete: "cascade" }),

  title: text("title").notNull(),

  slug: text("slug").notNull().unique(),

  subtitle: text("subtitle"),

  contentDocument: jsonb("content_document")
    .$type<ContentDocument>()
    .notNull()
    .default({ version: 1, blocks: [] }),

  excerpt: text("excerpt"),

  tags: text("tags").array().notNull().default([]),

  readTime: integer("read_time").notNull().default(0),

  coverImageUrl: text("cover_image_url"),
  coverImagePublicId: text("cover_image_public_id"),
  coverImageAltText: text("cover_image_alt_text"),
  coverImageCredit: text("cover_image_credit"),
});

export type Article = typeof articles.$inferSelect;
export type NewArticle = typeof articles.$inferInsert;
