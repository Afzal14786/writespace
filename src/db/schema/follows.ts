import {
  index,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./users";

/**
 * Directed user-to-user follow relationship.
 *
 * The composite primary key prevents duplicate follows and supports lookups
 * by follower. The second index supports the reverse "who follows this user"
 * access pattern, commonly ordered by the time the follow was created.
 */
export const follows = pgTable(
  "follows",
  {
    followerId: uuid("follower_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    followingId: uuid("following_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.followerId, table.followingId] }),
    index("follows_following_created_idx").on(
      table.followingId,
      table.createdAt,
    ),
  ],
);

export type Follow = typeof follows.$inferSelect;
export type NewFollow = typeof follows.$inferInsert;
