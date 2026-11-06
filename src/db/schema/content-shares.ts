import {
  index,
  pgTable,
  serial,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { contentItems } from "./content-items";
import { users } from "./users";

/**
 * Append-only share history: every share action creates its own row.
 * Unlike saves/reactions, multiple shares by the same user are allowed.
 */
export const contentShares = pgTable(
  "content_shares",
  {
    id: serial("id").primaryKey(),

    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    contentItemId: uuid("content_item_id")
      .notNull()
      .references(() => contentItems.id, { onDelete: "cascade" }),

    platform: text("platform").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("content_shares_user_item_platform_idx").on(
      table.userId,
      table.contentItemId,
      table.platform,
    ),
    index("content_shares_item_created_idx").on(
      table.contentItemId,
      table.createdAt,
    ),
  ],
);

export type ContentShare = typeof contentShares.$inferSelect;
export type NewContentShare = typeof contentShares.$inferInsert;
