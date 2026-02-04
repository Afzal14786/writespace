import {
  pgTable,
  text,
  uuid,
  boolean,
  integer,
  bigint,
  timestamp,
  pgEnum,
} from "drizzle-orm/pg-core";

export const userStatusEnum = pgEnum("user_status", [
  "active",
  "suspended",
  "banned",
]);
export const userRoleEnum = pgEnum("user_role", ["user", "admin"]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  // personal_info (flattened)
  fullname: text("fullname").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"),
  username: text("username").notNull().unique(),
  bio: text("bio").default(""),
  profileImageUrl: text("profile_image_url").default(
    "https://api.dicebear.com/7.x/adventurer/svg?seed=mail",
  ),
  profileImagePublicId: text("profile_image_public_id").default(""),
  bannerImageUrl: text("banner_image_url").default(""),
  bannerImagePublicId: text("banner_image_public_id").default(""),
  // social_links (flattened)
  youtube: text("youtube").default(""),
  instagram: text("instagram").default(""),
  facebook: text("facebook").default(""),
  twitter: text("twitter").default(""),
  github: text("github").default(""),
  website: text("website").default(""),
  linkedin: text("linkedin").default(""),
  // account_info (flattened)
  totalPosts: integer("total_posts").default(0).notNull(),
  totalReads: integer("total_reads").default(0).notNull(),
  totalFollowers: integer("total_followers").default(0).notNull(),
  totalFollowing: integer("total_following").default(0).notNull(),
  status: userStatusEnum("status").default("active").notNull(),
  role: userRoleEnum("role").default("user").notNull(),
  loginAttempts: integer("login_attempts").default(0).notNull(),
  lockUntil: bigint("lock_until", { mode: "number" }),
  // auth providers
  googleAuth: boolean("google_auth").default(false).notNull(),
  githubAuth: boolean("github_auth").default(false).notNull(),
  // timestamps
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
