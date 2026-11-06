import {
  bigint,
  boolean,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/** Account state controls whether a user may authenticate/use the platform. */
export const userStatusEnum = pgEnum("user_status", [
  "active",
  "suspended",
  "banned",
]);

/** Platform permission level; do not confuse this with content ownership. */
export const userRoleEnum = pgEnum("user_role", ["user", "admin"]);

/**
 * User accounts and profile information.
 *
 * Profile/social fields remain in this table for the current Writespace
 * product model. Authentication secrets are never included in public-user
 * API responses; that restriction belongs in the user serializer/service.
 */
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),

  // Identity and profile.
  fullname: text("fullname").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"),
  username: text("username").notNull().unique(),
  bio: text("bio").default(""),
  headline: text("headline").default(""),
  location: text("location").default(""),

  profileImageUrl: text("profile_image_url").default(
    "https://api.dicebear.com/7.x/adventurer/svg?seed=mail",
  ),
  profileImagePublicId: text("profile_image_public_id").default(""),
  bannerImageUrl: text("banner_image_url").default(""),
  bannerImagePublicId: text("banner_image_public_id").default(""),

  // External profile links.
  youtube: text("youtube").default(""),
  instagram: text("instagram").default(""),
  facebook: text("facebook").default(""),
  twitter: text("twitter").default(""),
  github: text("github").default(""),
  website: text("website").default(""),
  linkedin: text("linkedin").default(""),
  leetcode: text("leetcode").default(""),
  geeksforgeeks: text("geeksforgeeks").default(""),
  codeforces: text("codeforces").default(""),

  // Denormalized profile counters; update them transactionally in services.
  totalPosts: integer("total_posts").default(0).notNull(),
  totalReads: integer("total_reads").default(0).notNull(),
  totalFollowers: integer("total_followers").default(0).notNull(),
  totalFollowing: integer("total_following").default(0).notNull(),

  status: userStatusEnum("status").default("active").notNull(),
  role: userRoleEnum("role").default("user").notNull(),

  // Login protection metadata; never expose these fields publicly.
  loginAttempts: integer("login_attempts").default(0).notNull(),
  lockUntil: bigint("lock_until", { mode: "number" }),

  // Flags recording which social sign-in providers are linked.
  googleAuth: boolean("google_auth").default(false).notNull(),
  githubAuth: boolean("github_auth").default(false).notNull(),

  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
