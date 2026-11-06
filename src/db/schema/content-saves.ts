import {
  index,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { contentItems } from "./content-items";
import { users } from "./users";

/** A user can save a content item once; removing it deletes this row. */
export const contentSaves = pgTable(
  "content_saves",
  {
    contentItemId: uuid("content_item_id")
      .notNull()
      .references(() => contentItems.id, { onDelete: "cascade" }),

    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.contentItemId, table.userId] }),
    index("content_saves_user_created_idx").on(table.userId, table.createdAt),
  ],
);

export type ContentSave = typeof contentSaves.$inferSelect;
export type NewContentSave = typeof contentSaves.$inferInsert;
