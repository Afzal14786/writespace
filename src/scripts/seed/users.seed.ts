import bcrypt from "bcryptjs";

import { users } from "../../db/schema";

import { BCRYPT_SALT_ROUNDS, DEMO_PASSWORD, DEMO_USERS } from "./seed-data";

import type { SeedTransaction } from "./seed-types";

export async function seedUsers(tx: SeedTransaction): Promise<void> {
  console.info("Seeding users...");

  const passwordHashes = await Promise.all(
    DEMO_USERS.map(() => bcrypt.hash(DEMO_PASSWORD, BCRYPT_SALT_ROUNDS)),
  );

  const userRows = DEMO_USERS.map((user, index) => ({
    id: user.id,

    fullname: user.fullname,
    username: user.username,
    email: user.email,
    passwordHash: passwordHashes[index],

    bio: user.bio,
    headline: user.headline,
    location: user.location,

    profileImageUrl: user.profileImageUrl,
    profileImagePublicId: null,

    bannerImageUrl: user.bannerImageUrl,
    bannerImagePublicId: null,

    // Use reserved example data instead of real external accounts.
    website: `https://example.com/profiles/${user.username}`,

    github: null,
    linkedin: null,
    instagram: null,
    facebook: null,
    twitter: null,
    youtube: null,
    leetcode: null,
    geeksforgeeks: null,
    codeforces: null,

    totalPosts: 0,
    totalReads: 0,
    totalFollowers: 0,
    totalFollowing: 0,

    role: index === 0 ? ("admin" as const) : ("user" as const),
    status: "active" as const,

    loginAttempts: 0,
    lockUntil: null,

    googleAuth: false,
    githubAuth: false,

    createdAt: user.createdAt,
    updatedAt: user.createdAt,
  }));

  await tx.insert(users).values(userRows).onConflictDoNothing({
    target: users.id,
  });

  console.info(`Users seeded: ${userRows.length}`);
}
