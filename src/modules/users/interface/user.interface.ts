import type { User } from "../../../db/schema";

export type { User };

// Data returned to the authenticated account owner.
export type PublicUser = Omit<
  User,
  "passwordHash" | "loginAttempts" | "lockUntil" | "googleAuth" | "githubAuth"
>;

// Data returned when viewing another user's profile.
// Authentication does not grant access to internal account information.
export type PublicProfile = Pick<
  User,
  | "id"
  | "fullname"
  | "username"
  | "bio"
  | "headline"
  | "location"
  | "profileImageUrl"
  | "bannerImageUrl"
  | "youtube"
  | "instagram"
  | "facebook"
  | "twitter"
  | "github"
  | "website"
  | "linkedin"
  | "leetcode"
  | "geeksforgeeks"
  | "codeforces"
  | "totalPosts"
  | "totalReads"
  | "totalFollowers"
  | "totalFollowing"
  | "createdAt"
>;
