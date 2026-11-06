import { pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";

import { comments } from "./comments";
import { reactionTypeEnum } from "./content-reactions";
import { users } from "./users";

/** One current reaction per user per comment. */
export const commentReactions = pgTable(
  "comment_reactions",
  {
    commentId: uuid("comment_id")
      .notNull()
      .references(() => comments.id, { onDelete: "cascade" }),

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
  (table) => [primaryKey({ columns: [table.commentId, table.userId] })],
);

export type CommentReaction = typeof commentReactions.$inferSelect;
export type NewCommentReaction = typeof commentReactions.$inferInsert;
