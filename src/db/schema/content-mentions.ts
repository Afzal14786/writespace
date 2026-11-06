import {
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { contentItems } from "./content-items";
import { users } from "./users";

/**
 * Registered users mentioned in a Post or Article.
 *
 * The actual mention location/text is retained in contentDocument. This table
 * provides an efficient lookup for "where is this user mentioned?" and is a
 * reliable input for creating mention notifications.
 *
 * One row per (content item, mentioned user) avoids duplicate notification
 * records when the same user is mentioned several times in one document.
 */
export const contentMentions = pgTable(
  "content_mentions",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    contentItemId: uuid("content_item_id")
      .notNull()
      .references(() => contentItems.id, { onDelete: "cascade" }),

    mentionedUserId: uuid("mentioned_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("content_mentions_item_user_uidx").on(
      table.contentItemId,
      table.mentionedUserId,
    ),
    index("content_mentions_user_created_idx").on(
      table.mentionedUserId,
      table.createdAt,
    ),
  ],
);

export type ContentMention = typeof contentMentions.$inferSelect;
export type NewContentMention = typeof contentMentions.$inferInsert;
