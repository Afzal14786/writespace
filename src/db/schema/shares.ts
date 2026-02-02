import {
  pgTable,
  text,
  uuid,
  timestamp,
  serial,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users";
import { posts } from "./posts";

export const shares = pgTable(
  "shares",
  {
    id: serial("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("shares_user_post_platform_idx").on(
      table.userId,
      table.postId,
      table.platform,
    ),
  ],
);

export type Share = typeof shares.$inferSelect;
export type NewShare = typeof shares.$inferInsert;
