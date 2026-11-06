import {
  index,
  pgEnum,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { contentItems } from "./content-items";
import { users } from "./users";

/** Reaction vocabulary shared by content reactions and comment reactions. */
export const reactionTypes = [
  "like",
  "love",
  "laugh",
  "celebrate",
  "support",
  "sad",
  "angry",
] as const;

export type ReactionType = (typeof reactionTypes)[number];

export const reactionTypeEnum = pgEnum("reaction_type", reactionTypes);

/**
 * One current reaction per user per content item.
 *
 * Changing reactionType updates the existing row rather than inserting a
 * second reaction. The composite primary key enforces that invariant.
 */
export const contentReactions = pgTable(
  "content_reactions",
  {
    contentItemId: uuid("content_item_id")
      .notNull()
      .references(() => contentItems.id, { onDelete: "cascade" }),

    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    reactionType: reactionTypeEnum("reaction_type").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    primaryKey({ columns: [table.contentItemId, table.userId] }),
    index("content_reactions_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
  ],
);

export type ContentReaction = typeof contentReactions.$inferSelect;
export type NewContentReaction = typeof contentReactions.$inferInsert;
